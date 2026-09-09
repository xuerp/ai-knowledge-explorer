# AI Radar 高风险故障场景覆盖

更新日期：2026-09-01

本文按用户可见风险记录故障注入、期望行为、自动化证明和运行手册入口。测试数量不是验收目标；只有能证明系统在故障下保持数据边界的场景才计入。

## Epic 5 新增覆盖

| 场景 | 风险 | 期望行为 | 自动化证明 | 状态 |
|---|---|---|---|---|
| Embedding 响应缺少 `data` | 上游协议变化导致未处理异常 | 转为不含响应正文的 `EmbeddingProviderError`，Hybrid 安全回退 lexical | `test_cloudflare_provider_rejects_malformed_vectors_without_leaking_payload[missing-data]` | covered |
| Embedding 返回数量不符 | Claim 与向量错位 | 拒绝整批，不写错误映射 | 同一参数化测试 `unexpected-count` | covered |
| Embedding 维度不符 | 余弦计算错误或索引污染 | 拒绝整批并报告安全错误 | 同一参数化测试 `unexpected-dimension` | covered |
| Embedding 含非数字或非有限值 | NaN/Infinity 污染排序 | 标准化阶段拒绝，错误信息不回显 payload | 同一参数化测试 `non-numeric`、`non-finite` | covered |
| 非法审核拒绝分类 | 统计口径漂移 | API 返回 422，候选状态和版本不变 | `test_invalid_rejection_category_does_not_change_review_state` | covered |
| 历史终态缺少或倒置时间 | 统计接口 500 或产生负耗时 | 终态仍计入结果比例；缺时长不进均值，负时长按 0 处理 | `test_review_stats_exclude_missing_durations_and_clamp_negative_history` | covered |
| 两个相反审核决定同时提交 | 重复发布或最终状态与副作用不一致 | `status + version` 原子抢占；一个成功、另一个 409，只有一个终态 | `test_concurrent_conflicting_review_decisions_have_one_terminal_winner`（连续重复运行通过） | covered |

并发测试暴露并修复了 SQLite 不执行 `SELECT FOR UPDATE` 的真实缺口。审核决定现在同时使用数据库行锁和带版本条件的原子 UPDATE，因此 PostgreSQL 与 SQLite 都具备单赢家语义。

## 已有高优先级覆盖盘点

| 场景 | 既有证明 | 期望边界 | 状态 |
|---|---|---|---|
| LLM 返回非法 JSON / schema 外字段 | `test_extraction_json_object_fallback_remains_schema_strict` | 不产生候选，返回可诊断的结构化输出错误 | covered |
| LLM 连接超时、DNS、鉴权、限流 | `test_extraction_probe_distinguishes_connection_timeout`、`test_extraction_probe_distinguishes_dns_failure`、`test_extraction_probe_classifies_provider_failures_without_exposing_response_body` | 分类错误且不泄露响应正文或 Secret | covered |
| 生成式回答引用未检索 Claim 或 schema 非法 | `test_unknown_claim_or_invalid_schema_falls_back_to_extractive` | 回退 extractive，不发布无依据生成内容 | covered |
| 生成 provider 不可用 | `test_generation_provider_error_falls_back_to_extractive` | 返回有引用的 extractive 答案 | covered |
| Embedding provider 不可用 | `test_hybrid_rag_provider_error_falls_back_to_lexical`；Epic 1C 隔离 staging 三段演练 | `retrievalMode=lexical`、`fallbackReason=hybrid-provider-error`，请求仍成功 | covered |
| Embedding 预算耗尽 | `test_cloudflare_provider_blocks_budget_before_network` | 发请求前阻断，不超预算 | covered |
| 批量审核中一项失败 | `test_batch_approve_rolls_back_every_decision_when_one_item_fails` | 整批回滚，不产生部分发布 | covered |
| 同向决定重试 / 反向决定冲突 | `test_approve_publishes_claim_once_and_records_history` | 同向幂等，反向返回 409 | covered |
| 生命周期合并重复提交 | `test_merge_evidence_keeps_one_public_claim_and_is_idempotent` | 幂等键只对应同一决定 | covered |
| 自动周期并发启动 | `test_automation_cycle_lock_rejects_concurrent_local_cycle` | 第二周期被拒绝，不重复采集/抽取 | covered |
| 抓取永久失败与人工恢复 | `test_scheduler_auto_pauses_repeated_permanent_failure_and_retry_resumes` | 达阈值熔断；显式重试后恢复 | covered |
| 邮件发送进程在租约中断 | `test_email_delivery_recovers_expired_sending_lease` | 租约过期后可恢复；保持至少一次语义 | covered |
| 公开统计或快照网络失败 | `review-observability.test.mjs`、`fetch-with-retry.test.mjs` | 有限重试；失败时显示不可用，不伪造数字 | covered |

## 仍需外部演练的边界

- 托管 PostgreSQL 主故障、时间点恢复和跨区恢复属于平台事实，不能由单元测试宣称完成。
- SMTP 远端已经接受邮件但本地提交前崩溃，协议上仍可能重复投递；不得在摘要邮件中放置不可重复副作用。
- Cloudflare 与 Render 同时不可用时只能由外部监控与回滚流程处置；仓库测试只能证明单侧回退和错误可见性。

具体排障与恢复步骤见 [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md#61-高风险故障场景处置)。
