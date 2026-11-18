# AI Radar API

这是 AI Radar 的可信数据后端：FastAPI、Pydantic、SQLAlchemy 和 Alembic。公开读取与受保护写入严格分开；自动采集和模型抽取不会直接成为公开事实。

运行说明核对：2026-11-18。线上为 Render API 连接 Supabase PostgreSQL；Supabase 承担数据库托管，账户认证由本项目的 FastAPI/JWT/RBAC 实现。本机默认使用独立 SQLite。当前外部服务配置见[部署核对记录](../docs/STAGING_DEPLOYMENT.md#当前部署核对记录)。

## 已实现

- SQLite 本地开发和 PostgreSQL 生产连接。
- 邮箱密码登录、Argon2 密码哈希、短时 JWT、viewer/reviewer/admin RBAC。
- 开发 bootstrap token、审核版本并发控制、发布历史和审计日志。
- 官方信源注册、HTTPS 白名单采集、SSRF 防护、响应大小限制、ETag/Last-Modified。
- 内容快照、SHA-256 去重和 created/updated/unchanged Diff。
- OpenAI-compatible 严格结构化抽取适配器；模型结果固定为 unverified。
- 实体别名消歧、双时间 Claim 冲突检测和 needs-more-evidence 队列。
- 人工批准后才进入公共快照，并向相关关注者生成站内通知。
- 模型系列、具体版本、关系和时间线持久化，首次启动由版本化种子初始化。
- 登录用户关注、通知已读、每日摘要偏好、私密研究和主动公开分享。
- Markdown/PDF 研究输出、邮件 Outbox，以及可选 Resend HTTPS 或 SMTP 投递。
- worker 持久心跳、自动周期历史、管理员运行诊断与容器健康检查。
- 采集和邮件失败的有界指数退避、终态失败重新排队与审计记录。
- 正式数据验收报告与 20 个黄金研究问题。

## 本地启动

以下为 Windows PowerShell 首次配置；需要 Python 3.12。用 `py -0p` 核对已安装版本，默认 `python` 可能指向旧的 Anaconda 环境。命令从仓库根目录开始，统一使用前端 8082、后端 8001。

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 仅在没有本机配置时创建；不会覆盖已有配置。
if (-not (Test-Path -LiteralPath .env)) {
    $localConfig = Get-Content .env.example -Raw
    $localJwtValue = & .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
    $localAdminValue = & .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
    $localConfig = $localConfig.Replace('replace-with-at-least-32-random-bytes', $localJwtValue)
    $localConfig = $localConfig.Replace('replace-with-a-long-random-value', $localAdminValue)
    [IO.File]::WriteAllText((Join-Path $PWD.Path '.env'), $localConfig)
}

# 固定本机库，避免沿用终端里遗留的云端数据库变量。
$env:AI_RADAR_DATABASE_URL = 'sqlite:///' + ((Join-Path $PWD.Path 'data/ai_radar.db') -replace '\\', '/')
$env:AI_RADAR_ENVIRONMENT = 'development'
$env:AI_RADAR_CORS_ORIGINS = 'http://127.0.0.1:8082,http://localhost:8082'
$env:AI_RADAR_DECISION_INTERPRETATION_ENABLED = 'false'
$env:AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE = '0'
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --env-file .env
```

这个终端保持运行。以后重启不用重新创建虚拟环境或复制配置，执行上述环境变量与 Uvicorn 启动部分即可。SQLite 启动逻辑会创建缺少的表并加载种子；代码升级涉及表结构变更时仍应先备份并运行迁移。

前端在第二个终端启动。仓库根目录 `.env.local`：

```text
VITE_API_BASE_URL=http://127.0.0.1:8001
VITE_API_UPSTREAM_URL=http://127.0.0.1:8001
```

在仓库根目录运行 `bun run dev --host 127.0.0.1 --port 8082 --strictPort`，浏览器打开 `http://127.0.0.1:8082`。修改前端环境变量后需要重启前端。两个终端分别按 `Ctrl+C` 停止，SQLite 文件保留；日常使用不要求启动 worker。本机账户与线上账户不自动同步。

Swagger：`http://127.0.0.1:8001/docs`
健康检查：`http://127.0.0.1:8001/health`
就绪检查：`http://127.0.0.1:8001/ready`

`/health` 检查进程存活，`/ready` 增加数据库与运行数据等就绪检查；两者正常不代表所有业务、模型或邮件功能均已验收。

已有本机 `.env` 和 `.venv` 时，也可从仓库根目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-backend.ps1`；该脚本固定本机 SQLite 和上述端口，不负责安装依赖或创建管理员。

模型目录接口：

```text
GET  /api/v2/model-families
GET  /api/v2/model-families/{family_id}/versions
POST /api/v2/model-versions/compare
POST /api/v2/admin/entities
POST /api/v2/admin/relations
POST /api/v2/admin/entities/{entity_id}/timeline
GET /api/v2/admin/sources
PATCH /api/v2/admin/sources/{source_id}
GET /api/v2/admin/integrations
GET /api/v2/admin/operations
GET /api/v2/admin/production-readiness
```

具体版本通过 `familyId` 归属模型系列。管理员可在 `/admin/review` 的目录编辑器中，或使用上述受保护接口补充实体、规格、时间线和 `part-of` / `successor-of` 谱系关系；知识库、详情页、图谱与对比页会自动接入。`verified` 关系和时间线必须包含至少一个 `sourceId`。

信源更新接口支持 `active`、`fetchEnabled` 与 `fetchIntervalMinutes`（120–1440）。管理后台可以登记信源、调整同样的控制项，并从最近快照执行“抽取候选”；候选会进入人工审核队列。停用信源会同时关闭自动采集。即使在页面启用，域名仍必须出现在 `AI_RADAR_FETCH_ALLOWED_HOSTS` 中，worker 才会发起网络请求。

集成状态接口只返回抽取服务、邮件渠道和域名白名单是否就绪，以及模型名、主机名等非敏感标识；任何密钥、密码和完整连接串都不会返回前端。

## 首个管理员

仅当 users 表为空时可执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\bootstrap-staging-admin.ps1 `
  -ApiBaseUrl http://127.0.0.1:8001
```

脚本隐藏输入邮箱以外的密码和初始化令牌，并实际检查创建后能否登录。本机令牌取自本机 `backend/.env`，不要使用线上令牌。然后访问前端 `/account` 或 `/admin/review`。首个用户创建后，初始化接口关闭；不要为重新执行它而删库。

管理员账户创建并验证登录后，应从生产 Secret 中移除 `AI_RADAR_ADMIN_TOKEN` 并重启 API 和 worker。之后仅使用短期 JWT 与角色权限访问管理接口；静态令牌只用于首次初始化或明确的应急恢复窗口。生产上线预检会在静态令牌仍启用时显示安全警告。

从已有 SQLite 开发库切换到 PostgreSQL 时，可安全复制账号及用户拥有的数据；该命令不会覆盖目标库中已有的主键：

```powershell
if (-not (Test-Path -LiteralPath .env.migration)) { throw '先准备并核对独立的目标数据库配置 .env.migration' }
.\.venv\Scripts\python.exe -c "from dotenv import load_dotenv; load_dotenv('.env.migration', override=True); from app.migrate_operational_data import main; main()" `
  --source-url sqlite:///D:/path/to/ai_radar.db
```

迁移前单独准备被 Git 忽略的 `backend/.env.migration`，其中的 `AI_RADAR_DATABASE_URL` 必须是已经备份、完成迁移并核对过的目标 PostgreSQL；不要沿用前面本机启动命令中的 SQLite 地址。命令显式加载该文件并覆盖当前进程继承的同名变量，配置不会写回终端。复制范围为用户、关注、通知、研究记录和邮件 Outbox。目录、Claim、关系和信源由正式种子及审核流水线管理，不从开发库覆盖。

如果 bootstrap 返回“first user is created”，说明本地库已经有账户。不要删除数据库；可在本机终端安全重置已知账户的密码，输入内容不会回显：

```powershell
$env:AI_RADAR_DATABASE_URL = 'sqlite:///' + ((Join-Path $PWD.Path 'data/ai_radar.db') -replace '\\', '/')
.\.venv\Scripts\python.exe -c "from dotenv import load_dotenv; load_dotenv('.env'); from app.manage_users import main; raise SystemExit(main())" reset-password `
  --email your-existing-local-account@example.com
```

## 关键边界

- `AI_RADAR_DATA_MODE=demo` 表示演示数据，不伪装实时。
- 未审核、已拒绝或需要更多证据的 Claim 不会出现在公共快照。
- 抽取供应商未配置时，抽取接口返回 `503`，不会生成假结果。
- 所选邮件渠道未完整配置时，摘要安全停留在 Outbox，投递接口返回 `503`。Resend 不依赖 SMTP 主机，需要自己的 API Key 和发件人。
- 候选抽取与可选模型需求解析分别配置；基础研究不等同于每次都调用外部大模型。
- 自动采集只允许配置的 HTTPS 官方域名，不跟随重定向，不访问私网地址。
- `/api/v2/admin/data-quality` 未通过前，不应宣称达到正式数据验收。

## 自动任务

以下命令在 `backend` 目录运行。Uvicorn 的 `--env-file` 只为自身进程加载配置，不会替另一个终端的 worker、迁移或用户管理命令加载 `.env`。运行自动任务前核对数据库、抓取白名单和外部服务指向的环境；下列命令显式加载该文件。

单次采集：

```powershell
.\.venv\Scripts\python.exe -c "from dotenv import load_dotenv; load_dotenv('.env'); from app.worker import main; main()" --once
```

常驻采集进程：

```powershell
.\.venv\Scripts\python.exe -c "from dotenv import load_dotenv; load_dotenv('.env'); from app.worker import main; main()" --interval-seconds 900
```

Compose 中的 `worker` 服务默认每 900 秒检查一次到期信源；每个信源仍受自己的 120–1440 分钟采集间隔限制。worker 每 30 秒写入持久心跳，最近周期、阶段汇总、积压和非敏感错误可通过 `/api/v2/admin/operations` 或审核后台查看。当前部署契约是单 worker 副本，不应使用 Compose 横向扩容 worker。

采集失败会从 15 分钟开始指数退避，并以信源正常周期和 360 分钟为上限；成功后自动清零失败计数。邮件失败同样按指数退避自动重试，默认最多 5 次，达到上限后才进入终态 `failed`。管理员可明确重新排队某个失败目标，不会重放已经成功的项目：

```text
POST /api/v2/admin/sources/{source_id}/retry
POST /api/v2/admin/email-outbox/{outbox_id}/retry
```

重新排队请求会携带页面刚读取的失败次数；状态已经变化、目标正在处理或已有其他管理员先完成操作时，服务端返回 `409`。采集和邮件发送都使用短时持久租约及随机令牌，避免 worker 与手动操作并发领取同一个目标。

worker 按 `AI_RADAR_DIGEST_TIMEZONE` 和账户设置的时间生成摘要，同一账户同一天最多生成一封。Resend/SMTP 渠道完整配置后才会尝试投递，否则保留在 Outbox。邮件只能提供“至少一次”语义，远端接受、本地标记与收件箱实际送达需要分别核验。

上述是 Compose/本机常驻 worker 的默认周期。当前云端使用 Cron：每 5 分钟保活、30 分钟自动周期，心跳过期阈值配置为 5400 秒；保活不算采集心跳。不要同时启动多个未规划的调度入口。

管理员审核后台包含“生产上线预检”，也可通过 `GET /api/v2/admin/production-readiness` 读取。它自动检查生产环境、正式数据模式、PostgreSQL 迁移、JWT、HTTPS CORS、AI 抽取、邮件渠道、采集白名单、自动信源、数据质量和 worker 心跳。上线前的 `demo` 模式作为切换警告，不计入自动阻塞项；其余自动门禁和人工检查通过后才能切换 `live`，切换后该项必须为 `ready`。公网域名、恢复演练、外部监控和供应商额度仍是必须人工确认的项目。响应只包含状态、计数和操作建议，不返回凭据。

管理员仍可使用以下接口手动触发生成和投递：

```text
POST /api/v2/admin/digests/run
POST /api/v2/admin/email-outbox/send
```

## 验证

```powershell
.\.venv\Scripts\python.exe -m ruff format --check app tests migrations
.\.venv\Scripts\python.exe -m ruff check app tests migrations
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current --check-heads
.\.venv\Scripts\python.exe -m alembic check
```

完整生产步骤见 [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md)。
预发布环境部署见 [STAGING_DEPLOYMENT.md](../docs/STAGING_DEPLOYMENT.md)。
