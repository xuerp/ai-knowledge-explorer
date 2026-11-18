# AI Radar 文档索引

[在线体验](https://airadar.rainza.cn/) · [项目 README](../README.md)

- [产品案例](portfolio/CASE_STUDY.md)：项目做了什么、为何这样设计，以及两个实际修复案例。
- [验证记录](portfolio/VALIDATION.md)：已验证的操作、评估证据和未完成事项。
- [系统架构](ARCHITECTURE.md)与[架构决策 ADR](adr/)：公共资料、审核与个人研究的边界。
- [检索评估协议](eval/CURRENT_PROTOCOL.md)：题集、固定快照、指标和适用范围。现库状态可查看[数据质量页](https://airadar.rainza.cn/quality)。

启动与运维见[后端配置](../backend/README.md)、[当前部署与配置核对](STAGING_DEPLOYMENT.md#当前部署核对记录)和[故障处理与运行手册](PRODUCTION_RUNBOOK.md)。线上使用 Supabase PostgreSQL，本机开发默认使用独立 SQLite；数据库平台、运行参数和核对日期以部署说明为入口，不从旧评测或本机环境文件推断云端现状。产品与资料维护另有[决策验收标准](DECISION_PRODUCT_ACCEPTANCE.md)、[关系定义](RELATION_ONTOLOGY.md)、[别名规则](ENTITY_ALIAS_NORMALIZATION.md)、[目录覆盖](CORE_MODEL_COVERAGE.md)和[本地 API 试测指南](AUTOMATIC_API_TRIALS.md)。

2026-11-18 已重新核对当前运行与发布说明；历史评测和 ADR 保留原始日期。功能验收记录继续由 `product/delivery-status.json` 生成，修改文档日期不能替代新一轮业务验收。

临时日志、私有回执、草稿和一次性脚本放在仓库外或被忽略的 `artifacts/`；发布文档保留便于理解或复现的材料。
