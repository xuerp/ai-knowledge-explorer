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

### Epic 1B：实体别名归一化 — completed

1. [x] 迁移 `20260831_0020` 建立 `entity_alias` 规范化索引表；payload aliases 仍是事实源，索引可重建。
2. [x] 版本化目录 v1.0.0 的 24 条别名覆盖全部 19 个核心实体，并对 GPT-5 版本名完成消歧。
3. [x] 查询与目录共用 Unicode NFKC、casefold、下划线及空白规范化，别名进入 lexical 检索文档。
4. [x] 使用 Golden Set v1.0.0、同一固定 snapshot 和 TopK=8 做前后对照；实体类 Entity Recall@8 均为 100%，24 条补充别名探针从 16/24 提升到 24/24。

### Epic 1C：Embedding 与混合检索 — completed

1. [x] 在固定 Golden Set 上完成本地 BGE-small-zh 与 Cloudflare Workers AI `@cf/baai/bge-m3` 真实候选对比，ADR-0005 选择 Cloudflare 作为 staging hybrid provider；OpenAI 因付款约束、DoroAI 因没有可验证模型而取消。
2. [x] 迁移 `20260831_0021` 建立独立版本化 `rag_claim_embeddings` 表，并验证 upgrade、downgrade、re-upgrade 与单一 head。
3. [x] 实现生产 `CloudflareEmbeddingProvider`、增量持久向量索引、lexical/vector RRF union、预算硬上限、结构化状态与安全 lexical fallback；`RETRIEVAL_MODE` 默认保持 `lexical`。
4. [x] 使用生产 provider、版本化索引和 RRF union 重跑固定集：Recall@8 100.00%、Precision@8 14.22%、Entity Recall@8 98.75%、通过率 100.00%，80 条查询无 fallback。
5. [x] 在 Render staging 安全配置 Cloudflare 凭据并重新部署；受保护管理员状态于 2026-08-31 显示 `hybrid · cloudflare/@cf/baai/bge-m3 · 1024 维`，固定私密查询返回 `retrievalMode=hybrid`、`fallbackReason=null`、37 个候选、8 条结果。研究记录为 `54e4dcfe-ea45-45da-8c50-3bca3227fc58`，首条结论为 62.4%，同时绑定 OpenAI 与 SWE-bench Evidence。
6. [x] 2026-08-31 使用独立 Render Free 临时服务 `ai-radar-hybrid-fault-drill`（提交 `273a40b`、隔离 SQLite）完成 provider 故障与恢复演练，未修改主 staging 数据库。正常阶段研究记录 `213740e2-cfd6-46e7-8461-a9adc2ea9cc6` 返回 `hybrid`、无 fallback、12 个候选与 8 条结果；将临时服务模型精确改为不存在的测试模型并从运行实例状态确认生效后，记录 `cd2a2705-fc8f-4c75-89b6-dfaffcebf450` 安全返回 `lexical`、`hybrid-provider-error`、12 个候选与 8 条结果；恢复 `@cf/baai/bge-m3` 并确认运行实例配置后，记录 `952de46f-ac0a-4093-9f75-25338af0d9df` 再次返回 `hybrid`、无 fallback、12 个候选与 8 条结果。三段请求均为 HTTP 200、状态 `ready`、8 条 Claim 与 8 组引用。

### Epic 1D：Reranker — completed / not justified

生产 Hybrid 固定集的 Precision@8 为 14.22%。大多数题只有一个标注相关 Claim，固定 TopK=8 时理论值即 12.5%，因此不存在 Spec 所说的“Precision@8 明显不足”。不引入真实 Reranker，避免没有证据支撑的延迟、外部依赖与潜在费用。

### Epic 2B：定向关系抽取 — ready / model-call authorization pending

2026-09-01 已在 Render 受信任采集环境逐个完成首批 4 个官方 URL 的登记、安全预检、启用与首次采集，四次采集均为成功 1 / 失败 0。后台当前显示待抽取 Snapshot 4、采集重试 0、抽取冷却 0；AutoGen、CrewAI、Devin、Manus Snapshot 分别为 30,599、7,030、4,403、5,155 个可读字符，正文均包含目标关系锚点。四个信源在保存 Snapshot 后已暂停自动采集，避免恢复抽取时进入普通批次。`AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS=false` 与自动抽取上限 0 已部署并由后台确认；新批次 `2026-09-core-relations-02` 预算最多 4 个 Snapshot，只做待授权准备。下一步必须获得用户对新一批 DoroAI 模型调用的明确授权；候选生成时执行内容哈希与语义指纹去重，新增关系全部进入人工审核，不自动批准。

### Epic 3：数据质量看板 — completed

