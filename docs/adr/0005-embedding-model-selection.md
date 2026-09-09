# ADR-0005：Embedding 模型与版本化存储

- 状态：接受，用于 staging
- 日期：2026-08-31
- 决策者：项目所有者与执行 Agent

## 背景

Epic 1C 要求在固定 Golden Set 上比较检索质量、延迟、资源和部署成本，再决定 provider。项目不能使用需要付款的 OpenAI API；DoroAI 当前控制台没有可验证的 Embedding 模型。经项目所有者确认，API 候选改为 Cloudflare Workers AI 免费层。

## 证据

固定输入为 Golden Set v1.0.0、公开快照 SHA-256 `8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`、TopK=8、RRF K=60。

| 候选/模式 | Recall@8 | Precision@8 | Entity Recall@8 | 查询 p95 | 进程峰值 RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| lexical baseline | 99.38% | 14.06% | 99.38% | 不适用 | 不适用 |
| 本地 BGE 纯向量 | 85.00% | 12.19% | 89.38% | 5.823 ms | 1,715.25 MB |
| 本地 BGE hybrid | 100.00% | 14.22% | 98.75% | 5.823 ms | 1,715.25 MB |
| Cloudflare BGE-M3 纯向量 | 98.75% | 14.06% | 98.12% | 783.809 ms | 105.14 MB |
| Cloudflare BGE-M3 hybrid | 100.00% | 14.22% | 98.75% | 783.809 ms | 105.14 MB |

完整证据与结果哈希见 `docs/eval/embedding_benchmark.md`。

## 决策

1. staging 的 hybrid provider 选择 Cloudflare Workers AI `@cf/baai/bge-m3`。
2. 生产默认保持 `RETRIEVAL_MODE=lexical`；staging 验证通过前不启用 hybrid。
3. 本地 `BAAI/bge-small-zh-v1.5` 只保留为离线复现候选，不进入当前 Render 默认路径。
4. Embedding 使用独立 `rag_claim_embeddings` 表，而不是在 Evidence 表上增加固定维度列。现有检索与 benchmark 的排序单元是 `rag_claim_documents`（Claim 与其 Evidence 组成的可信文档），因此表以 `claim_id` 关联该投影，并保存 provider、模型、版本、维度、内容哈希、向量和生成时间。`claim_id + provider + model + version` 形成唯一约束。
5. Cloudflare 的托管模型 ID 不是不可变权重版本。每条记录仍保存 `embedding_version=cloudflare-managed:@cf/baai/bge-m3`、生成时间与内容哈希；基准报告绑定评测提交和执行日期，模型漂移时必须重跑评估并创建新版本标识。
6. provider 凭证缺失、预算不足、超时、限流、响应维度异常或任何远端错误时，查询自动降级到 lexical，并记录不含凭证的结构化告警。
7. 免费层调用设置应用侧 Neuron 与请求数硬上限。没有项目所有者的新授权，不得切换为付费路径。

## 理由

Cloudflare BGE-M3 的 hybrid 指标与本地 BGE 相同，但应用进程峰值内存低约 1.61GB，更适合当前 Render 资源约束。代价是约 0.36–0.78 秒的单查询向量生成延迟和外部依赖，因此 lexical 必须保持默认与降级路径。当前 hybrid 相对 lexical 只补回一个重复 Claim 场景，不能据此承担无保护的生产依赖。

## 后果

- 需要 Alembic migration 创建版本化独立表。当前知识库只有约 200 个可检索 Claim，向量以维度无关的 JSON 存储并在应用层计算余弦相似度；若规模增长后改为 pgvector，模型版本元数据和唯一约束保持不变。
- 需要 Cloudflare provider、向量索引同步和 RRF 查询路径。
- staging 必须显式设置 hybrid 开关；默认配置不得意外调用外部 API。
- 需要在评估 CHANGELOG 中记录 Baseline → Alias → Hybrid 的真实曲线。
