# AI Radar 可信 RAG 实施 Spec

## 1. 背景与目标

AI Radar 已具备官方信源采集、候选事实抽取、人工审核、Claim 生命周期、Evidence、关系图谱和研究记录，但当前研究接口仍通过实体名称与 `subject` 字符串包含关系查找事实，再把最多八条 Claim 拼成列表。它可以避免无证据回答，却不具备可度量的全文召回、混合检索、重排和受约束生成能力。

本 Spec 的目标是把现有链路演进为可信 RAG：只检索可公开的已审核事实，优先使用发生或生效时间，逐条返回直接证据；证据不足、冲突或过期时明确拒答。实施按可独立提交和回滚的节点推进，任何节点中断都不影响已上线能力。

## 2. 范围与边界

### 2.1 本轮范围

1. 修复并度量 Claim 的实体关联、事实时间和生命周期。
2. 使用 PostgreSQL 原生全文检索建立零额外模型费用的检索基线。
3. 将黄金问题扩展为检索与引用质量评估。
4. 预留默认关闭的 Embedding、混合检索与 Reranker 接口。
5. 预留默认关闭的 LLM 引用生成接口和严格结果校验。

### 2.2 明确不做

- 不允许 LLM 直接写入公开知识库。
- 不检索待审核、拒绝、撤回或已被替代的 Claim 作为“当前事实”。
- 不把审核时间当作事实发生时间。
- 不在未经确认时调用 Embedding、Reranker 或生成模型。
- 不因 RAG 上线而把 `AI_RADAR_DATA_MODE` 从 `demo` 切换为 `live`。

## 3. 事实模型与生命周期

### 3.1 规范字段

公开检索文档以审核记录为权威来源，至少包含：

- `claim_id`：稳定 Claim 标识。
- `entity_id`：必须能解析到知识实体；无法解析的审核记录不进入检索索引。
- `subject`、`predicate`、`object_or_value`：结构化事实三元组。
- `text_zh`、`text_en`：用户可读事实。
- `valid_from`、`valid_to`：事实发生、生效和失效时间。
- `source_published_at`：直接证据中最早的官方发布时间，用作事实时间回退。
- `lifecycle_status`：`current`、`historical`、`superseded`、`retracted`。
- `superseded_by_claim_id`：替代它的新 Claim。
- `source_ids`、`source_excerpt`、`publisher`、`source_type`：引用所需证据。

### 3.2 时间优先级

检索结果的事实时间按以下顺序计算：

1. `valid_from`：事实发生或正式生效时间。
2. 直接 Evidence 的 `published_at`：官方资料发布时间。
3. 两者都没有时不展示主时间；`observed_at`、`collected_at`、`reviewed_at` 只作为溯源元数据。

### 3.3 生命周期规则

- `current`：可以作为当前结论参与默认检索。
- `historical`：仅在历史、演化、过去时间范围问题中召回。
- `superseded`：默认不召回；追问旧版本或变更原因时可召回，并必须同时返回替代 Claim。
- `retracted`：不得作为正向结论，只能在撤回或错误历史问题中解释。
- `merged-evidence`：不产生新事实，只扩展目标 Claim 的证据。

### 3.4 数据质量门禁

- 已批准且作为当前事实发布的审核记录必须有合法 `entity_id`。
- 当前事实必须至少有一个直接 Evidence。
- 替代事实必须与旧事实属于同一实体和同一语义槽位。
- `valid_to` 不得早于 `valid_from`。
- 所有不满足条件的记录进入质量报告，不静默补造字段。

## 4. PostgreSQL 全文检索基线

### 4.1 检索文档

新增 `rag_claim_documents` 投影表。它不是第二份事实源，而是可重建的检索投影：

- 事实、实体和 Evidence 仍由现有表与审核记录提供。
- 审核批准、合并证据、替代、撤回后同步重建对应投影。
- 提供全量重建命令，迁移或索引损坏时可恢复。

### 4.2 PostgreSQL 索引

- 中文及混合文本使用 `simple` 配置，避免英语词干化破坏产品名。
- 英文文本额外使用 `english` 配置。
- 使用存储生成或应用侧维护的 `tsvector` 字段和 GIN 索引。
- SQLite 测试环境使用确定性的词项匹配降级，不假装具备 PostgreSQL 排名能力。

### 4.3 查询流程

1. 规范化问题并识别实体别名。
2. 根据问题识别当前、历史或指定时间范围。
3. PostgreSQL `websearch_to_tsquery` / `plainto_tsquery` 召回候选。
4. 以实体命中、全文相关度、Evidence 完整度、官方来源、时间新鲜度进行确定性重排。
5. 去除重复语义槽位，仅保留当前或问题明确需要的历史版本。
6. 返回最多八条 Claim 和逐条 Evidence，不调用外部模型。

### 4.4 基线排序建议

```text
综合分 = 0.40 × 全文相关度
       + 0.25 × 实体精确命中
       + 0.15 × 官方来源覆盖
       + 0.10 × 时间匹配
       + 0.10 × Evidence 完整度
```

没有 PostgreSQL 排名值时，SQLite 降级实现使用相同维度的离散分数，保证测试结果稳定。