1. [x] 公开 `/api/quality/metrics` 与 `/api/v2/quality/metrics` 复用现有质量门禁，返回实时业务计数、覆盖率和独立的 `updatedAt`。
2. [x] 固定集评估从版本化真实结果生成 `backend/data/quality_evaluation.json`；指标、版本、提交与检索配置均可追溯，使用独立 `updatedAt` 和 `daily-or-on-retrieval-change` cadence。
3. [x] 新增公开 `/quality` 页面，分别显示业务指标与 Golden Set 指标、两类更新时间、演示模式边界和非 KPI 说明。
4. [x] 新增纯本地 `scripts/publish_quality_metrics.py` 与 CI 漂移检查；API 请求和 30 分钟 Cron 都不会调用 Embedding provider 或重跑固定集。
5. [x] 提交 `d2477ec` 的 GitHub Quality 运行 `33405448149` 全绿；Render staging 运行 `2026.08.31-quality-dashboard-v67` 与同一提交，公开质量 API 返回 HTTP 200；Cloudflare Worker 版本 `35ed92a5-6ff0-41c9-b3bf-6aeda0a16b79` 已部署，`/quality` 与同域指标 API 均返回 HTTP 200，并完成 1440×1200 浏览器视觉验收。

### Epic 4：审核流程可观测性 — completed

1. [x] 完成 review/audit 现状核查并记录到 `docs/eval/REVIEW_OBSERVABILITY_AUDIT_2026-09-01.md`：通过率、驳回率、审核耗时可直接复用现有字段，只有拒绝原因分布缺少结构化字段。
2. [x] 迁移 `20260901_0022` 只新增 nullable `reason_category` 与索引；既有 `review_reason` 继续作为 `reasonNote` 存储，历史数据不猜测回填并归入 `uncategorized`。
3. [x] 拒绝决策强制标准化 category，并支持可选 note；旧 `reason` 输入和既有客户端保持兼容，自动批量拒绝也写入确定性分类。
4. [x] 新增公开 `/api/review/stats` 与 `/api/v2/review/stats`，仅返回聚合指标，不公开审核人和个别备注。
5. [x] `/admin/review-demo` 新增真实统计面板；接口不可用时明确报错，不用演示数字替代。
6. [x] 提交 `3c30224` 的 GitHub Quality 运行 `33475763045` 前后端全绿；Render staging 运行 `2026.09.01-review-observability-v68`、同一提交与 schema `20260901_0022`，`/ready` 和公开统计 API 均为 HTTP 200。Cloudflare staging Worker 版本 `5124c94a-7a4b-4ad0-8211-dee9a74ab129` 已部署；同域统计返回 591 条已审核、194 条批准、397 条拒绝，397 条历史拒绝全部明确为 `uncategorized`。`/admin/review-demo` 浏览器验收显示 32.8% 批准率、67.2% 拒绝率和原因分布，控制台无错误。

### Epic 5：故障场景测试 — completed

1. [x] 新建 `docs/FAILURE_SCENARIOS.md`，按故障风险、期望边界、具体测试和覆盖状态盘点 LLM、Embedding、审核并发/幂等、批量事务、采集、邮件与前端失败。
2. [x] 新增 8 个真实故障注入案例：Embedding 缺字段、数量错误、维度错误、非数字、NaN/Infinity，非法拒绝分类，不完整/倒置审核时间，以及相反审核决定并发提交。
3. [x] 并发测试真实暴露 SQLite 忽略 `FOR UPDATE` 时两个相反决定都返回 200 的缺口；审核决定已改为 `status + version` 原子抢占，并连续 5 次并发回归保持单赢家。
4. [x] Embedding 非数字或非有限值在索引写入前转为不含 payload 的安全 provider 错误；既有 Hybrid lexical fallback 保持可用。
5. [x] `PRODUCTION_RUNBOOK.md` 已新增 LLM、Embedding、审核并发、统计异常和前后端分阶段发布的排障/恢复映射。
6. [x] 提交 `b9fd066` 的 GitHub Quality 运行 `33476714670` 前后端全绿；Render staging 已运行同一提交，`/ready` 为 HTTP 200，schema 保持 `20260901_0022`。本批无前端变更，Cloudflare 无需重复部署。

### Epic 6：ADR 与作品集 — completed

1. [x] `docs/adr/0001`–`0006` 六份决策记录齐全，覆盖 lexical-first、关系抽取门槛、Candidate/Verified 隔离、风险分层审核、Embedding 选型与“关系缺口不是 KPI”。
2. [x] Case Study 新增固定 Golden Set、同一 snapshot、TopK=8 的 Baseline → Alias → Hybrid 真实曲线，并解释 Precision@8 分母与 Relation 保持 76 的边界。
3. [x] 简历材料更新为 staging 真实快照 49 Entity / 197 Claim / 219 Evidence / 76 Relation / 55 Timeline，以及 Alias、Hybrid 和并发修复结果。
4. [x] 新增作品集证据契约测试，验证六份 ADR、固定评估数值与公开材料不回退到旧演示计数。
5. [x] 提交 `31ef5eb` 的 GitHub Quality 运行 `33477411649` 前后端全绿；Render staging 已运行同一提交，`/ready` 为 HTTP 200，schema 保持 `20260901_0022`。本批无运行时代码变更，Cloudflare 无需重复部署。

## 当前可执行节点

Epic 0、1A、2A、1B、1C、1D、Epic 3、Epic 4、Epic 5 与 Epic 6 均已完成。Epic 2B 的四个安全 Snapshot 已形成并从普通抽取路径隔离。当前收束点是验证新关系批次恰好识别这 4 个 Snapshot；只有在用户明确授权 DoroAI 模型调用后，才把自动抽取上限从 0 临时恢复为 2，分两轮生成候选并全部送入人工审核。
