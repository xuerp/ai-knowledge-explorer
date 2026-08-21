# AI Radar 生产运行手册

本文档记录仓库内能够复现的生产部署步骤。当前预发布环境已接通 Cloudflare Workers、Render、Neon PostgreSQL、Cloudflare Cron 和结构化抽取供应商；自定义域名、SMTP 邮箱、外部监控和备份恢复演练仍需单独验收。

## 1. 准备环境变量与密钥

将 `.env.production.example` 复制为被 Git 忽略的 `.env.production`，然后替换所有必填占位值。以下三个值必须独立生成，不能互相复用：

- `POSTGRES_PASSWORD`：PostgreSQL 数据库密码。
- `AI_RADAR_ADMIN_TOKEN`：首次创建管理员和紧急管理使用的令牌；正常账户登录验证后应移除。
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
curl http://127.0.0.1:8000/ready
```

`AI_RADAR_API_PORT` 默认是 `8000`。本地迁移演练时可设置为 `8001`，让 PostgreSQL 容器版 API 与旧的 SQLite 开发 API 并行运行。

一次性的 `migrate` 服务会等待 PostgreSQL 健康检查通过并执行 `alembic upgrade head`；成功后 API 与 worker 才会启动，避免多个 API 副本同时负责迁移。API 继续以非 root 用户运行，持久数据库保存在 `ai_radar_postgres` 命名卷中。

首次启动时，版本控制中的目录种子会初始化模型系列、具体版本、图谱关系、时间线和官方信源。之后在管理后台新增的数据会持久保存，重启不会覆盖已有记录。

Compose 中的 `worker` 服务默认每 900 秒检查一次到期信源。该检查周期可通过 `AI_RADAR_WORKER_INTERVAL_SECONDS` 调整，但不能绕过每个信源自身设置的 120–1440 分钟采集间隔。worker 默认每 30 秒写入一次数据库心跳；180 秒内没有新心跳时，容器健康检查和审核后台会将其标记为延迟。当前运行模型明确为单 worker 副本；不要使用 `--scale worker`，后续横向扩容需要独立实例标识和队列分片方案。

审核后台的“自动任务诊断”同时显示最新周期的采集、自动抽取、摘要和邮件投递汇总。其中“待抽取”表示活跃信源的最新快照尚未成功处理，“抽取冷却”表示最近失败且仍处于退避窗口；冷却结束后会自动重新进入待抽取队列。自动抽取只读取已经安全存入数据库的快照，因此不要求信源启用网络自动采集；网络抓取本身仍严格受域名白名单和信源启用状态限制。

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

确认新管理员能够通过 `/api/v2/auth/login` 登录后，从 `.env.production` 或云平台 Secret 中删除 `AI_RADAR_ADMIN_TOKEN`，再重新创建 API 和 worker 容器。Compose 允许该变量为空；删除后旧的 `X-Admin-Token` 立即失效，只保留 JWT 登录与角色权限。需要应急恢复时可以短暂重新设置，但必须记录原因并在操作结束后再次移除。

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

采集和邮件投递都使用有上限的指数退避。采集默认从 15 分钟开始重试，成功后清零连续失败；邮件默认最多自动尝试 5 次，达到上限后进入终态失败。管理员可以只重新排队明确的失败目标：

```text
POST /api/v2/admin/sources/{source_id}/retry
POST /api/v2/admin/email-outbox/{outbox_id}/retry
```

审核后台会自动提交当前看到的失败次数作为并发版本。若目标已经变化、正在处理或被其他管理员先操作，接口返回 `409`，刷新状态后再决定是否重试。采集和邮件投递均通过短时持久租约领取目标，异常退出后会在租约过期时自动恢复。

SMTP 协议只能保证“至少一次”投递。若远端已经接受邮件，但进程在本地提交 `sent` 状态前异常退出，仍可能出现重复邮件；因此摘要内容不应承担支付、授权等不可重复副作用。

## 6. 运行诊断与故障恢复

管理员可在审核后台“自动任务诊断”区域查看最近心跳、最近周期、采集重试、邮件积压和终态失败，也可以调用：

```text
GET /api/v2/admin/operations?recentLimit=20
```

诊断接口只返回计数、时间、状态和截断后的错误，不返回密钥、密码或数据库连接串。常用容器检查命令：

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail 100 worker
docker compose --env-file .env.production exec -T worker python -m app.worker --healthcheck
docker compose --env-file .env.production exec -T api python -m alembic current --check-heads
```

若 worker 心跳延迟，先确认 `/ready` 和 PostgreSQL 正常，再查看 worker 最近日志。重启 worker 不会重放已成功的每日摘要；中断的周期会被记录为失败，新进程会继续处理到期与重试队列。

