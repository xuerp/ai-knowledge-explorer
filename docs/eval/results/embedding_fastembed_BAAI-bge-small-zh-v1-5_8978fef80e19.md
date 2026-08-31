# Embedding benchmark：BAAI/bge-small-zh-v1.5

- Provider：`fastembed`
- 模型版本：`fastembed-0.8.0+sha256:1294ea4b6331`；维度：512
- 模型来源：`Qdrant/bge-small-zh-v1.5`
- 模型文件 SHA-256：`1294ea4b6331115a353d81f96b85e8c8d7fdcc284453d5b2fab5b016230aad38`
- Golden Set：v1.0.0；TopK=8
- 固定快照：`8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`
- 别名目录：v1.0.0 (`d69625a6a6b17c5e4f1089ecd3a9f2958af2ee89e4860b7044e0cb8985e1fa60`)
- 评测提交：`900e115201738cf8db52ce1319a3f739930e8b74`

| 模式   | Recall@8 | Precision@8 | Entity Recall@8 |  通过率 |
| ------ | -------: | ----------: | --------------: | ------: |
| vector |   85.00% |      12.19% |          89.38% |  83.75% |
| hybrid |  100.00% |      14.22% |          98.75% | 100.00% |

- 初始化：119 ms
- 文档向量化：5821 ms（195 条）
- 查询向量化：p50 3.61 ms；p95 5.823 ms
- RSS 增量：1647.11 MB；峰值 RSS：1715.25 MB
- 模型缓存：90.81 MB；运行前已缓存：True
- API 调用：0；估算费用：$0.00000000

本结果只代表固定快照和当前执行环境，不等同于生产选型结论。
