# Embedding 候选 Benchmark

状态：已完成；provider 选型进入 ADR-0005

评估日期：2026-08-31

## 不可变输入与口径

- Golden Set：v1.0.0，80 条。
- 快照 SHA-256：`8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`。
- 别名目录：v1.0.0，SHA-256 `d69625a6a6b17c5e4f1089ecd3a9f2958af2ee89e4860b7044e0cb8985e1fa60`。
- TopK=8，RRF K=60；hybrid 使用 PostgreSQL lexical FTS 对应检索逻辑与向量 Top-32 的并集做 Reciprocal Rank Fusion，不使用 Reranker。
- 正式本地结果绑定评测提交 `900e115201738cf8db52ce1319a3f739930e8b74`。
- 结构化结果：`embedding_fastembed_BAAI-bge-small-zh-v1-5_8978fef80e19.json`，SHA-256 `12a01238870ee08e138df98c3f8b69db4ed0a402acfee3ec73d383a6fb0c2723`。

指标仍按 1A 的规则计算。Precision@8 固定以 8 为分母，不能脱离每题标注 Claim 数量解释。资源数据只代表本次 Windows CPU 环境，不代表 Render 实例。

## 候选与执行状态

| 候选                                                          | 类型                  | 维度 | 状态       | 选择原因或阻塞                                                                  |
| ------------------------------------------------------------- | --------------------- | ---: | ---------- | ------------------------------------------------------------------------------- |
| `BAAI/bge-small-zh-v1.5`                                      | 本地 FastEmbed CPU    |  512 | 已完成     | 中文模型、MIT；用于验证零 API 成本路线                                           |
| `@cf/baai/bge-m3`                                             | Cloudflare Workers AI | 1024 | 已完成     | 多语言模型；Workers Free 每日免费配额；OpenAI-compatible Embeddings             |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | 本地 FastEmbed CPU    |  384 | 未执行     | 约 220MB 下载连续两次未通过当前环境的自动权限审查；没有把权限超时记录为模型失败 |
| `text-embedding-3-small`                                      | OpenAI API            |  512 | 范围内取消 | 项目所有者无法使用付费账户，明确改用无需付款的 API 候选                          |
| DoroAI                                                       | OpenAI-compatible 网关 | 未知 | 不可执行   | 用户确认新 Base URL 为 `https://doro.lat/v1`，但控制台未提供可识别的 Embedding 模型 |

候选资料：

