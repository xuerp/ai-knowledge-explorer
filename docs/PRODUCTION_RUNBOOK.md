# AI Radar 生产运行手册

本文档记录仓库内能够复现的生产部署步骤。在公网托管、域名、SMTP 邮箱和模型供应商尚未配置前，不代表这些外部资源已经存在或已完成上线。

## 1. 准备环境变量与密钥

将 `.env.production.example` 复制为被 Git 忽略的 `.env.production`，然后替换所有必填占位值。以下三个值必须独立生成，不能互相复用：

- `POSTGRES_PASSWORD`：PostgreSQL 数据库密码。
- `AI_RADAR_ADMIN_TOKEN`：首次创建管理员和紧急管理使用的令牌。
- `AI_RADAR_JWT_SECRET`：至少 32 个随机字节，用于签发登录令牌。

同时配置真实前端域名和经过审核的官方信源域名：

```text
AI_RADAR_CORS_ORIGINS=https://你的前端域名
AI_RADAR_FETCH_ALLOWED_HOSTS=openai.com,anthropic.com,ai.google.dev
```

不要将管理员令牌、JWT 密钥或供应商密钥放进任何以 `VITE_` 开头的变量。

## 2. 启动 PostgreSQL、API 与采集 Worker

在仓库根目录执行：

```bash
docker compose --env-file .env.production up --build -d
docker compose --env-file .env.production ps
curl http://127.0.0.1:8000/health
```

`AI_RADAR_API_PORT` 默认是 `8000`。本地迁移演练时可设置为 `8001`，让 PostgreSQL 容器版 API 与旧的 SQLite 开发 API 并行运行。

API 容器会等待 PostgreSQL 健康检查通过，执行 `alembic upgrade head`，然后以非 root 用户启动。持久数据库保存在 `ai_radar_postgres` 命名卷中。

首次启动时，版本控制中的目录种子会初始化模型系列、具体版本、图谱关系、时间线和官方信源。之后在管理后台新增的数据会持久保存，重启不会覆盖已有记录。

Compose 中的 `worker` 服务默认每 900 秒检查一次到期信源。该检查周期可通过 `AI_RADAR_WORKER_INTERVAL_SECONDS` 调整，但不能绕过每个信源自身设置的 120–1440 分钟采集间隔。

已有 SQLite 开发库时，可在 PostgreSQL API 健康后复制用户数据：

```bash
python -m app.migrate_operational_data --source-url sqlite:////本机路径/ai_radar.db
```

迁移工具是可重复执行的增量导入：它会复制用户、关注、通知、研究记录和邮件 Outbox，但不会覆盖目标库中已存在的主键。目录、Claim、关系和审核数据继续由版本种子及审核流水线管理。

## 3. 创建首个管理员

仅当 `users` 表为空时才能执行首次创建：

```bash
curl -X POST http://127.0.0.1:8000/api/v2/auth/bootstrap \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $AI_RADAR_ADMIN_TOKEN" \
  -d '{"email":"你的邮箱","password":"至少十二位的独立强密码"}'
```

首个用户创建后，该接口会返回 `409`。使用管理员 Bearer 令牌调用 `POST /api/v2/admin/users`，可创建审核员或其他用户。

## 4. 连接前端

构建或部署前端时配置：

```text
VITE_API_BASE_URL=https://你的API域名
```

公共读取使用 `/api/v2/snapshot`，旧的 `/api/snapshot` 仍作为兼容别名保留。受保护的管理后台位于 `/admin/review`；登录凭据只发送给 API，短期 Bearer 令牌保存在浏览器 `sessionStorage`。`/admin/review-demo` 是明确标注的只读演示页面。

管理员可在“扩展模型目录”中新增或更新实体、具体版本、关系和时间线。具体版本通过 `familyId` 归属模型系列；可信度为 `verified` 的关系和时间线必须至少关联一个 `sourceId`。

“信源与采集策略”用于登记官方信源、启停信源、控制自动采集以及设置 2–24 小时周期。信源产生快照后，“抽取候选”会调用配置的模型供应商生成候选事实，并放入人工审核队列。

页面上的自动采集开关不能绕过服务器的 `AI_RADAR_FETCH_ALLOWED_HOSTS` 安全白名单。只有经过人工确认的官方域名才能加入白名单。

当前前端使用 Lovable/TanStack 已有的 Cloudflare 构建配置。在托管项目中配置 `VITE_API_BASE_URL` 后再部署生成的 Worker。没有用户的 Cloudflare 或 Lovable 项目权限时，无法仅依靠本仓库完成公网发布。

## 5. 采集、抽取与每日摘要

手动运行一次到期信源采集：

```bash
python -m app.worker --once
```

常驻运行：

```bash
python -m app.worker --interval-seconds 900
```

采集器仅允许 HTTPS 和白名单域名，会阻止私网地址及重定向，限制响应体大小，并支持 ETag 与 Last-Modified 增量检查。

worker 会按照 `AI_RADAR_DIGEST_TIMEZONE`（默认 `Asia/Shanghai`）和每个账户设置的时间自动生成每日摘要。同一账户同一天最多生成一封，并且只收录上一次摘要之后产生的未读通知。

管理员也可以使用 Bearer 令牌手动生成每日摘要：

```text
POST /api/v2/admin/digests/run
```

该操作会在 `email_outbox` 中生成可审计记录。配置 `backend/.env.example` 中的 SMTP 变量后，worker 会自动投递；也可以通过以下接口手动投递：

```text
POST /api/v2/admin/email-outbox/send
```

SMTP 未配置时，投递接口返回 `503`，邮件仍会安全保留在 Outbox 中。

## 6. 备份与恢复

创建 PostgreSQL 逻辑备份：

```bash
docker compose --env-file .env.production exec -T postgres \
  pg_dump -U ai_radar -d ai_radar -Fc > ai-radar.dump
```

必须先在独立测试数据库中验证恢复流程。恢复演练不得覆盖生产数据库。

## 7. 发布前质量门槛

执行完整检查：

```bash
python -m ruff format --check backend/app backend/tests backend/migrations
python -m ruff check backend/app backend/tests backend/migrations
python -m pytest backend/tests
npm run check
```

然后确认：

- `/health` 返回预期的环境、数据库类型和认证状态。
- 公共快照不包含待审核、已拒绝或需要更多证据的 Claim。
- `/admin/review` 拒绝普通 viewer 账户访问。
- 批准一条测试候选后，会生成发布记录、审计日志和关注者通知。
- 通过目录接口新增的具体模型版本，会同时出现在系列版本、时间线、图谱邻居和版本对比中。
- CORS 只包含真实前端域名。
- 所选托管平台已经配置 HTTPS、数据库备份、日志、告警和回滚方案。
- `/api/v2/admin/data-quality` 通过前，不得将演示数据标记为正式完备数据。
