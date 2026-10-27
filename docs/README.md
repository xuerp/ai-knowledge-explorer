# AI Radar 文档索引

当前项目入口：[项目案例](portfolio/CASE_STUDY.md) · [真实资料](portfolio/real-data/README.md) · [运行步骤](portfolio/WALKTHROUGH.md) · [验证记录](portfolio/VALIDATION.md)

项目与生产验收范围分别记录，历史评测不代表当前状态。

## 文档权威顺序

发生冲突时按以下顺序判断：

1. 用户当前明确指令与外部《AI Radar 完善 Spec v2》。
2. `PROJECT_COMPLETION_SPEC.md`：当前剩余工作、顺序、授权和验收。
3. `AI_RADAR_IMPROVEMENT_SPEC_V2_EXECUTION.md`：Epic 历史、红线和完成证据。
4. 代码、自动化测试、GitHub Quality 和已部署精确 commit。
5. `PRODUCTION_RUNBOOK.md`、`STAGING_DEPLOYMENT.md` 和 `ARCHITECTURE.md`。
6. ADR 与带日期的 eval 报告；它们记录当时证据，不代表当前运行状态。
7. 产品路线图和项目介绍；它们不能授权运行时写操作。

任何未列入 Git 的临时交接文档都不能作为项目状态源。

## 当前执行文档

- `DECISION_MODULE_REASSESSMENT_SPEC_20261016.md`：最新用户要求的决策助手全模块重估与整改规格，包含定位、状态合同、UI、完整操作和逐项验收；实施状态单独记录，不继承历史完成声明。
- `DECISION_REASSESSMENT_EXECUTION_20261016.md`：本轮服务端建议、原页澄清、修订、导出和 P01–P20 工程验收；区分本地证据、发布门禁与真实业务效果。

- `RELEASE_SYNC_20261014.md`：此次源码、公开资料与公网版本同步的范围、验证及回滚点。
- `DECISION_PRODUCT_ACCEPTANCE.md`：决策助手的产品完成标准及未解决边界。
- `DECISION_GENERAL_USE_20261016.md`：面向通用用户的完成边界、按需渠道约束、样本表单和草稿恢复验收。
- `DECISION_FIRST_USE_ACCEPTANCE_20261016.md`：21 个自然问法的前后对照、共享识别规则、具体要求核验及首次访问到保存重开的实际验收。
- `DECISION_TASK_COVERAGE_20261016.md`：六道完整原题、实际资料缺口、既有来源复用、Dify 审核启用和条件建议的验收。
- `DECISION_FIRST_USE_20261014.md`：首次使用路径、实际界面验证及自动实测的能力边界。
- `AUTOMATIC_API_TRIALS.md`：本地批量 API 试测、费用预览、执行确认和私人结果回填。
- `DECISION_FOLLOWUP_20261015.md`：依赖安全、渠道资料与自动试测的当前验收范围。

- `PROJECT_COMPLETION_SPEC.md`：从当前 staging 收束到可信交付的唯一执行清单。
- `../PRODUCT_ROADMAP.md`：最新产品设计规划、页面体验、跨页面闭环和验证指标；不授予运行时写入或发布权限。
- `AI_RADAR_IMPROVEMENT_SPEC_V2_EXECUTION.md`：Spec v2 执行历史与红线。
- `PRODUCT_DIAGNOSIS_AND_IMPROVEMENT.md`：当前产品诊断和非授权性建议。
- `PRODUCTION_RUNBOOK.md`：故障、恢复和人工检查。
- `STAGING_DEPLOYMENT.md`：staging 架构与部署要求。
- `ARCHITECTURE.md`：系统边界和数据闭环。
- `END_TO_END_OPERATING_MODEL.md`：用户任务、可信数据、审核、决策和发布的端到端运行地图；不授予外部写入权限。
- `RELATION_ONTOLOGY.md`：关系合法取值与证据约束。
- `FAILURE_SCENARIOS.md`：高风险故障覆盖。

## 设计与项目材料

- `PORTFOLIO_CASE_STUDY.md`
- `PORTFOLIO_ACCEPTANCE.md`
- `DEMO_SCRIPT.md`
- `ENTITY_ALIAS_NORMALIZATION.md`

这些文件可以说明设计和结果，但不能覆盖当前执行状态。

## 决策与评估证据

- `adr/`：已接受的架构决策。
- `eval/`：固定快照、评估结果、诊断和带日期的历史核查。

评估文件必须保留原始时间、commit、配置和数据范围。历史结果不得改写成当前线上状态。

## 文档维护规则

1. 当前状态只在现有权威文档中原位更新，不创建 `FINAL`、`V2_FINAL`、`NEW` 等重复副本。
2. 已完成实施计划若没有持续参考价值，应删除；需要保留的历史证据放入 `eval/` 并明确日期。
3. API 示例必须与 FastAPI 路由和 Pydantic schema 对照；写接口至少有一个自动化契约测试。
4. 命令必须注明执行目录、Shell、必需参数和是否产生写操作。
5. 不在文档中放置 Secret 示例值、真实令牌、数据库连接串或可复用凭证。
6. staging 和 production 必须分别命名，不能因后端 `environment=production` 就把 staging 服务称为正式生产。
7. 指标是验证对象，不得通过造数据、放宽审核或重复调参实现“达标”。

## 已清理的旧文档类型

以下内容已从当前版本删除，因为已经被实现、替代或包含不可执行命令：

- 旧的剩余问题、RAG、阅读模式、信源治理和 Showcase 实施 Spec；
- 旧 Showcase 基线和重复 Spec 追踪表；
- 错误的数据质量操作手册与项目状态报告；
- 过期 UI 阶段总结和部署交接文档。

需要追溯时使用 Git 历史，不要把旧文件重新当作当前执行指令。
