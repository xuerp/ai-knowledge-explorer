# AI Radar 完善 Spec v2：核实后执行版

生效日期：2026-08-30

状态依据：`docs/eval/REALITY_CHECK_2026-08-30.md`

本文是外部《AI Radar 完善 Spec v2》的仓库内执行版。它不改变原 Spec 的红线、顺序和验收标准，只替换已经过时的数字与任务假设。后续执行以本文和 Reality Check 为准，不得把已完成能力重新列为待办。

> 任何代码修改前，必须检查当前仓库真实实现与线上状态；若本 Spec 中任务已经完成，则不得重新实现，应将其标记为 completed / partially completed，并只处理剩余 gap。所有指标目标是验证对象，不是必须达成的 KPI；达不到目标时如实记录原因，不得为了达标而制造数据、放宽人工审核标准，或找不存在的关系硬凑覆盖率。

## 红线

- 指标是验证对象，不是必须达成的 KPI。
- 关系缺失不等于必须补齐；只能由真实官方 Evidence 驱动。
- 不读取或输出 `backend/.env`，不要求用户在聊天中发送 Secret。
- `AI_RADAR_DATA_MODE` 保持 `demo`。
- 未获明确授权，不触发新增付费 Embedding、Reranker、LLM 抽取或扩大批次。
- 每批修改先检查 Git 状态，保留用户无关改动；通过 CI 对齐检查后才提交、推送并确认远端绿色。
- 禁止 force push、rebase、amend、squash 已推送历史。
- 新增或修改 Markdown 使用中文。

## 已核实基线

快照日期为 2026-08-30：Entity 49、Claim 196、Evidence 218、Relation 76、Timeline 55。19 个核心实体中 16 个低于 5 条可解释关系，总覆盖差值为 44。

关系补齐批次已经完成：预算 10、尝试 10、成功 10、失败 0、产生候选 4、跳过重复 2、自动批准 0、剩余尝试 0、剩余合格 snapshot 0。不得重新实现或自行重跑这一批次。

## 顺序与任务状态

### Epic 0：现状核查 — completed

- [x] 真实公开计数与关系缺口已核实。
- [x] 关系优先模式、固定预算批次和 snapshot 瓶颈已核实。
- [x] Embedding / Hybrid / Reranker 扩展接口已核实。
- [x] 审核与审计字段可复用范围已核实。
- [x] `docs/eval/REALITY_CHECK_2026-08-30.md` 已生成。

### Epic 1A：Golden Set 与 lexical baseline — completed

已有 20 条 `golden_questions.json` 和 lexical FTS 基线，只复用，不重做。2026-08-30 已完成 80 条 Golden Set v1.0.0、固定公开快照、评估脚本、SQLite 便携式 baseline 与隔离 PostgreSQL 16 lexical FTS 最终基线：

1. [x] 建立 80 条、带 `version` 的 `docs/eval/retrieval_golden_set.jsonl`。
2. [x] 每条包含查询类别、`query`、`expected_entity_ids`、`expected_claim_ids`。
3. [x] 编写 `scripts/eval_retrieval.py`，固定并输出版本组合。
4. [x] 运行 SQLite 便携式 lexical baseline 并记录真实指标。
5. [x] 使用完全相同的版本组合在隔离 PostgreSQL 16 上重跑，形成 PostgreSQL lexical FTS 最终基线。

### Epic 2A：关系本体与官方信源缺口映射 — completed

关系抽取能力和固定预算 backfill 已存在，不重复实现。2026-08-31 已完成以下证据驱动交付物：

1. [x] 新建 `docs/RELATION_ONTOLOGY.md`，声明本体是合法取值约束而非关系配额，并将 `integrates-with` 的后端发布 schema、抽取提示和前端类型补齐到同一边界。
2. [x] 新建 `scripts/diagnose_relation_gaps.py`，输出实体覆盖、本体类型覆盖、未支撑关系的既有官方 Evidence；不输出主观的“应存在关系对”。
3. [x] 生成版本化真实诊断：19 个核心实体、16 个低于既有阈值、覆盖差值 44、181 条官方 Evidence 未被关系引用，其中 83 条关联核心实体。
4. [x] 基于诊断建立 `docs/eval/source_gap_worklist.md`，逐一评估 16 个低覆盖实体。
5. [x] 对首批 4 个新增官方 URL 完成 Evidence URL 去重，均为 0 命中；使用现有安全抓取器准备 Snapshot 时，因当前环境 DNS 未通过公网地址校验而被正确阻止。没有绕过安全策略、伪造 Snapshot、写数据库或调用模型。

Epic 2A 的本体、诊断、清单与剩余 gap 记录均已完成。Snapshot 安全抓取失败是 Epic 2B 的显式 Evidence 前置阻塞，不把 2A 的诊断结果伪装成已采集证据。

### Epic 1B：实体别名归一化 — pending after 1A

复用 Entity 已有 `aliases` 能力，先判断独立 `entity_alias` 表是否确有必要。无论 schema 选择如何，都必须覆盖核心实体，并用同一 Golden Set / snapshot 做别名前后对照。

### Epic 1C：Embedding 与混合检索 — pending after 1A/1B

复用现有 provider、vector index、RRF 和安全降级接口。剩余任务是实际 benchmark、版本化 schema、ADR 与 staging 验证。未获授权不调用付费 API；不得把现有 PostgreSQL lexical FTS 称为 BM25。

### Epic 1D：Reranker — deferred

现有接口和测试不等于应启用真实 Reranker。只有 1C 结果显示 Recall@8 可接受而 Precision@8 明显不足时才投入。

### Epic 2B：定向关系抽取 — blocked

当前 `eligibleSnapshots=0`。Epic 2A 已完成，但首批 4 个去重后的官方候选 URL 在当前执行环境中未通过安全抓取器的 DNS 公网地址校验，尚无可用 Snapshot。必须先在受信任采集环境完成 Snapshot / Diff；如需新增付费调用，再获得用户明确授权。新增关系全部进入人工审核，不自动批准。

### Epic 3：数据质量看板 — pending after evaluation metrics

复用现有受保护质量报告，不重复聚合已有业务指标。补充 Spec 所需的业务/评估更新时间分离、指标 API 与 `/quality` 页面；评估指标每日或检索策略变更后更新，不挂到 30 分钟高频 Cron。

### Epic 4：审核流程可观测性 — pending

复用现有状态、时间戳、审核人、自由文本原因、版本与幂等字段。只为缺失的标准化 `reason_category` 做按需 migration，并保留自由文本 `reason_note`；再实现统计 API 与管理面板。

### Epic 5：故障场景测试 — pending

先盘点并标注现有 LLM 非法输出、provider 降级、并发/幂等审核覆盖，再补至少 5 个高优先级真实缺口及 Runbook 映射。不得用测试总数代替场景证明。

### Epic 6：ADR 与作品集 — pending last

最后基于前述真实产出补 0001–0006 ADR、Case Study 优化曲线和简历量化描述。没有实验结果前不得预写“指标改善”。

## 当前可执行节点

Epic 0、1A、2A 已完成。Epic 2B 因安全 Snapshot 尚未形成而保持 blocked，不得启动抽取。按 Spec 顺序，下一个可执行主线节点是 Epic 1B：实体别名归一化；先核实是否需要独立 alias 表，再用同一 Golden Set / snapshot 做前后对照。
