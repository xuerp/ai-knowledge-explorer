# 当前数据质量与检索评估

本轮输入冻结于 2026-11-07：263 个对象、518 条事实、731 条证据。这里只验证本站已发布资料的检索，不代表今天重新核验了全部外部来源，也不是生成答案准确率或全产品验收。

## 数据与题集

- [v2 题集](retrieval_golden_set.v2.jsonl)：100 题，30 道对象事实、20 道关系、20 道时间线、10 道比较、20 道留出题（未参与本轮检索调优）。在查看任何检索分数前冻结；哈希和固定分母见 [清单](golden-v2-manifest.json)。
- [当前公开快照](snapshots/public_snapshot_2026-11-07.json)：预期事实必须已发布、标记 verified，且来源 ID 可解析。
- [旧题漂移审计](legacy-v1-annotation-audit-20261107.json)：保留原来全部 80 题；67 题引用了已不存在的事实 ID，另有 6 题的保留 ID 对应文本已改变。同一 ID 不证明原来的结论仍成立。
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
python scripts/eval_hybrid_retrieval.py --snapshot docs/eval/snapshots/public_snapshot_2026-11-07.json --golden-set docs/eval/retrieval_golden_set.v2.jsonl --alias-catalog backend/data/entity_aliases_v1.json --output-dir artifacts/retrieval-v2-hybrid --preflight-only
```

预检为 514 个可索引事实和 100 个查询，共最多 106 次请求，UTF-8 字节加输入余量的 token 上界为 314801，估算 338.4111 Neurons。手动工作流限制为 106 次、350 Neurons，不自动重试。只有本次额度/费用授权后才可启用 Bounded retrieval evaluation 的 allow_embedding_calls；默认关闭。它只写隔离 PostgreSQL，不连接应用数据库。运行前核对实际服务的检索代码与配置；不匹配则在模型调用前停止。

实际报告经 scripts/publish_quality_metrics.py 校验快照哈希、标注存在性、TopK 和逐题汇总后，发布为 backend/data/quality_evaluation.json。原报告留在 backend/data/quality_evaluation_history。新增报告必须保留逐题 JSON、执行提交、时间和配置，不手改汇总成绩。
