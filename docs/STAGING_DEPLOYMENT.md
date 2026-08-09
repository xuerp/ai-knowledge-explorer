# AI Radar 预发布环境部署

本文档用于建立不承载正式数据的预发布环境。仓库中的配置不会创建云资源，也不包含任何账号、域名或供应商凭据；连接 Render、Cloudflare 和 GitHub 后才会产生外部资源及费用。

## 1. 部署结构

仓库根目录的 `render.yaml` 声明以下新加坡区域资源：

- `ai-radar-api-staging`：Docker Web Service，对外提供 API。
- `ai-radar-worker-staging`：单副本常驻 worker。
- `ai-radar-postgres-staging`：PostgreSQL 16，禁止公网数据库连接。
- `ai-radar-staging-runtime`：API 与 worker 共用的非敏感运行参数。

API 在发布前执行 `alembic upgrade head`。worker 启动时只等待数据库达到迁移 head，不会与 API 并发执行迁移。Render 提供的 `postgresql://` 连接串会由应用自动转换为已安装的 psycopg 3 驱动格式。worker 会把 Render 自动提供的实例 ID 加入运行标识，滚动发布时新旧实例的心跳不会互相覆盖。

Blueprint 默认保持 `AI_RADAR_DATA_MODE=demo`，不会把预发布环境伪装为正式数据。Web Service、Background Worker 和托管 PostgreSQL 都可能产生费用，创建前应在 Render 控制台核对当前计划价格。

## 2. 创建 Render Blueprint

1. 在 Render 中连接本仓库，选择根目录的 `render.yaml`。
2. 首次创建时填写：
   - `AI_RADAR_ADMIN_TOKEN`：仅用于创建首个管理员的临时随机值。
   - `AI_RADAR_CORS_ORIGINS`：先填写 Cloudflare 预览地址，必须是明确的 HTTPS 来源。
3. 等待数据库、API 和 worker 全部健康。
4. 访问 `https://你的API地址/ready`，确认返回 `ok: true`。
5. 创建并验证管理员账户后，从 API 服务中删除 `AI_RADAR_ADMIN_TOKEN`，重新部署 API。

AI 抽取、SMTP 和采集白名单不放入 Blueprint。确定供应商后，在 Render 控制台创建一个仅限预发布环境的 Secret Group，同时链接 API 与 worker，并按需填写：

```text
AI_RADAR_FETCH_ALLOWED_HOSTS
AI_RADAR_EXTRACTION_API_URL
AI_RADAR_EXTRACTION_API_KEY
AI_RADAR_EXTRACTION_MODEL
AI_RADAR_SMTP_HOST
AI_RADAR_SMTP_PORT
AI_RADAR_SMTP_USERNAME
AI_RADAR_SMTP_PASSWORD
AI_RADAR_SMTP_FROM
AI_RADAR_SMTP_STARTTLS
```

不要把这些值提交到 `render.yaml`、`.env.production.example` 或任何 `VITE_` 变量。

## 3. 部署 Cloudflare 预览前端

先使用 Render API 的 HTTPS 地址构建前端：

```bash
VITE_API_BASE_URL=https://你的API地址 bun run build
bun run prepare:cloudflare:staging
bunx wrangler@4 deploy --config .output/server/wrangler.staging.json
```

未指定域名时，部署使用 Cloudflare 的 `workers.dev` 预览地址。确定自定义域名后，在构建前设置以下非敏感变量：

```bash
AI_RADAR_CLOUDFLARE_WORKER_NAME=ai-radar-staging
AI_RADAR_CLOUDFLARE_DOMAIN=staging.你的域名
```

然后重新运行生成和部署命令。脚本只修改被 Git 忽略的 `.output` 目录，不会写入仓库配置，也不会读取 Cloudflare Token。Cloudflare 凭据由 Wrangler 登录或 CI Secret 提供。

部署完成后，将最终前端 HTTPS 地址回填到 Render API 的 `AI_RADAR_CORS_ORIGINS`，再检查浏览器登录、审核后台和生产上线预检。

可从本机执行无凭据冒烟检查，自动验证 API 健康、数据库就绪、公开快照、前端页面和跨域配置：

```bash
AI_RADAR_SMOKE_API_URL=https://你的API地址 \
AI_RADAR_SMOKE_FRONTEND_URL=https://你的前端地址 \
bun run smoke:staging
```

公网地址必须使用 HTTPS；未设置变量时脚本检查本地的 `8001` API 和 `4183` 前端。脚本不会登录、写入数据或读取管理员令牌。

## 4. 验收顺序

预发布环境至少完成以下检查：

1. `/health`、`/ready` 和 API 服务健康检查均通过。
2. worker 心跳正常，最近周期没有未处理失败。
3. PostgreSQL 位于 Alembic head，且数据库没有公网入口。
4. 普通 viewer 无法进入审核后台。
5. 静态管理员令牌已经撤销。
6. 只启用 3–5 个经过核验的官方信源。
7. AI 候选必须经过人工批准后才进入公共快照。
8. SMTP 初期只向管理员测试邮箱投递。
9. “生产上线预检”准确显示 demo 模式及尚未完成的外部项目。

预发布环境稳定运行并完成数据质量验收前，不得切换为 `live`。
