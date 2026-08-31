# Embedding benchmark：@cf/baai/bge-m3

- Provider：`cloudflare`
- 模型版本：`cloudflare-managed:@cf/baai/bge-m3`；维度：1024
- 模型来源：`https://developers.cloudflare.com/workers-ai/models/bge-m3/`
- 模型文件 SHA-256：`API 托管，不适用`
- Golden Set：v1.0.0；TopK=8
- 固定快照：`8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`
- 别名目录：v1.0.0 (`d69625a6a6b17c5e4f1089ecd3a9f2958af2ee89e4860b7044e0cb8985e1fa60`)
- 评测提交：`b7f0d380ef28e528ac5727544848b54450eae2e7`

| 模式 | Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |
| --- | ---: | ---: | ---: | ---: |
| vector | 98.75% | 14.06% | 98.12% | 98.75% |
| hybrid | 100.00% | 14.22% | 98.75% | 100.00% |

- 初始化：0 ms
- 文档向量化：4501 ms（195 条）
- 查询向量化：p50 358.27 ms；p95 783.809 ms
- RSS 增量：37.74 MB；峰值 RSS：105.14 MB
- 模型缓存：0.0 MB；运行前已缓存：False
- API 调用：82；估算费用：$0.00000000

本结果只代表固定快照和当前执行环境，不等同于生产选型结论。
