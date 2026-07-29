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

模型目录接口：

```text
GET  /api/v2/model-families
GET  /api/v2/model-families/{family_id}/versions
POST /api/v2/model-versions/compare
POST /api/v2/admin/entities
POST /api/v2/admin/relations
POST /api/v2/admin/entities/{entity_id}/timeline
```

具体版本通过 `familyId` 归属模型系列。管理员可在 `/admin/review` 的目录编辑器中，或使用上述受保护接口补充实体、规格、时间线和 `part-of` / `successor-of` 谱系关系；知识库、详情页、图谱与对比页会自动接入。`verified` 关系和时间线必须包含至少一个 `sourceId`。

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

使用云调度器或 cron 周期调用；每个信源仍受自己的采集间隔限制。每日摘要通过管理 API 生成和投递：

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
```

完整生产步骤见 [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md)。
