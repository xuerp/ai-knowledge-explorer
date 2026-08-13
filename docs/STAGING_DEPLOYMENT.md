# AI Radar 无银行卡预发布部署

本文档用于建立不承载正式数据的免费预发布环境。架构由 Cloudflare Workers 前端、Render Free Web Service API 和 Neon Free PostgreSQL 组成。仓库配置不会创建外部资源，也不包含任何账号、连接串或供应商凭据。

当前预发布地址：

- 前端：`https://ai-radar-staging.1966761779.workers.dev`
- API：`https://ai-radar-api-staging.onrender.com`
- 浏览器同域 API 入口：`https://ai-radar-staging.1966761779.workers.dev/backend`，由 Cloudflare Worker 转发至 Render，避免浏览器直连 Render 的网络不稳定。
- 就绪检查：`https://ai-radar-api-staging.onrender.com/ready`

2026 年 8 月 9 日已完成无凭据远程冒烟验收：前端返回 `200`，API 健康检查与就绪检查通过，公开快照可读，Cloudflare 来源的 CORS 预检通过。该环境仍明确保持 `AI_RADAR_DATA_MODE=demo`。

## 1. 部署结构与限制

仓库根目录的 `render.yaml` 只声明一个新加坡区域的免费 API 服务：

- `ai-radar-api-staging`：Render Free Docker Web Service，对外提供 API。
- PostgreSQL 由 Neon Free 提供，连接串仅填写在 Render Secret 中。
- 前端部署到 `ai-radar-staging.你的子域名.workers.dev`。

免费方案明确保持 `AI_RADAR_DATA_MODE=demo`，不部署常驻 worker。仓库提供可选的 Cloudflare Cron 按小时唤醒 API 并运行一个自动周期；只有完成第 5 节的双端秘密配置和首次运行验收后，才能宣称云端自动调度已经启用。在此之前，管理员仍可在审核后台手动触发采集、摘要生成和 Outbox 投递。

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
6. 在仓库根目录运行以下命令，按提示输入管理员邮箱、密码和 Render 中的临时令牌。令牌与密码不会回显，也不会写入命令历史：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-staging-admin.ps1
   ```

7. 脚本确认管理员创建和登录验证成功后，从 API 服务中删除 `AI_RADAR_ADMIN_TOKEN` 并重新部署。

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

## 5. 可选：启用 Cloudflare 定时任务

定时任务使用独立的 `AI_RADAR_AUTOMATION_TOKEN`，只能调用单周期自动化接口，不能登录审核后台，也不能替代管理员 JWT。不要复用 `AI_RADAR_ADMIN_TOKEN`、数据库密码或其他 API Key。

1. 在本机密码管理器中生成至少 32 位的随机值，不要把值发送到聊天或提交到仓库。
2. 在 Render 的 `ai-radar-api-staging` 服务中新增 Secret `AI_RADAR_AUTOMATION_TOKEN`，保存并等待 API 重新部署完成。
3. 先部署不包含定时触发器的 Worker，确保秘密缺失时不会运行任务：

   ```powershell
   pnpm dlx wrangler@4 deploy --config ops/cloudflare-cron/wrangler.setup.json
   ```

4. 按 Wrangler 提示在本机输入与 Render 相同的随机值：

   ```powershell
   pnpm dlx wrangler@4 secret put AI_RADAR_AUTOMATION_TOKEN --config ops/cloudflare-cron/wrangler.setup.json
   ```

5. 最后部署包含定时触发器的配置：

   ```powershell
   pnpm dlx wrangler@4 deploy --config ops/cloudflare-cron/wrangler.json
   ```

配置默认在每个整点后的第 17 分钟运行一次。PostgreSQL advisory lock、15 分钟周期租约以及信源和邮件自身的持久租约共同阻止并发重复执行。Render 的 worker 心跳健康窗口为 65 分钟，允许一次正常的按小时冷启动与网络抖动；周期崩溃后，下一小时可以接管。

自动抽取随同一周期运行，但只处理已经启用自动采集且产生了新快照的信源。预发布环境采用以下保守上限：

- 每轮最多处理 1 个新快照；
- 每个快照最多生成 10 条候选；
- 同一快照成功处理后不会重复调用模型；
- 不同快照或不同信源再次抽取到主实体、谓词、值和有效期相同的事实时，会按语义指纹识别；待审事实会合并新增证据，已发布事实会跳过，不会重复进入审核或虚增公开 Claim；
- 失败会写入审计与运行诊断，并进入 360 分钟自动退避；人工抽取计划仍会保留该快照，管理员可立即手动重试；
- 自动抽取默认生成待审核候选，并且始终执行冲突检测；只有 `developed-by`、`part-of`、`successor-of` 三类低歧义关系，在官方原文同时逐字出现主客体和对应关系语义、实体均唯一解析、证据地址与信源一致且零冲突时才会自动批准。
- 其他事实、存在歧义的关系、证据不完整的候选和任何冲突项仍保留在人工审核队列中。

这些参数分别由 `AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE`、`AI_RADAR_AUTO_EXTRACTION_MAX_CANDIDATES_PER_SNAPSHOT` 和 `AI_RADAR_AUTO_EXTRACTION_RETRY_MINUTES` 控制。审核后台的“外部集成状态”会显示当前是否启用及实际上限，但不会返回 API Key。

Render 免费 API 可能需要冷启动，首次定时请求延迟不代表数据丢失。SMTP 仍受 Render 免费端口限制；未配置可用投递方式时，摘要只会安全进入 Outbox。

## 6. 验收顺序

1. `/health`、`/ready` 和 API 服务健康检查均通过。
2. Neon 位于 Alembic head，公开快照可读。
3. 普通 viewer 无法进入审核后台。
4. 静态管理员令牌已经撤销。
5. 手动采集和审核发布流程正常。
6. 未启用 Cron 时，“生产上线预检”准确显示 worker 未部署；启用后，审核后台可看到最近的 `scheduled` 周期和新鲜心跳。
7. 免费 API 休眠后能够被正常唤醒。
8. 新快照出现后的下一次定时周期会生成候选；满足严格关系规则的候选会自动批准，其余进入“候选队列”。重复运行不会为同一快照生成重复候选。

预发布稳定运行并完成正式数据质量、自动任务、备份、监控和邮件投递验收前，不得切换为 `live`。
