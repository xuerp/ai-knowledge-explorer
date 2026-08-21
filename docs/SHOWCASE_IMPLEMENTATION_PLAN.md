# AI Radar 作品集版本实施计划

本计划以《AI Radar 产品收敛、作品集化与持续上线开发 Spec v1.1》为唯一产品收敛依据。原则是复用正式领域模型和 API，不为作品集复制数据库、伪造实时数据或降低 Live Gate。

## 差距与处理方式

| 类型 | 内容 |
| --- | --- |
| Existing | Entity、Claim、Evidence、Timeline、Relation、采集、抽取、审核、研究、质量门槛、黄金问题、登录与部署底座 |
| Reuse | 公开知识快照、实体详情、比较组件、研究结果契约、只读审核演示、Cloudflare 同域代理 |
| Modify | 首页信息架构、主导航、Compare 默认对象、未登录 Research、README 与演示脚本 |
| Create | `/case-study`、Showcase 基线、作品集验收、简历与面试材料、核心体验截图 |
| Remove | 首页阻断式 loading、公开体验对登录的非必要依赖、过时的作品集叙事；不删除正式后台能力 |

## Phase 状态

| Phase | 状态 | 验收说明 |
| --- | --- | --- |
| 0 — Baseline | 已完成 | 已记录线上计数、数据模式、版本、来源比例和核心实体覆盖；未知指标不伪造 |
| 1 — Public Homepage | 已完成 | 静态产品叙事不被 API loading 阻断；包含 Latest Changes、核心实体、Why ChatGPT、三种体验和 Trust Layer，线上截图已验收 |
| 2 — Entity / Timeline | 已完成 | 系列与具体版本详情、关键事实、Timeline、Relation、Evidence 已复用；SSR 直连上游，线上 GPT Timeline 已验收 |
| 3 — Compare | 已完成 | 默认 GPT、Claude、Gemini 系列级路线比较，可切换具体版本，底层支持任意可比较模型，线上截图已验收 |
| 4 — Research | 已完成 | 未登录可运行三条预置路径；证据不足时明确拒答；登录后仍使用私密真实研究，线上截图已验收 |
| 5 — Showcase Dataset | 未满足 | 49 个实体不等于 10 个完整实体；需要继续采集、抽取和人工审核，不能靠硬编码勾选 |
| 6 — Review Automation | 已有安全底座 | 风险分级、冲突、去重、批量审核与自动批准门槛已存在；扩大自动批准仍需真实精度样本 |
| 7 — Case Study | 已完成 | 正式公开 `/case-study`，讲清问题、转向、关键决策、风险、取舍与边界，线上截图已验收 |
| 8 — Portfolio Assets | 已完成 | README、5 张核心体验截图、演示脚本、简历和面试材料已统一为最新版产品叙事 |
| 9 — Portfolio Release Gate | 已完成 | 前端 68 项、后端 107 项、SQLite 与 PostgreSQL 迁移、GitHub CI、匿名线上 Smoke 和截图验收均通过 |
| 10 — Production Evolution | 持续 | Claim、关系、黄金问题、SMTP、域名、监控、备份与 Live Mode 不阻塞作品集代码收敛 |

## 风险测试策略

- 单页面和文案：ESLint、TypeScript、针对性契约测试、页面截图。
- 新公开路由：路由树生成、生产构建、匿名浏览器 Smoke。
- Research 行为：预置答案、证据不足拒答、登录分支契约测试。
- Epic 完成：前端完整测试、后端完整测试、Ruff、编译、构建、迁移验证。
- 发布完成：线上首页、Timeline、Compare、Research、Evidence、Case Study、健康接口与缓存边界。

成功测试只保留汇总；只有失败时读取相关测试、堆栈和源代码，避免重复运行无关完整套件。
