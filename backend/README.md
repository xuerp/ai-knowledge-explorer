# AI Radar API

这是 AI Radar 的可信数据后端：FastAPI、Pydantic、SQLAlchemy 和 Alembic。公开读取与受保护写入严格分开；自动采集和模型抽取不会直接成为公开事实。

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
- Markdown 研究输出、邮件 Outbox 和可选 SMTP 投递。
- worker 持久心跳、自动周期历史、管理员运行诊断与容器健康检查。
- 采集和邮件失败的有界指数退避、终态失败重新排队与审计记录。
- 正式数据验收报告与 20 个黄金研究问题。

## 本地启动

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --env-file .env
```

前端根目录 `.env`：

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Swagger：`http://127.0.0.1:8000/docs`
健康检查：`http://127.0.0.1:8000/health`
就绪检查：`http://127.0.0.1:8000/ready`

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
```

具体版本通过 `familyId` 归属模型系列。管理员可在 `/admin/review` 的目录编辑器中，或使用上述受保护接口补充实体、规格、时间线和 `part-of` / `successor-of` 谱系关系；知识库、详情页、图谱与对比页会自动接入。`verified` 关系和时间线必须包含至少一个 `sourceId`。

信源更新接口支持 `active`、`fetchEnabled` 与 `fetchIntervalMinutes`（120–1440）。管理后台可以登记信源、调整同样的控制项，并从最近快照执行“抽取候选”；候选会进入人工审核队列。停用信源会同时关闭自动采集。即使在页面启用，域名仍必须出现在 `AI_RADAR_FETCH_ALLOWED_HOSTS` 中，worker 才会发起网络请求。

集成状态接口只返回抽取服务、SMTP 和域名白名单是否就绪，以及模型名、主机名等非敏感标识；任何密钥、密码和完整连接串都不会返回前端。

## 首个管理员

仅当 users 表为空时可执行：

```powershell
$headers = @{ "X-Admin-Token" = "你的 AI_RADAR_ADMIN_TOKEN" }
$body = @{
  email = "admin@example.com"
  password = "至少十二位的独立强密码"
} | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:8000/api/v2/auth/bootstrap" `
  -Method Post -Headers $headers -ContentType "application/json" -Body $body
```

然后访问前端 `/account` 或 `/admin/review`。

从已有 SQLite 开发库切换到 PostgreSQL 时，可安全复制账号及用户拥有的数据；该命令不会覆盖目标库中已有的主键：

```powershell
python -m app.migrate_operational_data `
  --source-url sqlite:///D:/path/to/ai_radar.db
```

目标库默认读取 `AI_RADAR_DATABASE_URL`，复制范围为用户、关注、通知、研究记录和邮件 Outbox。目录、Claim、关系和信源由正式种子及审核流水线管理，不从开发库覆盖。

如果 bootstrap 返回“first user is created”，说明本地库已经有账户。不要删除数据库；可在本机终端安全重置已知账户的密码，输入内容不会回显：

```powershell
.\.venv\Scripts\python.exe -m app.manage_users reset-password `
  --email local-admin@example.com `
  --new-email your-real-email@example.com
```

## 关键边界

- `AI_RADAR_DATA_MODE=demo` 表示演示数据，不伪装实时。
- 未审核、已拒绝或需要更多证据的 Claim 不会出现在公共快照。
- 抽取供应商未配置时，抽取接口返回 `503`，不会生成假结果。
- SMTP 未配置时，摘要安全停留在 Outbox，投递接口返回 `503`。
- 自动采集只允许配置的 HTTPS 官方域名，不跟随重定向，不访问私网地址。
- `/api/v2/admin/data-quality` 未通过前，不应宣称达到正式数据验收。

## 自动任务

单次采集：

```powershell
.\.venv\Scripts\python.exe -m app.worker --once
```

常驻采集进程：

```powershell
.\.venv\Scripts\python.exe -m app.worker --interval-seconds 900
```

Compose 中的 `worker` 服务默认每 900 秒检查一次到期信源；每个信源仍受自己的 120–1440 分钟采集间隔限制。worker 每 30 秒写入持久心跳，最近周期、阶段汇总、积压和非敏感错误可通过 `/api/v2/admin/operations` 或审核后台查看。当前部署契约是单 worker 副本，不应使用 Compose 横向扩容 worker。

采集失败会从 15 分钟开始指数退避，并以信源正常周期和 360 分钟为上限；成功后自动清零失败计数。邮件失败同样按指数退避自动重试，默认最多 5 次，达到上限后才进入终态 `failed`。管理员可明确重新排队某个失败目标，不会重放已经成功的项目：

```text
POST /api/v2/admin/sources/{source_id}/retry
POST /api/v2/admin/email-outbox/{outbox_id}/retry
```

重新排队请求会携带页面刚读取的失败次数；状态已经变化、目标正在处理或已有其他管理员先完成操作时，服务端返回 `409`。采集和邮件发送都使用短时持久租约及随机令牌，避免 worker 与手动操作并发领取同一个目标。

worker 也会按照 `AI_RADAR_DIGEST_TIMEZONE` 和每个账户保存的发送时间生成每日摘要，同一账户同一天最多生成一封。SMTP 已配置时自动投递；未配置时安全保留在 Outbox。SMTP 只能提供“至少一次”投递语义：远端已接收而本地状态尚未提交时，极端故障仍可能造成重复邮件。

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
