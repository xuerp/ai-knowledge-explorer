# AI Radar 无银行卡预发布部署

本文档用于建立不承载正式数据的免费预发布环境。架构由 Cloudflare Workers 前端、Render Free Web Service API 和 Neon Free PostgreSQL 组成。仓库配置不会创建外部资源，也不包含任何账号、连接串或供应商凭据。

## 1. 部署结构与限制

仓库根目录的 `render.yaml` 只声明一个新加坡区域的免费 API 服务：

- `ai-radar-api-staging`：Render Free Docker Web Service，对外提供 API。
- PostgreSQL 由 Neon Free 提供，连接串仅填写在 Render Secret 中。
- 前端部署到 `ai-radar-staging.你的子域名.workers.dev`。

免费方案明确保持 `AI_RADAR_DATA_MODE=demo`，不部署常驻 worker，也不宣称自动采集、每日摘要或邮件投递已经在云端持续运行。管理员仍可在审核后台手动触发采集、摘要生成和 Outbox 投递。自动任务继续由本地 worker 验证，待确定免费调度方式或升级托管方案后再启用。

Render 免费 API 空闲后会休眠，首次访问可能需要约一分钟唤醒；免费实例也不能通过 `25`、`465`、`587` 端口发送 SMTP。Neon 免费数据库通过公网 TLS 连接，不能把连接串写入仓库、前端变量或聊天。

## 2. 创建 Neon 数据库

1. 在 Neon 注册免费账户并创建项目，区域优先选择与 Render 新加坡较近的可用区域。
2. 数据库名称可使用 `ai_radar`，PostgreSQL 版本使用 Neon 当前默认版本。
3. 在项目控制台点击 `Connect`，启用连接池并复制 pooled connection string。
4. 连接串应以 `postgresql://` 开头，主机名通常包含 `-pooler`，并带有 `sslmode=require`。只把它填写到 Render 的 `AI_RADAR_DATABASE_URL`，不要发送到聊天或保存到仓库文件。

应用会把 `postgresql://` 自动转换为已安装的 psycopg 3 驱动格式。Docker 启动命令在 API 启动前执行 `alembic upgrade head`，因此免费 Render 不依赖仅付费实例支持的 pre-deploy command。

## 3. 创建 Render Blueprint

1. 在 Render 中连接仓库 `xuerp/ai-knowledge-explorer`。
2. 分支选择 `codex/productionize`，Blueprint Path 使用根目录的 `render.yaml`。
3. 首次创建时填写：
   - `AI_RADAR_DATABASE_URL`：Neon pooled connection string。
   - `AI_RADAR_ADMIN_TOKEN`：仅用于创建首个管理员的临时随机值。
   - `AI_RADAR_CORS_ORIGINS`：`https://ai-radar-staging.你的Cloudflare子域名.workers.dev`。
4. 确认资源列表中只有 `ai-radar-api-staging`，计划必须显示 `Free`，不应再出现 Background Worker 或 Render Postgres。
5. 部署完成后访问 `https://你的API地址/ready`，确认返回 `ok: true`、`dataMode: demo` 和 PostgreSQL 数据库类型。
6. 创建并验证管理员账户后，从 API 服务中删除 `AI_RADAR_ADMIN_TOKEN` 并重新部署。

AI 抽取、SMTP 和采集白名单暂不放入 Blueprint。Render 免费实例阻止常用 SMTP 端口，真实邮件投递应改用 HTTPS 邮件 API 或在后续付费环境中配置。任何密钥都不得提交到 `render.yaml`、`.env.production.example` 或 `VITE_` 变量。

## 4. 部署 Cloudflare 预览前端

先使用 Render API 的 HTTPS 地址构建前端：

```bash
VITE_API_BASE_URL=https://你的API地址 bun run build
bun run prepare:cloudflare:staging
bunx wrangler@4 deploy --config .output/server/wrangler.staging.json
```

未指定自定义域名时，部署使用 Cloudflare 的 `workers.dev` 地址。脚本只修改被 Git 忽略的 `.output` 目录，不读取 Cloudflare Token；凭据由 Wrangler 浏览器登录提供。

部署完成后，将最终前端 HTTPS 地址回填到 Render API 的 `AI_RADAR_CORS_ORIGINS`，再执行无凭据冒烟检查：

```bash
AI_RADAR_SMOKE_API_URL=https://你的API地址 \
AI_RADAR_SMOKE_FRONTEND_URL=https://你的前端地址 \
bun run smoke:staging
```

## 5. 验收顺序

1. `/health`、`/ready` 和 API 服务健康检查均通过。
2. Neon 位于 Alembic head，公开快照可读。
3. 普通 viewer 无法进入审核后台。
4. 静态管理员令牌已经撤销。
5. 手动采集和审核发布流程正常。
6. “生产上线预检”准确显示 demo 模式、worker 未部署以及尚未完成的外部项目。
7. 免费 API 休眠后能够被正常唤醒。

预发布稳定运行并完成正式数据质量、自动任务、备份、监控和邮件投递验收前，不得切换为 `live`。
