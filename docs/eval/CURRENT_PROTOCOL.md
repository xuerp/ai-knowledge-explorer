# 当前数据质量与检索评估

本轮输入冻结于 2026-11-07：263 个对象、518 条事实、731 条证据。这里只验证本站已发布资料的检索，不代表今天重新核验了全部外部来源，也不是生成答案准确率或全产品验收。

## 数据与题集

- [v2 题集](retrieval_golden_set.v2.jsonl)：100 题，30 道对象事实、20 道关系、20 道时间线、10 道比较、20 道留出题（未参与本轮检索调优）。在查看任何检索分数前冻结；哈希和固定分母见 [清单](golden-v2-manifest.json)。
- [当前公开快照](snapshots/public_snapshot_2026-11-07.json)：预期事实必须已发布、标记 verified，且来源 ID 可解析。
- [旧题漂移审计](legacy-v1-annotation-audit-20261107.json)：保留原来全部 80 题；67 题引用了已不存在的事实 ID，6 题包含保留 ID 但文本已改变的情况（其中 1 题也包含缺失 ID，两类不可直接相加）。同一 ID 不证明原来的结论仍成立。
- v1 原题、原快照与原始报告全部保留。v2 是新的当前库基准，分数不能当成同一题集的提升或下降。

## 计算规则

| 指标            | 分子与分母                                                 | 限制                                                                    |
| --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Recall@8        | 每题前 8 条中命中的标注事实数 / 该题标注事实总数，再取平均 | 只评价固定标注                                                          |
| Precision@8     | 每题命中的标注事实数 / 固定 8 个位置，再取平均             | 不足 8 条仍除以 8；未标注结果不等于不相关；目标少于 8 条时上限低于 100% |
| Entity Recall@8 | 检索结果经过既有模型家族扩展后的预期对象覆盖率，再取平均   | 不是严格的具体版本命中率                                                |
| 标注全命中率    | 找全所有标注事实的题数 / 全部题数                          | 不是答案正确率                                                          |

所有失败题和实际返回 ID 都保留。先运行无模型请求的 lexical 基线，PostgreSQL 结果由 CI 隔离数据库产生。SQLite 仅为便携基线，不能代替 PostgreSQL 的 FTS 路径。当前线上 hybrid 需要同配置的独立测试；不得用 lexical 成绩冒充。

## 更新与适用范围

业务指标在请求时从当前库计算。页面打开、切回窗口和停留期间每 5 分钟重新读取；刷新不调用模型、不自动重跑评估。业务时间显示库记录更新时间，评估时间显示实际执行时间。

引用覆盖只说明来源 ID 可解析；官方来源是库内类型标记；有审核时间只说明 verifiedAt 非空；180 天内采集按 collectedAt 计算并排除未来时间；已核验内容统计 confidence=verified 的事实、关系、时间线记录。以上均不替代独立人工复核。

v2 使用内容指纹核对库，忽略请求 meta 和自动生成的 graph.capturedAt。事实、来源与图谱内容变化仍会失效。另核对检索代码指纹、数据库方言、模式、embedding provider/model/version/dimension。报告提交继续作为来源记录；仅发布报告引起的提交变化不会自我作废。旧报告缺少这些指纹时维持历史状态。

## 执行和发布

无费用预检：

```bash
python scripts/eval_hybrid_retrieval.py --snapshot docs/eval/snapshots/public_snapshot_2026-11-07.json --golden-set docs/eval/retrieval_golden_set.v2.jsonl --alias-catalog backend/data/entity_aliases_v1.json --output-dir artifacts/retrieval-v2-hybrid --preflight-only --canary-first
```

预检为 1295 条按实际索引 ID 去重后的文档（包含事实、时间线和关系）、100 个查询和 1 条未计分接口小样本。文档按长度排序，批次同时受 100 条和补齐后保守 token 上界 48000 限制（低于模型的 60000 上限）；结果恢复原文档顺序。实际输入 token 上界为 730666，连批次补齐开销也计入后为 780800，估算 839.36 Neurons；共 18 个文档批次和 119 次请求。预检与执行共用分批函数，预算按相同补齐上界预留。

手动工作流限制为 119 次、850 Neurons，不自动重试。这比此前授权的 114 次多 5 次，需要新一轮明确授权后才可启用 Bounded retrieval evaluation 的 allow_embedding_calls；默认关闭。它只写隔离 PostgreSQL，不连接应用数据库。运行前核对实际服务的检索代码与配置；不匹配则在模型调用前停止。

实际报告经 scripts/publish_quality_metrics.py 校验快照哈希、标注存在性、TopK 和逐题汇总后，发布为 backend/data/quality_evaluation.json。原报告留在 backend/data/quality_evaluation_history。新增报告必须保留逐题 JSON、执行提交、时间和配置，不手改汇总成绩。

## 本轮结果与未完成项

SQLite 与隔离 PostgreSQL 的 100 题基线均为 Recall@8 99%、Precision@8 13.63%、家族扩展 Entity Recall@8 99%、标注全命中率 98%。两道 Gemini 多版本比较题未找全标注，失败明细保留。真实 hybrid 尝试的首个 Cloudflare 请求返回 HTTP 401 后停止，未完成任何题，也没有重试或产生 hybrid 分数。

GitHub 部署令牌能够列出既有账户，但不证明它具有模型推理权限；401 的具体凭据原因尚未确认。Cloudflare 官方说明专用 Workers AI REST 令牌需要 Workers AI Read 和 Edit 权限（https://developers.cloudflare.com/workers-ai/get-started/rest-api/）。随后已按用户授权创建独立的七天评估令牌并加密存入专用 GitHub Secret，没有更改部署令牌。

页面的最新尝试状态由原始失败记录派生。发布时给 scripts/publish_quality_metrics.py 传入 --latest-attempt、--attempt-artifact-path 和 --attempt-status-output product/retrieval-evaluation-status.json；后续成功复测同样更新该状态，不能遗留旧的失败提示。CI 会核对当前报告、原始逐题数据及页面尝试状态一致。

第二次已授权尝试使用独立的七天 Workers AI Read/Edit 评估令牌，2026-11-07 16:29（北京时间）首批返回 HTTP 400 后停止，0 题完成。旧适配器未保留上游错误正文，不能确认 400 的精确原因；官方原生模型 schema 只读核对已完成。后续适配器改用该模型文档中的原生 /ai/run 路径和 text/data 契约，并保留脱敏错误码与消息；须先通过独立的未计分接口小样本，再开始固定 100 题。小样本计入同一调用和 Neuron 硬上限，题集分母仍为 100。没有新的明确授权不会再次调用模型。

第三次授权尝试于 2026-11-07 17:08（北京时间）停止：原生接口小样本成功，随后首个文档批次返回 HTTP 400 / 8007，明确报告 89800 tokens 超过模型 60000 上限。实际尝试 2 次请求，0 题完成，未重试。[原始脱敏证据](results/v2.0.0_932525db2c4f_postgresql_hybrid_failed_20261107_1708.json)保留。此前按条数分批并逐条累加 token 的预检遗漏了批次补齐限制；修复后同时约束补齐后的上下文与预算。小样本成功证明当前专用凭据及原生路径可用，不证明全量评估通过。[官方模型规格](https://developers.cloudflare.com/workers-ai/models/bge-m3/)列出了 60000 token 上限。
