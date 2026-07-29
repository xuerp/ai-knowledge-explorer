# AI Radar API

这是 AI Radar 的第一条真实后端纵向闭环。它提供经过强类型校验的公共知识快照、实体和图谱查询，以及受管理令牌保护的人工审核与发布接口。

当前数据仍是明确标记的演示种子。经过 HTTP API 不会自动变成“实时事实”；只有将真实采集接入并显式配置 `AI_RADAR_DATA_MODE=live` 后，API 才会返回 live 模式。

## 已实现

- FastAPI 与 Pydantic v2 API 契约。
- SQLAlchemy 2 持久化和 Alembic 初始迁移。
- SQLite 本地开发数据库；数据库 URL 可替换为 PostgreSQL。
- 公共快照自动隔离待审核和已拒绝 Claim。
- 管理令牌保护的审核队列、批准、拒绝和发布历史。
- 审核版本号乐观并发控制，重复决定返回 `409`。
- 没有证据的 Claim 不允许发布。
- 实体搜索、详情、时间线、邻域和图谱过滤查询。
- CORS 白名单，不允许浏览器携带任意来源凭据。

## 本地启动

先在项目根目录导出演示种子：

```powershell
node scripts/export-demo-snapshot.mjs
```

创建隔离环境并安装依赖：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

复制 `backend/.env.example` 为一个不会提交的本地文件，替换长随机管理令牌。然后执行迁移并启动：

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --env-file .env
```

API 文档：

- Swagger UI：`http://127.0.0.1:8000/docs`
- OpenAPI JSON：`http://127.0.0.1:8000/openapi.json`
- 健康检查：`http://127.0.0.1:8000/health`

前端根目录 `.env`：

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

真实 API 请求失败时，前端会显示错误，不会静默回退到演示 adapter。

## 审核发布示例

先读取队列并记录 `version`：

```powershell
$headers = @{ "X-Admin-Token" = $env:AI_RADAR_ADMIN_TOKEN }
Invoke-RestMethod "http://127.0.0.1:8000/api/v2/admin/review-queue" -Headers $headers
```

批准时必须提交当前版本和人工审核理由：

```powershell
$body = @{
  expectedVersion = 1
  reason = "已核对原始来源和时间字段。"
} | ConvertTo-Json

Invoke-RestMethod `
  "http://127.0.0.1:8000/api/v2/admin/review-queue/review-gpt-context/approve" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

未配置 `AI_RADAR_ADMIN_TOKEN` 时，所有管理写操作返回 `503`；令牌错误返回 `401`。

## 测试

```powershell
.\.venv\Scripts\python.exe -m pytest
```

测试覆盖公共数据隔离、管理认证、实体/图谱查询、一次性审批、并发版本冲突和发布历史。

## 下一阶段

- PostgreSQL 正式 Schema 与可回滚部署流程。
- 来源、文档快照、内容哈希、Diff 和采集任务表。
- 候选实体、关系与 Claim 的结构化抽取。
- 标准用户认证和基于角色的审核权限，替换单一开发管理令牌。
- 真实研究、通知和事务邮件服务。
