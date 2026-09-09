# ADR-0001：先建立 Lexical 基线，再引入向量检索

- 状态：接受
- 日期：2026-08-30
- 决策者：项目所有者与执行 Agent

## 背景

向量检索会引入模型选型、版本漂移、远端额度、索引同步和安全降级。若没有固定问题集与可复现基线，无法判断它解决了真实召回问题，还是只增加了复杂度。

## 决策

先建立 80 条 Golden Set v1.0.0、固定 snapshot、TopK=8 和 PostgreSQL 16 lexical FTS 基线；Embedding 只能在完全相同输入上做增量对比。Lexical 始终保留为默认或降级路径。

## 证据

PostgreSQL lexical baseline 为 Recall@8 99.38%、Precision@8 14.06%、Entity Recall@8 99.38%、通过率 98.75%。Cloudflare BGE-M3 + lexical RRF 将 Recall@8 与通过率提高到 100%，但 Entity Recall@8 降至 98.75%，说明 Hybrid 是有边界的补充，不是无条件替换。

## 后果

- 任何检索策略变化都必须绑定 Golden Set、snapshot hash、TopK 和代码提交。
- provider 故障时可返回 lexical 结果，而不是让研究接口整体失败。
- 需要同时维护 lexical 文档投影，但换来可复现性和供应商可退出性。
