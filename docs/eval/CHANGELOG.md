# 检索评估变更记录

## 2026-08-30：Golden Set v1.0.0 与便携式 lexical 基线

固定版本组合：

- Golden Set：`v1.0.0`，80 条（实体 30、关系 20、时间线 20、对比 10）。
- 数据快照：2026-08-30 公开快照，SHA-256 `8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`。
- 快照计数：Entity 49、Claim 196、Evidence 218、Relation 76、Timeline 55。
- 检索配置：`lexical`，TopK=8，无 Embedding、无 Reranker。
- 数据库方言：SQLite 内存数据库。
- 评估脚本提交：`5e1e10e27ea64bfa796b3f87bb0b2d2e5a8c7987`。

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

该结果保留为跨环境便携基线。隔离 PostgreSQL 16 的最终 lexical FTS 基线见下一节。

## 2026-08-30：PostgreSQL 16 lexical FTS 最终基线

固定版本组合与 SQLite 基线相同；数据库方言改为 `postgresql`，评估脚本提交为 `5e1e10e27ea64bfa796b3f87bb0b2d2e5a8c7987`。评估在 GitHub Actions 的隔离 PostgreSQL 16 service 中执行，运行 `33315912493` 全绿。结构化结果 SHA-256 为 `c414d3056816ecfd93aa910b3e9ca8fa3fd856d2fea1bb85ccb6ee0af266ee81`。

| 范围   | 样本 | Recall@8 | Precision@8 | Entity Recall@8 |  通过率 |
| ------ | ---: | -------: | ----------: | --------------: | ------: |
| 总体   |   80 |   99.38% |      14.06% |          99.38% |  98.75% |
| 实体   |   30 |  100.00% |      12.50% |         100.00% | 100.00% |
| 关系   |   20 |  100.00% |      12.50% |         100.00% | 100.00% |
| 时间线 |   20 |   97.50% |      12.50% |         100.00% |  95.00% |
| 对比   |   10 |  100.00% |      25.00% |          95.00% | 100.00% |

PostgreSQL 与 SQLite 的聚合指标及逐题指标完全一致；5 条样本的 Top-8 Claim 顺序或集合、8 条样本的候选数量不同，但没有造成逐题指标变化。耗时字段属于运行时噪声，不参与该差异统计。两者唯一未完全召回的样本均为 `timeline-015`，未通过删除重复 Claim 或放宽规则处理。

该结果验证的是现有 PostgreSQL lexical FTS，不是 BM25，也不代表生产数据库状态。Epic 1A 至此完成；按 Spec 顺序，下一个主线节点是 Epic 2A 的零费用关系本体、只读诊断与官方信源缺口清单。

## 2026-08-31：实体别名归一化 v1.0.0

固定版本组合与 lexical baseline 完全相同：Golden Set v1.0.0、公开快照 SHA-256
`8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`、TopK=8、
无 Embedding、无 Reranker。别名目录为 v1.0.0，SHA-256
`d69625a6a6b17c5e4f1089ecd3a9f2958af2ee89e4860b7044e0cb8985e1fa60`；评估实现绑定提交
`0ab1c69c8051f8e3b2db5467c6fb6040a7bf0cc9`。

SQLite 的前后主指标如下：

| 范围 | Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |
|---|---:|---:|---:|---:|
| 归一化前 | 99.38% | 14.06% | 99.38% | 98.75% |
| 归一化后 | 99.38% | 14.06% | 99.38% | 98.75% |
| 实体类归一化前 | 100.00% | 12.50% | 100.00% | 100.00% |
| 实体类归一化后 | 100.00% | 12.50% | 100.00% | 100.00% |

主指标没有变化：Golden Set 的 30 条实体查询在 baseline 已达到 100% Entity Recall@8，不能通过
修改样本或口径制造提升。作为同快照的补充覆盖证明，24 条逐别名确定性探针由 16/24 提升为
24/24；它不替代 Golden Set 指标，也不与 Recall@8 混算。完整逐题与逐别名结果保存在
`docs/eval/results/alias_v1.0.0_8978fef80e19_sqlite_top8.json`。

## 2026-08-31：Cloudflare BGE-M3 生产 Hybrid 路径

固定版本仍为 Golden Set v1.0.0、公开快照 SHA-256
`8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`、别名目录 v1.0.0、
TopK=8、RRF K=60。Embedding 为 Cloudflare Workers AI `@cf/baai/bge-m3`，版本标识
`cloudflare-managed:@cf/baai/bge-m3:2026-08-31-baseline`，维度 1024。评估实现绑定提交
`8a6b0b7ac37bf94e715c261bf325b9314e6d2987`。

本次不是 benchmark 内部的向量数组模拟，而是实际执行生产 `CloudflareEmbeddingProvider`、
版本化 `rag_claim_embeddings` 持久索引和 RRF union。结构化结果位于
`docs/eval/results/v1.0.0_8978fef80e19_sqlite_hybrid_cloudflare_-cf-baai-bge-m3_top8.json`，
仓库规范化 LF 内容的 SHA-256 为 `6a789336381864a0a4188cf65eb7c139d8c358cdedb075d607ac776cb8da909e`。

| 阶段 | Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |
|---|---:|---:|---:|---:|
| PostgreSQL lexical FTS baseline | 99.38% | 14.06% | 99.38% | 98.75% |
| Alias v1.0.0 + lexical | 99.38% | 14.06% | 99.38% | 98.75% |
| Cloudflare BGE-M3 + lexical RRF | 100.00% | 14.22% | 98.75% | 100.00% |

Alias 主指标不变，独立的 24 条别名探针由 16/24 提升为 24/24。Hybrid 补回了
`timeline-015` 的重复 Claim，使 Recall@8 与通过率分别提升 0.62 和 1.25 个百分点；同时
Entity Recall@8 下降 0.63 个百分点。80 条查询全部走 hybrid 且无 fallback。端到端查询延迟
p50/p95 约为 409/743 ms；固定工作量共 82 次 API 调用，保守估算 74.9813 Neurons，低于
本次 100 次与 100 Neurons 双重硬上限。

不进入 Epic 1D：大多数题只标注一个相关 Claim，Precision@8 的理论值即 12.5%；14.22% 不能
被解释为明显不足。当前没有证据证明 Reranker 的新增延迟、外部依赖与潜在费用是必要的。
