# Embedding 候选 Benchmark

状态：进行中，尚未形成 provider 选型结论

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

| 候选                                                          | 类型               |     维度 | 状态             | 选择原因或阻塞                                                                  |
| ------------------------------------------------------------- | ------------------ | -------: | ---------------- | ------------------------------------------------------------------------------- |
| `BAAI/bge-small-zh-v1.5`                                      | 本地 FastEmbed CPU |      512 | 已完成           | 中文模型、MIT；FastEmbed 官方支持表记录约 90MB 的量化 ONNX 包                   |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | 本地 FastEmbed CPU |      384 | 未执行           | 约 220MB 下载连续两次未通过当前环境的自动权限审查；没有把权限超时记录为模型失败 |
| `text-embedding-3-small`                                      | OpenAI API         | 计划 512 | 等待明确费用授权 | 官方支持 Embeddings endpoint 和可选维度；不在未授权状态下发起调用               |

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

## API Benchmark 执行门

固定输入共 195 条文档和 80 条查询，总字符数 69,750。按每字符一 token 的保守上界、OpenAI 官方当前每百万输入 token 0.02 美元计算，本次 `text-embedding-3-small` 费用上界约为 0.001395 美元。执行时仍设置 0.01 美元硬上限；脚本默认拒绝 API，只有同时满足以下条件才会调用：

1. 项目所有者明确授权本次付费 benchmark；
2. `OPENAI_API_KEY` 已在本地环境安全配置，不在聊天或日志中传递；
3. 显式传入 `--allow-paid-api --monthly-budget-usd 0.01`；
4. 保守费用预估未超过硬上限。

API 结果完成前，不选 provider、不写 0005 ADR 结论、不做生产 Schema migration，也不把 Epic 1C 标记为 completed。