管理员审核后台还提供“生产上线预检”，对应接口为：

```text
GET /api/v2/admin/production-readiness
```

自动预检覆盖运行环境、正式数据模式、PostgreSQL 迁移、JWT、HTTPS CORS、AI 抽取、SMTP、采集白名单、自动信源、数据质量和 worker 心跳。接口会给出明确阻塞项与下一步，但不会读取或返回任何密钥。公网域名与 HTTPS、备份恢复、外部监控、供应商额度属于外部事实，始终保留为人工确认项，不能仅凭服务自身状态自动宣称完成。

AI 抽取供应商完成配置后，可在审核后台“外部集成状态”点击“验证连接与结构化输出”。预检只发送一个要求返回空事实数组的小请求，用于验证 API 地址、鉴权、额度以及 JSON Schema 支持；它不会读取或返回密钥，不会生成审核候选，也不会修改公开数据。失败结果会区分鉴权、地址、限流、结构化输出不兼容、网络连接和响应格式问题。

`AI_RADAR_DATA_MODE=live` 不是绕过验收门槛的开关。服务在 live 模式启动时会重新计算正式数据质量；若门槛未通过，`/ready` 与公开目录接口返回 `503`，但管理员仍可访问数据质量报告并继续审核、补充 Claim 与关系。只有报告 `liveReady=true` 后，公开正式数据才会恢复服务。

## 7. 备份与恢复

推荐使用仓库内的恢复演练工具。它会创建 PostgreSQL custom-format 逻辑备份，在同一 PostgreSQL 实例中新建名称随机且受限的临时数据库，恢复后核对 Alembic head 以及用户、知识实体、发布记录和信源数量，最后自动删除临时数据库。它不会覆盖源数据库，默认也不会覆盖已有备份文件：

```bash
cd backend
python -m app.backup_drill
```

默认备份写入仓库根目录的 `backups/ai-radar-时间.dump`，并生成同名 `.sha256` 校验文件；该目录已被 Git 忽略。备份仍可能包含用户资料、密码哈希和业务数据，必须按生产敏感数据加密存储、限制访问并设置保留周期。若 Docker CLI 不在 `PATH`，可通过 `--docker` 传入完整路径；容器、数据库和用户名称可分别通过 `--container`、`--database`、`--user` 指定。应在写入较少的维护窗口执行，以免恢复库与持续变化的源库计数出现短暂差异。

仅创建手工逻辑备份时也可使用：

```bash
docker compose --env-file .env.production exec -T postgres \
  pg_dump -U ai_radar -d ai_radar -Fc > ai-radar.dump
```

恢复演练不得覆盖生产数据库。托管平台的自动备份仍需另行配置，并至少完成一次从平台快照恢复到独立实例的演练；本工具不能替代异地备份和平台级灾难恢复。

恢复演练后至少核对迁移版本、用户数量和公开快照可读性：

```bash
docker compose --env-file .env.production exec -T api python -m alembic current --check-heads
curl http://127.0.0.1:8000/ready
curl http://127.0.0.1:8000/api/v2/snapshot
```

## 8. 发布前质量门槛

执行完整检查：

```bash
cd backend
python -m ruff format --check app tests migrations
python -m ruff check app tests migrations
python -m pytest
python -m alembic current --check-heads
python -m alembic check
cd ..
bun run check
```

然后确认：

- `/health` 返回预期的环境、数据库类型和认证状态。
- `/ready` 能实际连接数据库；数据库不可用时返回 `503`。
- `/api/v2/admin/operations` 能看到新鲜 worker 心跳，停止 worker 后会在阈值外变为延迟。
- `/api/v2/admin/production-readiness` 没有自动阻塞项；四项外部人工检查均已留存验收记录。
- 注入瞬时失败时，采集和邮件会按退避时间重试；达到邮件上限后可由管理员明确重新排队。
- 公共快照不包含待审核、已拒绝或需要更多证据的 Claim。
- `/admin/review` 拒绝普通 viewer 账户访问。
- 批准一条测试候选后，会生成发布记录、审计日志和关注者通知。
- 通过目录接口新增的具体模型版本，会同时出现在系列版本、时间线、图谱邻居和版本对比中。
- CORS 只包含真实前端域名。
- 所选托管平台已经配置 HTTPS、数据库备份、日志、告警和回滚方案。
- `/api/v2/admin/data-quality` 通过前，不得将演示数据标记为正式完备数据。

Render 与 Cloudflare 的预发布部署步骤见 [STAGING_DEPLOYMENT.md](./STAGING_DEPLOYMENT.md)。
