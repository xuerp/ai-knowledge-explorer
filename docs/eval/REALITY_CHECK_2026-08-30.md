# AI Radar Spec v2 现状核查

核查日期：2026-08-30（Asia/Shanghai）  
仓库分支：`codex/productionize`  
核查提交：`7af7fcee9ae2f315d89a0567e121187342d9ecfb`  
线上 API：`https://ai-radar-api-staging.onrender.com`  
公开快照时间：`2026-08-30T20:40:48.679879+08:00`

> 任何代码修改前，必须检查当前仓库真实实现与线上状态；若本 Spec 中任务已经完成，则不得重新实现，应将其标记为 completed / partially completed，并只处理剩余 gap。所有指标目标是验证对象，不是必须达成的 KPI；达不到目标时如实记录原因，不得为了达标而制造数据、放宽人工审核标准，或找不存在的关系硬凑覆盖率。

## 核查边界

- 线上数字来自公开只读接口 `/health`、`/ready`、`/api/v2/snapshot` 与 `/api/v2/public/relation-backfill-status`。
- 未读取 `backend/.env`，未使用管理员令牌，未访问私有审核队列，未触发采集、抽取、审核、部署或数据库写入。
- `reviewCandidates=0` 仅是公开快照字段，不能代表私有审核队列为空。本报告不把它当作后台待审数量。
- 代码状态以当前提交为准；线上 `/health` 返回的 `buildCommit` 与当前提交一致。

## 公开数据与关系缺口

| 指标                          | 核实值 | 核实方式                                           |
| ----------------------------- | -----: | -------------------------------------------------- |
| Entity                        |     49 | `snapshot.entities`                                |
| Claim                         |    196 | `snapshot.claims`                                  |
| Evidence                      |    218 | `snapshot.evidence`                                |
| Relation                      |     76 | `snapshot.graph.edges`                             |
| Timeline                      |     55 | 汇总 `snapshot.timeline` 各实体条目                |
| 核心实体                      |     19 | 与 `backend/app/quality.py` 的核心实体筛选规则一致 |
| 低于 5 条可解释关系的核心实体 |     16 | 按已发布、非冲突且 Evidence 引用完整的边计数       |
| 核心关系总缺口                |     44 | 对上述实体逐个计算 `5 - relationCount`             |

### 低覆盖核心实体

| 实体                   | 类型      | 已发布可解释关系 | 距 5 条的差值 |
| ---------------------- | --------- | ---------------: | ------------: |
| AutoGen                | framework |                1 |             4 |
| CrewAI                 | framework |                1 |             4 |
| Devin                  | agent     |                1 |             4 |
| Manus                  | agent     |                1 |             4 |
| 豆包 Doubao            | model     |                2 |             3 |
| Gemini CLI             | agent     |                2 |             3 |
| Kimi                   | model     |                2 |             3 |
| LangGraph              | framework |                2 |             3 |
| OpenAI Agents SDK      | framework |                2 |             3 |
| OpenAI Codex           | agent     |                2 |             3 |
| 通义千问 Qwen          | model     |                3 |             2 |
| 文心一言 ERNIE Bot     | model     |                3 |             2 |
| Claude Code            | agent     |                3 |             2 |
| Model Context Protocol | framework |                3 |             2 |
| DeepSeek 系列          | model     |                4 |             1 |
| Gemini 系列            | model     |                4 |             1 |

这 44 条是既有质量规则计算出的覆盖差值，不等于必须制造 44 条关系的配额。是否新增关系必须由真实官方 Evidence 决定。

### 已发布关系类型分布

| 当前关系类型     | 数量 |
| ---------------- | ---: |
| `part-of`        |   20 |
| `developed-by`   |   13 |
| `uses`           |   12 |
| `successor-of`   |   11 |
| `benchmarked-on` |   10 |
| `competes-with`  |    6 |
| `based-on`       |    4 |

## 逐 Epic 核查

