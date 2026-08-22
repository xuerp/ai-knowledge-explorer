# AI Radar 作品集版本基线

记录日期：2026-08-21。基线提交：`65dd98a`。记录时分支为 `codex/productionize`，工作区干净，且本地 HEAD 与 `origin/codex/productionize` 一致。

## 公开环境

- 前端：<https://ai-radar-staging.1966761779.workers.dev>
- API：<https://ai-radar-api-staging.onrender.com>
- 后端版本：`2026.08.22-review-source-freshness-v50`
- 运行环境：`production`
- 数据模式：`demo`
- 快照新鲜度：`cached`
- 定时任务：Cloudflare Cron，每 30 分钟一次

## 公开数据基线

| 指标 | 当前值 | 作品集/正式门槛说明 |
| --- | ---: | --- |
| 实体 | 49 | 已达到正式图谱总量参考范围，但完整度比总量更重要 |
| 已发布 Claim | 23 | 正式门槛 150，仍差 127 |
| Evidence | 40 | 其中 34 条为官方来源，公开证据官方来源比例为 85% |
| Relation | 71 | 17 个核心实体仍存在约 49 条关系缺口 |
| Timeline | 55 | 总量可展示，但核心实体深度不均衡 |
| 预置研究问题 | 3 | 作品集要求提供稳定、可解释的公开研究路径 |

公开接口没有暴露人工核验率和黄金问题得分；对应管理接口受鉴权保护。本基线不读取管理员令牌，也不伪造这两个数值。正式发布前必须由已有管理员会话执行数据质量与黄金问题报告。

## Showcase 核心实体覆盖

以下统计来自公开快照。Claim 只统计明确绑定 `entityId` 的已发布 Claim；Timeline、Relation 与来源按实体聚合。

| 实体 | Claim | Timeline | Relation | 可追溯来源 | 官方来源 |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT | 0 | 8 | 14 | 12 | 7 |
| Claude | 0 | 4 | 8 | 6 | 5 |
| Gemini | 0 | 2 | 4 | 2 | 2 |
| DeepSeek | 0 | 2 | 4 | 2 | 0 |
| Qwen | 0 | 2 | 3 | 2 | 1 |
| MCP | 3 | 1 | 2 | 6 | 6 |
| LangGraph | 0 | 1 | 1 | 0 | 0 |
| AutoGen | 0 | 1 | 1 | 0 | 0 |
| CrewAI | 0 | 1 | 1 | 0 | 0 |
| Manus | 0 | 1 | 1 | 0 | 0 |
| Devin | 0 | 1 | 1 | 0 | 0 |

这意味着产品架构和公开体验可以进入作品集收敛，但“至少 10 个完整 Showcase 实体”的数据标准尚未真实满足。不得通过降低 Evidence、Claim 或人工审核门槛来勾选该项。

## 工程基线

- 前端：React、TanStack Router/Start、TypeScript、Cloudflare Workers。
- 后端：FastAPI、Pydantic、SQLAlchemy、Alembic、PostgreSQL。
- 质量门禁：前端测试、ESLint、TypeScript、生产构建；后端 Ruff、编译、Pytest；SQLite/PostgreSQL 迁移验证。
- 最近一次基线门禁：GitHub Quality 通过；前端 63 项、后端 107 项测试通过。

## 基线结论

- `Showcase UX`：已有核心页面，但基线首页产品叙事、公开 Case Study 和未登录 Research 体验仍需收敛。
- `Showcase Dataset`：可以演示，但核心实体完整度未达到 Spec 的全部勾选标准。
- `Live Ready`：明确未达到，继续保持 `demo/cached`。
- `外部资源`：SMTP、正式域名、外部监控、备份恢复演练仍需外部账号或授权。
