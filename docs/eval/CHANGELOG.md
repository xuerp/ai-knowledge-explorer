# 检索评估变更记录

## 2026-08-30：Golden Set v1.0.0 与便携式 lexical 基线

固定版本组合：

- Golden Set：`v1.0.0`，80 条（实体 30、关系 20、时间线 20、对比 10）。
- 数据快照：2026-08-30 公开快照，SHA-256 `8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`。
- 快照计数：Entity 49、Claim 196、Evidence 218、Relation 76、Timeline 55。
- 检索配置：`lexical`，TopK=8，无 Embedding、无 Reranker。
- 数据库方言：SQLite 内存数据库。
- 评估脚本提交：`9f31903262002b30549a0d20a57e57ab4418faa6`。

| 范围   | 样本 | Recall@8 | Precision@8 | Entity Recall@8 |  通过率 |
| ------ | ---: | -------: | ----------: | --------------: | ------: |
| 总体   |   80 |   99.38% |      14.06% |          99.38% |  98.75% |
| 实体   |   30 |  100.00% |      12.50% |         100.00% | 100.00% |
| 关系   |   20 |  100.00% |      12.50% |         100.00% | 100.00% |
| 时间线 |   20 |   97.50% |      12.50% |         100.00% |  95.00% |
| 对比   |   10 |  100.00% |      25.00% |          95.00% | 100.00% |

Precision@8 固定以 8 为分母；大多数题目只有一个标注相关 Claim，因此其理论上限是 12.5%，不能把该数值直接解释成排序质量差。

唯一未完全召回的样本是 `timeline-015`。知识库中存在两条语义重复的 Claude 3.7 Sonnet 可用平台 Claim，Top-8 只返回其中一条，Claim Recall@8 为 50%。这说明发布前语义去重仍有真实缺口；本次没有删除重复标注或放宽通过规则来美化指标。

### 可复现性边界

本次是同一 `LexicalRagRetriever` 在隔离 SQLite 中运行的便携式确定性基线。它没有执行 PostgreSQL `websearch_to_tsquery` / `to_tsvector` 候选过滤，因此不能称为 PostgreSQL lexical FTS 最终基线，也不能与未来 PostgreSQL、Alias、Hybrid 结果直接混为一条曲线。

下一步必须使用同一 Golden Set、同一快照和同一脚本提交，在隔离 PostgreSQL 16 上通过 `--database-url` 重跑并单独记录结果。在此之前，Epic 1A 标记为 partially completed。
