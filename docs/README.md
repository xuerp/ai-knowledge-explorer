# AI Radar 文档索引

[在线使用](https://ai-radar.xue-ai.workers.dev/) · [项目 README](../README.md) · [当前验证记录](portfolio/VALIDATION.md)

## 使用与部署

- [运行与使用步骤](portfolio/WALKTHROUGH.md)
- [后端配置与启动](../backend/README.md)
- [预发布部署](STAGING_DEPLOYMENT.md)
- [运行与恢复手册](PRODUCTION_RUNBOOK.md)
- [本地 API 试测](AUTOMATIC_API_TRIALS.md)：有费用和数据传输的操作需显式授权。

## 架构与产品合同

- [系统架构](ARCHITECTURE.md)
- [端到端数据与用户流程](END_TO_END_OPERATING_MODEL.md)
- [架构决策 ADR](adr/)
- [决策助手验收标准](DECISION_PRODUCT_ACCEPTANCE.md)
- [决策助手需求与交互规格](DECISION_MODULE_REASSESSMENT_SPEC_20261016.md)：需求基线，不代表实施状态。
- [关系建模](RELATION_ONTOLOGY.md)
- [故障场景](FAILURE_SCENARIOS.md)

## 当前状态与数据

- [项目说明](portfolio/CASE_STUDY.md)
- [验证结果及未完成事项](portfolio/VALIDATION.md)
- [目录覆盖报告](CORE_MODEL_COVERAGE.md)
- [本轮来源复核](portfolio/DATA_REVIEW_20261029.md)
- [线上用户流程验证](portfolio/WORKFLOW_VERIFICATION_20261029.md)
- [测试索引](../backend/tests/README.md)

当前状态统一来自 `product/delivery-status.json`，由 `npm run sync:delivery-status` 同步到公开说明。代码实现、测试、线上部署和业务效果分别报告。

## 历史资料与生成产物

- [历史实施与验证记录](archive/README.md)：按日期保留，非当前状态；归档不改变原报告的验证范围。
- [历史评估](eval/)：保留原始快照、配置和结果，仅用于相应版本的复现。
- `DECISION_SEMANTIC_FROZEN_12H_20261007.json` 与 `model-spec-enrichment-20261005.json` 是现行测试输入，保留原路径，不作为运行日志归档。

原始运行回执写入被 Git 忽略的 `artifacts/` 或 CI artifacts。只有经检查、不含私人数据且有持续复核价值的报告才进入文档；不新建 `FINAL`、`V2_FINAL` 等重复状态文件。

文档不能授予外部操作权限。用户当前明确要求优先；运行和授权仍以实际配置及明确授权为准。