- [BGE-small-zh-v1.5 模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5)
- [FastEmbed 支持模型表](https://qdrant.github.io/fastembed/examples/Supported_Models/)
- [OpenAI text-embedding-3-small 模型页](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [OpenAI Embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)

## 已完成的本地真实结果

| 模式                      | Recall@8 | Precision@8 | Entity Recall@8 |  通过率 |
| ------------------------- | -------: | ----------: | --------------: | ------: |
| Alias 后 lexical baseline |   99.38% |      14.06% |          99.38% |  98.75% |
| BGE 纯向量                |   85.00% |      12.19% |          89.38% |  83.75% |
| BGE + lexical RRF hybrid  |  100.00% |      14.22% |          98.75% | 100.00% |

BGE 的纯向量结果弱于 lexical；RRF hybrid 在固定样本上补回了 `timeline-015`，但 Entity Recall@8 从 99.38% 降至 98.75%。这只是候选实验结果，不足以在 API 候选缺席时宣布选型，也不代表 hybrid 已上线。

### 本地资源观测

| 项目                |                                                               结果 |
| ------------------- | -----------------------------------------------------------------: |
| 模型文件 SHA-256    | `1294ea4b6331115a353d81f96b85e8c8d7fdcc284453d5b2fab5b016230aad38` |
| 模型缓存            |                                                           90.81 MB |
| 已缓存初始化        |                                                             119 ms |
| 195 条文档向量化    |                                                           5,821 ms |
| 单条查询 p50 / p95  |                                                   3.610 / 5.823 ms |
| 峰值 RSS / RSS 增量 |                                             1,715.25 / 1,647.11 MB |
| API 调用 / 费用     |                                                         0 / 0 美元 |

约 1.72GB 的进程峰值 RSS 是当前 Render 部署适配的显著风险。不能因为模型文件只有约 90MB 或 API 费用为零，就把它视为生产默认选择。

## Cloudflare API 真实结果

Cloudflare 结果绑定评测提交 `b7f0d380ef28e528ac5727544848b54450eae2e7`。结构化结果为
`embedding_cloudflare_-cf-baai-bge-m3_8978fef80e19.json`，SHA-256
`405a440b7c5b76ce28ac412dfd533fcb2693c4e33d73dea30c113a741a713761`。

| 模式                     | Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |
| ------------------------ | -------: | ----------: | --------------: | -----: |
| Cloudflare BGE-M3 纯向量 |   98.75% |      14.06% |          98.12% | 98.75% |
| BGE-M3 + lexical RRF     |  100.00% |      14.22% |          98.75% |   100% |

纯向量只有 `entity-006` 未召回目标 Claim；hybrid 80 条全部通过。Cloudflare 响应未返回
`prompt_tokens`，因此不能把该字段的 0 解读成没有输入。脚本按字符数作为 token 保守上界：69,750，
对应估算 74.9813 Neurons；共 82 次调用，低于执行前设置的 100 Neurons 与 100 次调用双重上限。

Cloudflare 官方 Free allocation 是每日 10,000 Neurons；本报告只证明请求量处于免费配额范围，
不能代替账户账单。项目所有者未开通付费路径，超出免费层时应失败而非产生付费调用。

### Cloudflare 资源观测

| 项目                 | 结果 |
| -------------------- | ---: |
| 195 条文档向量化     | 4,501 ms |
| 单条查询 p50 / p95   | 358.270 / 783.809 ms |
| 峰值 RSS / RSS 增量  | 105.14 / 37.74 MB |
| API 调用             | 82 |
| 估算 Neurons / 上限  | 74.9813 / 100 |

与本地 BGE 相比，Cloudflare 显著降低应用进程内存，但引入网络延迟、外部服务依赖和托管模型别名漂移风险。

## 选型结论

- staging hybrid 选择 Cloudflare Workers AI `@cf/baai/bge-m3`，使用与当前 Claim 检索单元一致的独立版本化 `rag_claim_embeddings` 表。
- 生产默认仍保持 PostgreSQL lexical FTS；只有 staging 验证通过后才允许开启 `RETRIEVAL_MODE=hybrid`。
- 任一凭证、预算、超时或 provider 错误都自动降级到 lexical，并记录结构化告警。
- 本地 `BAAI/bge-small-zh-v1.5` 保留为离线复现候选，不作为 Render 默认 provider。
- OpenAI 与 DoroAI 不再是本轮阻塞项；前者因付款约束取消，后者因没有可验证的 Embedding 模型取消。

详细决策见 `docs/adr/0005-embedding-model-selection.md`。

## 外部 API 执行保护

固定输入共 195 条文档和 80 条查询，总字符数 69,750。Cloudflare 路径默认拒绝外部 API，只有同时满足以下条件才会调用：

1. 项目所有者明确授权本次免费层 benchmark；
2. `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN` 在本地环境配置，不进入聊天、日志或结果；
3. 显式传入 `--allow-external-api`；
4. 全量保守预估不超过 100 Neurons 且不超过 100 次 API 调用。

保护已在第一次网络请求前通过，真实调用与结果校验均已完成。Benchmark 节点至此完成；下一节点是 ADR 与版本化 Schema。

## 生产路径闭环

选型后的生产实现已按同一固定输入重跑：实际使用 `CloudflareEmbeddingProvider`、版本化
`rag_claim_embeddings` 索引与 RRF union，80 条查询全部走 hybrid，无 fallback；Recall@8
100.00%、Precision@8 14.22%、Entity Recall@8 98.75%、通过率 100.00%。结构化结果为
`v1.0.0_8978fef80e19_sqlite_hybrid_cloudflare_-cf-baai-bge-m3_top8.json`，SHA-256
`1e3b3f40eebc194c8d023dc4ed804be1e255638a5cab5c62b8f5e8790e2eaf21`，评估实现绑定提交
`8a6b0b7ac37bf94e715c261bf325b9314e6d2987`。

完整 Baseline → Alias → Hybrid 曲线及不投入 Reranker 的判定见 `docs/eval/CHANGELOG.md`。
