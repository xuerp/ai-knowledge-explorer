# AI Radar 运行与故障处理手册

运行说明核对：2026-11-18。当前线上链路为 Cloudflare Workers → Render API → **Supabase PostgreSQL**，部署参数、外部服务状态与证据边界统一见[当前部署核对记录](STAGING_DEPLOYMENT.md#当前部署核对记录)。本手册先说明日常检查，再提供独立自托管的 Compose 操作；两套数据库与进程分别管理。

## 0. 日常运行与故障定位

访问 [线上网站](https://airadar.rainza.cn) 不需要启动本机程序，也不依赖 Codex 保持打开。本机开发按[后端启动指南](../backend/README.md#本地启动)，统一使用前端 `127.0.0.1:8082`、后端 `127.0.0.1:8001`，SQLite 位于 `backend/data/ai_radar.db`。两个终端分别按 `Ctrl+C` 停止；重启不删除账户和记录。本机与线上不自动同步数据，重启本机不会重启云端。

浏览器操作依次经过前端、API 与数据库。页面初始快照、API 响应和数据库写入成功分别核对；一个页面能显示，不证明登录、保存、抽取等全部正常。

线上只读检查：

```powershell
Invoke-RestMethod 'https://airadar.rainza.cn/version.txt'
Invoke-RestMethod 'https://airadar.rainza.cn/backend/health'
Invoke-RestMethod 'https://airadar.rainza.cn/backend/ready'
```

| 检查结果                               | 优先定位                           | 后续操作                                                    |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| 本机拒绝连接                           | 地址、端口或进程退出               | 核对 8082/8001，查看相应终端错误，再启动对应进程            |
| 前端失败、API `/ready` 正常            | 前端构建、Worker、域名或浏览器缓存 | 本机看 Vite 日志；线上核对前端版本与 Cloudflare 发布        |
| `/health` 正常、`/ready` 失败          | 数据库、迁移或运行数据等就绪条件   | 查看 Render 日志与明确失败原因，不能一律归因为数据库宕机    |
| 同域代理失败、Render `/ready` 直连正常 | Cloudflare 转发、上游地址或链路    | 对照 `.env.staging`、`src/server.ts` 与部署构建模式         |
| 就绪正常、某个操作失败                 | 对应业务接口、输入、权限或外部依赖 | 记录浏览器 Network 中的状态码与接口，再看同一时段的后端日志 |
| 401 / 403 / 422                        | 登录、权限 / 输入校验              | 重新登录对应环境、核对角色或修改具体字段；重启不能增加权限  |
| 500                                    | 服务端处理异常                     | 查看 Traceback，保留复现步骤；重启不能代替修复根因          |

Render 服务为 `ai-radar-api-staging`；在控制台查看 Logs、Events 与 Deploys。故障恢复先核对影响范围，必要时重启现有服务；不要为解决页面错误删除 Supabase 项目、清空表或重置已存在账户。数据库平台和连接信息以当前 Render 配置为准，完整连接串不进入截图、日志或公开讨论。

`/health` 主要检查进程存活；`/ready` 增加数据库与运行数据等检查；二者不替代业务验收。Render Free 可能冷启动、重启或受额度限制，五分钟保活也不提供持续可用性保证。调度按[部署说明](STAGING_DEPLOYMENT.md#5-启用-cloudflare-cron-并保留-github-手动回退)检查实际日志，不能用人工刷新代替无人值守执行证据。

## 1. 准备环境变量与密钥

本节至下一节用于 **独立自托管 Docker Compose**，会创建自己的 PostgreSQL 容器与命名卷；现有 Render/Supabase 环境不通过这组命令启动。日常本机 SQLite 启动按后端指南，不需要 Docker。

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

Compose 的 `AI_RADAR_API_PORT` 默认是 `8000`。同时运行多个实例时分配不冲突的端口；本文本机 SQLite 已使用 8001，不要将另一个容器也绑定到该端口。

一次性的 `migrate` 服务会等待 PostgreSQL 健康检查通过并执行 `alembic upgrade head`；成功后 API 与 worker 才会启动，避免多个 API 副本同时负责迁移。API 继续以非 root 用户运行，持久数据库保存在 `ai_radar_postgres` 命名卷中。

首次启动时，版本控制中的目录种子会初始化模型系列、具体版本、图谱关系、时间线和官方信源。之后在管理后台新增的数据会持久保存，重启不会覆盖已有记录。

Compose 中的 `worker` 服务默认每 900 秒检查一次到期信源。该检查周期可通过 `AI_RADAR_WORKER_INTERVAL_SECONDS` 调整，但不能绕过每个信源自身设置的 120–1440 分钟采集间隔。worker 默认每 30 秒写入一次数据库心跳；180 秒内没有新心跳时，容器健康检查和审核后台会将其标记为延迟。当前运行模型明确为单 worker 副本；不要使用 `--scale worker`，后续横向扩容需要独立实例标识和队列分片方案。

审核后台的“自动任务诊断”同时显示最新周期的采集、自动抽取、摘要和邮件投递汇总。其中“待抽取”表示活跃信源的最新快照尚未成功处理，“抽取冷却”表示最近失败且仍处于退避窗口；冷却结束后会自动重新进入待抽取队列。自动抽取只读取已经安全存入数据库的快照，因此不要求信源启用网络自动采集；网络抓取本身仍严格受域名白名单和信源启用状态限制。

已有 SQLite 开发库时，可在 PostgreSQL 完成备份、迁移且 API 就绪后，按[后端迁移说明](../backend/README.md#首个管理员)复制用户数据。工具在能够访问两套数据库的 Python 环境中运行；显式加载独立目标配置，不能把宿主机 SQLite 地址交给没有挂载该文件的容器，也不能把仅在 Compose 网络内可解析的 `db` 主机名直接用于宿主机。

迁移工具是可重复执行的增量导入：它会复制用户、关注、通知、研究记录和邮件 Outbox，但不会覆盖目标库中已存在的主键。目录、Claim、关系和审核数据继续由版本种子及审核流水线管理。

## 3. 创建首个管理员

仅当 `users` 表为空时才能执行首次创建：

```bash
curl -X POST http://127.0.0.1:8000/api/v2/auth/bootstrap \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $AI_RADAR_ADMIN_TOKEN" \
  -d '{"email":"你的邮箱","password":"至少 6 个字符的独立密码"}'
```

首个用户创建后，该接口会返回 `409`。使用管理员 Bearer 令牌调用 `POST /api/v2/admin/users`，可创建审核员或其他用户。

确认新管理员能够通过 `/api/v2/auth/login` 登录后，从 `.env.production` 或云平台 Secret 中删除 `AI_RADAR_ADMIN_TOKEN`，再重新创建 API 和 worker 容器。Compose 允许该变量为空；删除后旧的 `X-Admin-Token` 立即失效，只保留 JWT 登录与角色权限。需要应急恢复时可以短暂重新设置，但必须记录原因并在操作结束后再次移除。

## 4. 连接前端

本机直连 API 时，浏览器地址与服务端渲染上游都要配置：

```text
VITE_API_BASE_URL=http://127.0.0.1:8001
VITE_API_UPSTREAM_URL=http://127.0.0.1:8001
```

现有 Cloudflare 部署使用 `.env.staging`：浏览器入口是 `/backend`，SSR 上游是 Render HTTPS 地址。修改 `VITE_` 值后要重新启动开发服务器或重新构建部署；只改 Worker 变量不代表编译进 SSR 的地址已经改变。

公共读取使用 `/api/v2/snapshot`，旧的 `/api/snapshot` 为兼容别名。受保护后台位于 `/admin/review`；普通登录令牌保存在 `sessionStorage`。选择记住登录时，带过期时间的会话记录使用 `localStorage`，服务端保留可撤销会话；管理员和审核员仍遵循较短令牌有效期。Service Worker 不缓存登录态与研究正文。`/admin/review-demo` 是只读演示。

管理员可在“扩展模型目录”中新增或更新实体、具体版本、关系和时间线。具体版本通过 `familyId` 归属模型系列；可信度为 `verified` 的关系和时间线必须至少关联一个 `sourceId`。

“信源与采集策略”用于登记官方信源、启停信源、控制自动采集以及设置 2–24 小时周期。证据地址与实际抓取入口可以分开配置，并可登记最多 5 个同机构备用入口；任何入口仍必须经过相同的 HTTPS、白名单、公共 DNS、响应类型和体积校验。信源产生快照后，“抽取候选”会调用配置的模型供应商生成候选事实，并放入人工审核队列。

页面上的自动采集开关不能绕过服务器的 `AI_RADAR_FETCH_ALLOWED_HOSTS` 安全白名单。只有经过人工确认的官方域名才能加入白名单。

当前前端使用 TanStack Start 与 Cloudflare 构建配置。自动发布使用 main 上 Quality 生成的 staging 构建，手动部署同样需要核对构建模式、两个 API 地址与目标域名，步骤见部署说明。`VITE_` 变量均不能保存密钥。

## 5. 采集、抽取与每日摘要

以下命令在 `backend` 目录和已安装依赖的 Python 环境中执行。Compose/Render 已注入环境变量；手动新开终端时需显式加载本机配置，Uvicorn 的 `--env-file` 不会影响另一个进程。运行前核对数据库与外部服务，并单独确认模型或邮件调用权限。普通页面浏览不需要启动 worker。

手动运行一次到期信源采集：

```bash
python -c "from dotenv import load_dotenv; load_dotenv('.env'); from app.worker import main; main()" --once
```

常驻运行：

```bash
python -c "from dotenv import load_dotenv; load_dotenv('.env'); from app.worker import main; main()" --interval-seconds 900
```

采集器仅允许 HTTPS 和白名单域名，会阻止私网地址及重定向，限制响应体大小，并支持 ETag 与 Last-Modified 增量检查。

worker 会按照 `AI_RADAR_DIGEST_TIMEZONE`（默认 `Asia/Shanghai`）和每个账户设置的时间自动生成每日摘要。同一账户同一天最多生成一封，并且只收录上一次摘要之后产生的未读通知。

管理员也可以使用 Bearer 令牌手动生成每日摘要：

```text
POST /api/v2/admin/digests/run
```

该操作会在 `email_outbox` 中生成可审计记录。托管环境优先使用 HTTPS 邮件 API：

```dotenv
AI_RADAR_EMAIL_PROVIDER=resend
AI_RADAR_EMAIL_API_KEY=在部署平台 Secret 中配置
AI_RADAR_EMAIL_API_URL=https://api.resend.com/emails
AI_RADAR_SMTP_FROM=AI Radar <radar@your-domain.example>
```

`AI_RADAR_SMTP_FROM` 是两种投递渠道共用的发件人字段。传统 SMTP 仍可作为回退；不要同时在仓库、前端变量或日志中保存邮件密钥。配置完成后 worker 会自动投递，也可以通过以下接口手动投递：

```text
POST /api/v2/admin/email-outbox/send
```

所选邮件渠道未完整配置时，投递接口返回 `503`，邮件仍会安全保留在 Outbox 中。

采集和邮件投递都使用有上限的指数退避。采集默认从 15 分钟开始重试，成功后清零连续失败；HTTP 401/403、不安全跳转、白名单错误或不支持内容等永久性错误连续 3 次后会自动熔断，不再无限重试。管理员更换抓取入口或明确重新排队后会解除熔断。邮件默认最多自动尝试 5 次，达到上限后进入终态失败。管理员可以只重新排队明确的失败目标：

```text
POST /api/v2/admin/sources/{source_id}/retry
POST /api/v2/admin/email-outbox/{outbox_id}/retry
```

审核后台会自动提交当前看到的失败次数作为并发版本。若目标已经变化、正在处理或被其他管理员先操作，接口返回 `409`，刷新状态后再决定是否重试。采集和邮件投递均通过短时持久租约领取目标，异常退出后会在租约过期时自动恢复。

邮件投递只能保证“至少一次”语义。HTTPS 渠道会使用基于 Outbox ID 的幂等键降低重复风险，但若供应商已接受邮件、进程却未能提交本地 `sent` 状态，仍需按供应商保留期核验；因此摘要内容不应承担支付、授权等不可重复副作用。

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

自动预检覆盖运行环境、正式数据模式、PostgreSQL 迁移、JWT、HTTPS CORS、AI 抽取、邮件投递、采集白名单、自动信源、数据质量和 worker 心跳。上线前保持 `demo` 会显示为切换警告，不计入自动阻塞项，从而可以先确认其余门禁，再执行一次明确的 `live` 切换；切换后的正式实例必须显示该项为 `ready`。邮件未配置时显示 Outbox 模式警告，不计入自动阻塞项；系统仍会持久化摘要且不会伪装已发送。接口会给出明确阻塞项与下一步，但不会读取或返回任何密钥。公网域名与 HTTPS、备份恢复、外部监控、供应商额度属于外部事实，始终保留为人工确认项，不能仅凭服务自身状态自动宣称完成。

AI 抽取供应商配置后，审核后台的“验证连接与结构化输出”会发送一个模型请求，可能产生费用；它不是无需外部调用的状态读取。获得对应调用授权后再运行，用于检查地址、鉴权、额度和 JSON Schema 支持；不会返回密钥、生成审核候选或修改公开资料。文档与配置核对不自动触发此探针。

`AI_RADAR_DATA_MODE=live` 不是绕过验收门槛的开关。服务在 live 模式启动时会重新计算正式数据质量；若门槛未通过，`/ready` 与公开目录接口返回 `503`，但管理员仍可访问数据质量报告并继续审核、补充 Claim 与关系。只有报告 `liveReady=true` 后，公开正式数据才会恢复服务。

### 6.1 高风险故障场景处置

以下步骤按“先确认边界、再恢复服务、最后决定是否重放”执行。日常检查分别确认服务、接口和前台行为；单次请求成功不能替代外部连续观测或真实邮件送达验证。

#### LLM 结构化抽取非法或供应商不可用

1. 先读取“外部集成状态”和既有错误记录；确需新结构化输出探针时先确认调用预算。记录 `errorCode`，不要复制供应商响应中的敏感内容或 Secret。
2. `structured_output_unsupported` 表示 JSON Schema 不兼容；只有 JSON Object 兼容模式也通过严格 schema 校验时才能继续。
3. `authentication`、`rate_limited`、`connection_timeout`、`dns_resolution_failed` 分别检查凭据权限、供应商额度、Render 出站连接和 API 域名。
4. 失败快照保持待抽取或进入冷却，不会生成审核候选。修复后只重跑明确的 snapshot，不扩大批次。

#### Embedding 服务不可用或响应非法

1. 查看研究记录的 `retrievalMode` 与 `fallbackReason`。`hybrid-provider-error` 表示请求已安全回退 lexical；HTTP 200 不等于 Hybrid 正常。
2. 在受保护集成状态核对 provider、model、dimension 和预算；不要在日志或工单粘贴 Token、响应正文或向量。
3. `unexpected result count`、`unexpected embedding dimension`、`non-numeric` 或 `non-finite` 均视为上游协议故障，不写入向量索引。保持 lexical 服务，修正配置或等待供应商恢复。
4. 需要真实查询或 Golden Set 重测时先核对单独授权和硬预算。授权后的请求须确认 `retrievalMode=hybrid` 且 `fallbackReason=null`；离线回放只能诊断，不替代真实请求验证。

#### 审核并发、版本冲突与批量回滚

1. 409 表示另一审核决定或版本更新已经抢占；刷新候选，核对当前 `status`、`version` 和审计记录，不直接重放反向决定。
2. 同向重复决定可作为幂等成功读取；相反决定必须由新业务流程创建，不能覆盖既有终态。
3. 批量接口任一项失败时整批回滚。刷新队列后缩小到明确安全的候选集合，不逐条猜测补发。
4. 若发现同一候选出现多个终态副作用，立即停止审核写入，核对 `publication_history`、`audit_log` 和数据库迁移版本；不要手工删除记录掩盖问题。

#### 审核统计异常

1. 先比较 Render `/api/review/stats` 与 Cloudflare 同域 `/backend/api/review/stats`；前者正常而后者失败时检查 Worker 上游绑定和 staging 构建模式。
2. 历史 `reason_category` 为空必须显示 `uncategorized`，不得从自由文本猜测回填。
3. 终态缺少 `reviewed_at` 时仍计入通过/驳回率，但不计入平均时长；倒置时间按 0 秒处理并作为历史数据质量问题另行审计。
4. 页面接口失败时应显示“不可用”，不能用演示数字或上次数字冒充实时统计。

#### 前端与 API 分阶段发布

1. 当前 main 发布由 Quality 等待前后端检查通过，再通过私密 Render 钩子部署同一完整提交。目标版本数据库迁移完成且 `/ready` 就绪后，发布 Cloudflare。Render Git 自动部署关闭，钩子保存在 GitHub Actions 的 `RENDER_STAGING_DEPLOY_HOOK` Secret。独立 Staging acceptance 等待两端版本一致并检查代理。缺少钩子或后端未就绪时发布任务失败。手动处置需核对目标 commit、staging 构建与工作流依赖。配置步骤见[部署说明](STAGING_DEPLOYMENT.md#6-验收顺序)。
2. 部署后同时验证 `/backend/health`、`/backend/api/review/stats` 和浏览器水合后的统计面板；只检查 SSR HTML 不足以证明客户端查询成功。
3. 若构建模式错误，立即用正确 staging build 覆盖，不把上传成功当作验收成功。

## 7. 备份与恢复

### 7.1 当前 Supabase 托管库

先在 Supabase 控制台核对该项目实际套餐、自动备份和时间点恢复能力；不能因为服务商提供此功能就宣称当前项目已启用。需要逻辑备份时，按 [Supabase 连接说明](https://supabase.com/docs/guides/database/connecting-to-postgres)选择适用的直接连接，使用 PostgreSQL 客户端 `pg_dump --format=custom --file=备份路径`，通过客户端隐藏密码提示或私密凭据文件认证，避免把密码放进命令历史。

Windows 下不要把旧版 PowerShell 的二进制重定向当作通用备份方法，使用 `pg_dump` 的 `--file` 输出。备份文件应在仓库外受控保存。恢复到独立项目或数据库，核对迁移版本、用户与研究记录、公开快照和权限，再记录演练结果。连接地址、备份创建、恢复可用和业务数据完整是不同的检查；本次文档核对没有运行云端备份或恢复。

### 7.2 独立 Compose 库

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