### 4.5 API

`POST /api/v2/research` 保持兼容，并扩展返回：

- `retrievalMode`：`lexical`、`hybrid`。
- `citations`：Claim 与直接 Evidence。
- `retrievalDiagnostics`：候选数、返回数、过滤原因和耗时；公开响应不包含敏感配置。
- `answerMode`：`extractive`、`generated`。

基线阶段固定为 `retrievalMode=lexical`、`answerMode=extractive`。

## 5. 黄金问题与质量评估

### 5.1 数据集扩展

每个黄金问题增加：

- `expectedEntityIds`
- `expectedClaimIds`（可选）
- `requiredSourceTypes`
- `requiresTemporalEvidence`
- `minimumRecallAtK`
- `shouldRefuse`

### 5.2 指标

- `entity_recall_at_8`：预期实体对应 Claim 是否进入前八。
- `claim_recall_at_8`：明确期望 Claim 的召回比例。
- `citation_coverage`：返回 Claim 中带直接证据的比例。
- `official_source_ratio`：官方证据占比。
- `temporal_accuracy`：需要时间证据的问题是否命中有效事实时间。
- `refusal_accuracy`：证据不足问题是否拒答。
- `lifecycle_precision`：默认回答中是否错误混入 superseded/retracted Claim。

### 5.3 正式门槛

- 黄金问题通过率不少于 85%。
- 引用覆盖率 100%。
- 生命周期准确率 100%。
- 应拒答问题不得生成推测性结论。
- 指标未通过时保持 `demo`，不得以人工修改报告绕过门禁。

## 6. Embedding、混合检索与 Reranker

### 6.1 默认关闭

新增能力必须由显式配置启用；未配置或预检失败时自动保持全文检索，不影响研究接口可用性。

### 6.2 扩展接口

- `EmbeddingProvider.embed_documents` / `embed_query`
- `VectorClaimIndex.upsert` / `search`
- `ClaimReranker.rerank`
- 使用模型名、向量维度和内容哈希做版本隔离。
- 只对已审核、可公开的检索文档生成向量。

### 6.3 混合策略

- 采用 Reciprocal Rank Fusion 合并全文和向量结果。
- 实体、生命周期、时间和来源过滤在融合前后都必须生效。
- Reranker 只能调整候选顺序，不能创造新 Claim 或 Evidence。
- 任一外部服务失败时降级到全文检索并记录可观察事件。

启用这一阶段会产生 Embedding 或 Reranker 调用费用，必须先确认供应商、模型和批次上限。

## 7. 带引用 LLM 生成

### 7.1 输入边界

生成模型只接收：用户问题、检索到的 Claim、Evidence 原文锚点、事实时间和冲突/生命周期标记。不得接收未审核候选作为事实。

### 7.2 输出结构

模型必须返回严格 JSON：

- `answerZh`、`answerEn`
- `statements[]`
- 每个 statement 的 `claimIds[]`
- `uncertainties[]`
- `refused` 与 `refusalReason`

即使供应商只能使用 `json_object`，仍必须进行 Pydantic 严格校验。

### 7.3 发布前校验

- 每个陈述至少引用一个本次检索返回的 Claim。
- 每个 Claim 至少有一个直接 Evidence。
- 输出不得引用未知 ID。
- 生成内容不得把 historical/superseded 说成当前事实。
- 校验失败时回退到 extractive 回答，不保存错误生成结果。

启用这一阶段会产生生成模型费用，必须先确认模型、单次上下文上限、每日调用上限与失败降级策略。

## 8. 可观察性、安全与回滚

- 记录检索模式、耗时、召回数、过滤数、降级原因，不记录 API Key。
- 研究记录保存检索 Claim ID 和生成模式，支持复现。
- 所有外部调用设有限时、有限重试和熔断；写操作不自动重放。
- 投影表可全量重建；关闭新配置即可回退到 lexical/extractive。
- 不读取、输出或覆盖 `backend/.env` 中的任何凭据。

## 9. 交付节点与验收

### 节点 A：数据生命周期

- 关联、时间、生命周期质量报告可执行。
- 当前研究不会返回无实体、无证据或已替代事实。
- SQLite 与 PostgreSQL 迁移验证通过。

### 节点 B：全文检索基线

- PostgreSQL 使用 GIN 全文索引；SQLite 有确定性降级。
- 研究接口返回逐条引用和检索诊断。
- 不配置任何外部模型仍可完整工作。

### 节点 C：评估门禁

- 黄金问题报告包含 RAG 指标。
- 回归测试覆盖实体、时间、拒答、引用和生命周期。
- CI 与完整后端测试通过。

### 节点 D：混合检索扩展

- 接口、配置、关闭态和失败降级完成。
- 未经费用确认不调用外部服务。

### 节点 E：生成扩展

- 严格输出 Schema、引用校验和 extractive 回退完成。
- 未经费用确认不调用外部服务。

## 10. 实施顺序

严格按 A → B → C → D → E 推进。每个节点先写失败回归测试，再实现、运行与 CI 对齐的完整检查、提交并推送。若上下文或执行额度接近边界，则在最近一个已通过测试并已提交的节点收束，不跨节点留下未验证修改。