| Spec 任务项               | 原假设或待核实点                                    | 实际状态                                                                                                                                                                                        | 结论                            |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Epic 1A：Golden Set       | 需要建立 60–100 条、版本化并含 Claim 期望值的评估集 | 已有 `backend/data/golden_questions.json`，仅 20 条；没有 Golden Set 版本、`expected_claim_ids`、独立一键评估脚本或 Recall@8 / Precision@8 结果文件                                             | partially completed             |
| Epic 1A：lexical baseline | 尚未建立检索基线                                    | `20260824_0019` 已落地 PostgreSQL lexical FTS；`golden_questions.py` 已计算检索通过率，但不是 Spec 要求的完整、版本绑定评估                                                                     | partially completed             |
| Epic 1B：实体别名         | 尚未接入别名归一化                                  | Entity schema 与公开数据可带 `aliases`，检索也会读取实体名称信息；没有 `entity_alias` 表、核心实体覆盖证明或前后对照实验                                                                        | partially completed             |
| Epic 1C：Embedding        | 未接入 Embedding                                    | 已有 `EmbeddingProvider`、`VectorClaimIndex`、RRF 混合层与安全降级接口；当前没有生产 provider、版本化 embedding schema、benchmark 或 ADR，配置默认关闭                                          | partially completed             |
| Epic 1D：Reranker         | 尚未实现                                            | 已有 `ClaimReranker` 扩展接口和单元测试；是否投入真实实现必须等待 1C 的 Precision@8 结果                                                                                                        | partially completed / deferred  |
| Epic 2A：关系优先能力     | 关系优先模式是否实现、是否执行过                    | 已实现且已执行固定预算批次；批次 `2026-08-core-relations-01` 为 complete，10/10 成功，4 个候选、2 个重复、0 个自动批准                                                                          | completed                       |
| Epic 2A：可用官方快照     | 是否仍有未使用 snapshot                             | 公开状态 `eligibleSnapshots=0`、`attemptsRemaining=0`；当前瓶颈已转为新的高价值官方 Evidence / Snapshot                                                                                         | completed（核查）               |
| Epic 2A：Ontology 与诊断  | 是否已有证据驱动的本体和诊断交付物                  | 没有 `docs/RELATION_ONTOLOGY.md`、`scripts/diagnose_relation_gaps.py` 或 `docs/eval/source_gap_worklist.md`                                                                                     | not started                     |
| Epic 2B：定向抽取         | 是否可立即继续关系抽取                              | 当前没有剩余合格 snapshot；继续前必须完成 2A，新增付费调用还需用户授权                                                                                                                          | blocked by evidence preparation |
| Epic 3：质量看板          | 是否已有 `/api/quality/metrics` 与 `/quality`       | 已有受保护的 `/api/v2/admin/data-quality` 和审核后台质量信息；没有 Spec 指定的分时间戳聚合 API、公开质量页或评估低频更新机制                                                                    | partially completed             |
| Epic 4：审核数据          | 现有表能否支持统计                                  | `review_jobs` 已有状态、创建/审核时间、审核人、自由文本 `review_reason` 与乐观并发版本；`audit_log` 有动作、对象、JSON 详情和时间。可计算通过率、驳回率、审核耗时，但无法可靠聚合标准化驳回类别 | partially completed             |
| Epic 4：统计展示          | 是否已有 `/api/review/stats` 和统计面板             | 已有审核队列、审计日志和若干质量审计 UI；没有 Spec 指定的审核统计 API，也没有 `reason_category + reason_note` 数据模型                                                                          | not started                     |
| Epic 5：故障场景          | 是否已有高风险覆盖                                  | 已有 LLM 非法输出、Hybrid provider 异常降级、幂等/并发审核等相关测试雏形；没有 `docs/FAILURE_SCENARIOS.md`，Runbook 也未按该清单形成逐项映射                                                    | partially completed             |
| Epic 6：ADR               | 是否已有至少 6 篇指定 ADR                           | 已有架构、Case Study、简历与运行手册文档；没有 `docs/adr` 下的 0001–0006 决策记录，优化曲线也未基于 Spec 1A/1C 的新评估生成                                                                     | not started                     |

## 审核可观测性字段结论

现有 `review_jobs` 可以直接支持：

- 按 `status` 统计通过、驳回和待审数量；
- 用 `created_at` 与 `reviewed_at` 计算已完成审核的耗时；
- 用 `reviewed_by` 区分审核人；
- 保留当前自由文本 `review_reason`；
- 用 `version` 与 `decision_idempotency_key` 支持并发和幂等判断。

现有数据不能可靠支持：

- 标准化的驳回原因分类分布；
- 将历史自由文本无损、确定地回填为固定分类。

因此 Epic 4 后续 migration 只应补充确实缺失的 `reason_category`，并把现有 `review_reason` 迁移或明确重命名为 `reason_note`；不得重复新增已有的状态、时间戳、审核人和并发字段。具体 migration 仍需在轮到 Epic 4 时先核对线上 schema。

## Epic 状态总览与剩余依赖

| 顺序 | Epic                                | 当前状态                              | 下一步                                                 |
| ---: | ----------------------------------- | ------------------------------------- | ------------------------------------------------------ |
|    0 | Reality Check                       | completed（本报告）                   | 将本报告作为后续所有 Epic 的真实输入                   |
|    1 | 1A Golden Set + baseline            | next                                  | 扩展为版本化 Golden Set，并建立确定性 lexical 评估输出 |
|    2 | 2A Ontology / gap / source worklist | pending                               | 只做零费用诊断和官方信源工作清单                       |
|    3 | 1B 别名归一化                       | pending                               | 依赖 1A 基线，做同版本前后对比                         |
|    4 | 1C Embedding / hybrid               | pending authorization and benchmark   | 不调用付费 API，不预选模型                             |
|    5 | 1D Reranker                         | deferred                              | 仅在 1C 显示 Precision@8 确有问题时启动                |
|    6 | 2B 定向关系抽取                     | blocked by evidence and authorization | 先准备 Evidence；付费抽取前再次获得明确授权            |
|    7 | 3 质量看板                          | pending                               | 等 1A/1C 形成可展示指标                                |
|    8 | 4 审核可观测性                      | pending                               | 复用现有字段，仅补标准化原因分类                       |
|    9 | 5 故障场景                          | pending                               | 先盘点现有测试，再补缺口与 Runbook                     |
|   10 | 6 ADR / 作品集                      | pending                               | 最后同步真实实验结果                                   |

## Epic 0 验收结论

- [x] 已核实公开 Entity / Claim / Evidence / Relation / Timeline 计数。
- [x] 已按仓库真实质量算法核实核心实体和关系缺口。
- [x] 已核实关系 backfill 的实现、执行结果与剩余 snapshot 状态。
- [x] 已核实 Embedding / Hybrid / Reranker 的已有扩展接口，避免重复实现。
- [x] 已核实 review / audit 字段的可复用范围与真实缺口。
- [x] 已覆盖 Epic 1–6 的状态与具体数字假设。
- [x] 已把统一强制前缀写入本报告和执行版 Spec。
- [x] 所有无法从公开接口核实的私有数据均明确标为无法核实，没有用公开字段代替。

Epic 0 已达到可执行节点。下一步只能进入 Epic 1A，不得跳到 Embedding、Reranker、关系抽取、质量看板或作品集包装。
