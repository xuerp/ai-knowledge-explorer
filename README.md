# AI Radar

AI Radar 是面向 AI 模型、Agent、框架、论文和 Benchmark 的时序知识图谱。产品以“变化、关系、时间和证据”为中心，不把演示数据、模型猜测或未审核候选伪装成事实。

## 当前交付

前端已包含：

- 首页、知识库、六段式实体详情、系列/具体版本比较、关系图谱和三种阅读模式。
- 证据化研究界面、私密研究页、公开分享、Markdown 和打印/PDF。
- 关注、通知、个性化、PWA、离线状态和中英双语。
- `/admin/review-demo` 只读作品集后台。
- `/account` 真实登录账户，连接持久化关注、通知、邮件偏好和研究。
- `/admin/review` 真实 reviewer/admin 工作台。

后端已包含：

- FastAPI/Pydantic/SQLAlchemy/Alembic，SQLite 和 PostgreSQL。
- JWT/RBAC、审计日志、人审门禁和不可重复发布。
- 数据库化模型系列、具体版本、关系与时间线；管理员可增量维护，前端自动读取。
- 安全采集、内容快照/Diff、严格结构化模型抽取、实体消歧和冲突检测。
- 关注者通知、每日摘要 Outbox、SMTP 适配器、私密研究和主动公开分享。
- Docker Compose、PostgreSQL CI 迁移验证、正式数据质量报告和黄金问题集。

## 在线预发布环境

- 前端：<https://ai-radar-staging.1966761779.workers.dev>
- API：<https://ai-radar-api-staging.onrender.com>
- 数据库：Neon PostgreSQL
- 定时任务：Cloudflare Worker `ai-radar-cron-staging`，每小时第 17 分钟运行
- 质量门禁：GitHub Actions 同时验证前端、后端、SQLite 与 PostgreSQL 迁移

当前环境按生产方式部署，但公共数据继续保持 `demo/cached` 标记。公开快照包含 49 个实体、23 条 Claim、40 条证据、71 条关系和 55 条时间线；在 150 条已审核 Claim 和核心实体关系覆盖真实达标前，不切换为 `live`。

## 本地运行

前端要求 Node.js 22 和 Bun 1.3.14：

```bash
bun install --frozen-lockfile
bun run dev
```

后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --env-file .env
```

前端 `.env`：

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

不配置 API 时，公开产品使用明确标记的本地 demo adapter；配置后 API 失败会显示错误，不会静默回退成“实时数据”。

## 主要入口

| 路径                   | 用途                                   |
| ---------------------- | -------------------------------------- |
| `/`                    | 个性化变化和行业必看                   |
| `/knowledge`           | 分类浏览                               |
| `/knowledge/model/gpt` | 六段式实体档案                         |
| `/graph`               | 可解释的关系查询图谱、邻域、路径与来源 |
| `/ask`                 | 登录后基于已发布 Claim 的私密研究；未登录明确显示演示引导 |
| `/following`           | 登录后持久化关注、通知和摘要偏好；未登录明确显示演示体验 |
| `/account`             | 真实登录、关注、通知、摘要和私密研究   |
| `/admin/review-demo`   | 只读审核演示                           |
| `/admin/review`        | 真实受保护审核工作台                   |

`/admin/review` 的“扩展模型目录”支持新增模型系列、具体版本、关系和时间线。具体版本使用 `familyId` 归属系列，因此以后增加 GPT、Claude、Gemini、DeepSeek、Qwen 等细分版本时无需重写页面。

## 质量检查

```bash
bun install --frozen-lockfile
node scripts/export-demo-snapshot.mjs
bun run check
bun run prepare:cloudflare:staging
cd backend
python -m ruff format --check app tests migrations
python -m ruff check app tests migrations
python -m compileall -q app tests migrations
python -m pytest
python -m alembic upgrade head
python -m alembic current --check-heads
python -m alembic check
```

详细资料：

- [生产运行手册](docs/PRODUCTION_RUNBOOK.md)
- [架构说明](docs/ARCHITECTURE.md)
- [Spec 追踪](docs/SPEC_TRACEABILITY.md)
- [3 分钟演示](docs/DEMO_SCRIPT.md)
- [后端说明](backend/README.md)

## 仍需外部资源的事项

预发布前端、API、Neon PostgreSQL、Cloudflare Cron 和结构化抽取供应商已经接通。以下事项仍需要外部账号、域名或运维决策，不能在仓库内伪造：

- SMTP/事务邮件账号、已验证发件域和送达率配置。
- 自定义域名，以及正式域名下的 DNS 与证书验收。
- 外部监控、告警接收人和备份恢复演练。
- 将当前 23 条已发布 Claim 扩展到 150 条，并补齐 17 个核心实体约 49 条关系缺口所需的正式研究与人工审核。
- 若把 Cron 从每小时调整为每 30 分钟，需要先确认供应商调用额度和额外模型费用。
