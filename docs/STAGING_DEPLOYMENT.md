# AI Radar 预发布部署与配置

本页维护当前部署核对记录与新环境配置步骤。现有环境由 Cloudflare Workers 前端、Render Free API 和 Supabase PostgreSQL 组成。`dataMode=demo` 描述资料发布与质量门槛，不表示没有持久数据库；账户与私人研究可能是真实持久数据。不要为重启程序重新创建或清空数据库。

## 当前部署核对记录

核对日期：**2026-11-18**。已只读检查现有 Render 服务配置和公开接口；以下表格区分实际配置、运行响应与尚未验收的外部效果。

| 项目         | 核对结果                                                     | 依据与边界                                                                            |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 前端         | Cloudflare Workers，域名 `airadar.rainza.cn`                 | 公开访问与仓库发布配置；域名已启用                                                    |
| API          | Render Free，Singapore，`main` 分支，Docker                  | 现有服务与 Settings；存活路径 `/health`                                               |
| 数据库       | **Supabase PostgreSQL**，连接池 5432，要求 TLS               | 现有 Render `AI_RADAR_DATABASE_URL` 的主机名与参数；不保存完整连接串                  |
| 账户认证     | FastAPI/JWT/RBAC；静态初始化令牌当前未设置                   | 服务代码与 Render 配置；没有将认证迁移到 Supabase Auth                                |
| 资料模式     | `demo`                                                       | 公开 `/ready`；不是实时全量信息服务                                                   |
| 候选抽取     | SoleAPI 已配置；普通自动抽取上限为 **0**                     | Render 当前配置；本次没有发送模型探针或抽取请求                                       |
| 模型需求解析 | 单独配置的可选能力，当前 **关闭**                            | `AI_RADAR_DECISION_INTERPRETATION_ENABLED=false`；不与候选抽取混为一谈                |
| 检索         | 当前模式配置为 `hybrid`；Blueprint 使用 Cloudflare Embedding | 实际请求是否降级须看 `retrievalMode` 与 `fallbackReason`；本次未触发新 Embedding 调用 |
| 邮件         | 选择 Resend，但缺少投递 API Key 与发件人；保持 Outbox        | Render 服务及关联环境组未设置所需两项；未执行投递                                     |
| 调度         | 仓库配置为 5 分钟保活、30 分钟自动周期                       | 以 `ops/cloudflare-cron/wrangler.json` 为配置依据；本次未读取 Cloudflare 连续执行日志 |

核对时前端 `version.txt` 与后端 `buildCommit` 同为 `4667487254918279f2fc7f4f4648c0fbefb0f747`，`/ready` 返回 `ok=true`、`database=postgresql+psycopg`、`schemaRevision=20261110_0030`。同一提交的 Quality 与 Staging acceptance 成功。这里记录的是本次核对时点，不代替后续版本的检查。

运行配置以部署平台为准，配置模板以 Git 为准；本机 `.env`、SQLAlchemy 数据库类型、供应商控制台是否有项目，都不能单独证明 API 实际连接了哪套数据库。更换数据库或模型服务后先核对现有配置，再更新本表及引用它的文档。

当前预发布地址：

- 前端：`https://airadar.rainza.cn`
- API：`https://ai-radar-api-staging.onrender.com`
- 浏览器同域 API 入口：`https://airadar.rainza.cn/backend`，由 Cloudflare Worker 转发至 Render，避免浏览器直连 Render 的网络不稳定。
- 就绪检查：`https://ai-radar-api-staging.onrender.com/ready`

健康与就绪接口通过只说明对应检查通过，不代表持续采集闭环、全部用户操作、独立内容复核或真实邮件送达均已验收。

## 1. 部署结构与限制

仓库根目录的 `render.yaml` 只声明一个新加坡区域的免费 API 服务：

- `ai-radar-api-staging`：Render Free Docker Web Service，对外提供 API。
- 当前 PostgreSQL 由 Supabase 托管，连接串仅填写在 Render Secret 中；Supabase 套餐与备份权益须在其控制台另行核对，不能从 Render Free 推断。
- 前端通过 Cloudflare Worker `ai-radar` 提供服务，公开地址为 `https://airadar.rainza.cn/`。

预发布环境保持 `AI_RADAR_DATA_MODE=demo`。Cron 配置每 5 分钟直连 `/health` 保活、每 30 分钟调用自动化单周期端点。保活不查询数据库、不携带自动化令牌、不执行采集或模型调用。GitHub Actions 仅保留手动直连 PostgreSQL 的应急入口，不配置 `schedule`。管理员可在审核后台按权限手动触发任务；涉及外部模型或邮件时须另行确认数据范围和调用预算。

Render 免费 API 连续 15 分钟没有入站请求会休眠；五分钟保活用于避免正常闲置触发这项限制。服务部署、平台重启、调度故障或免费额度耗尽仍可能导致等待或不可用；保活不提供付费常驻实例的可用性保证。工作区每月共享 750 个免费实例小时，一个服务连续运行 31 天使用 744 小时；若同工作区还有其他免费 Web 服务，需要共同核算额度。[Render 免费实例限制](https://render.com/docs/free)。

Render 免费实例限制对外 SMTP 端口 `25`、`465`、`587`，因此托管邮件模板使用 HTTPS。数据库通过公网 TLS 连接；连接串不能写入仓库、前端变量或聊天。

## 2. 配置 Supabase PostgreSQL

现有实例已经连接 Supabase，日常重启不执行下面的新环境创建步骤。

1. 新建环境时，在 Supabase 创建独立项目，按实际网络和区域选择数据库资源；测试、恢复演练和现有实例分别管理。
2. 在 Supabase 项目顶部打开 `Connect`，按运行环境选择连接方式。当前 Render 使用共享连接池的 **Session mode / 5432**；不要把 6543 事务池地址直接当作等价替换。
3. 使用控制台提供的完整用户名、数据库名和主机名，不把 pooled 用户名简写成 `postgres`，也不猜测项目标识。按连接要求启用 TLS，当前配置为 `sslmode=require`。
4. 将连接串保存为 Render 的 `AI_RADAR_DATABASE_URL`。GitHub 手动应急任务如需启用，必须另行核对其同名 Secret 指向同一目标环境，不能假定两个平台会自动同步 Secret。

连接方式、网络支持与连接池限制见 [Supabase 官方连接说明](https://supabase.com/docs/guides/database/connecting-to-postgres)。迁移和逻辑备份按官方建议选择适用连接方式；不能只凭端口连通就认定 DDL、长事务与恢复都已验证。

应用会把 `postgresql://` 自动转换为已安装的 psycopg 3 驱动格式。Docker 启动命令在 API 启动前执行 `alembic upgrade head`，因此免费 Render 不依赖仅付费实例支持的 pre-deploy command。

## 3. 创建 Render Blueprint

1. 在 Render 中连接仓库 `xuerp/ai-knowledge-explorer`。
2. 分支选择 `main`，Blueprint Path 使用根目录的 `render.yaml`。
3. 首次创建时填写：
   - `AI_RADAR_DATABASE_URL`：已核对的 Supabase PostgreSQL 连接串。
   - `AI_RADAR_ADMIN_TOKEN`：仅用于创建首个管理员的临时随机值。
   - `AI_RADAR_CORS_ORIGINS`：`https://airadar.rainza.cn`。
   - `CLOUDFLARE_ACCOUNT_ID`：Workers AI 页面显示的 Account ID。
   - `CLOUDFLARE_API_TOKEN`：使用 Cloudflare 的 “Create a Workers AI API Token” 模板创建，只保存在 Render Secret 中。
4. 确认资源列表中只有 `ai-radar-api-staging`，计划必须显示 `Free`，不应再出现 Background Worker 或 Render Postgres。
5. 部署完成后访问 `https://你的API地址/ready`，确认返回 `ok: true`、`dataMode: demo` 和 PostgreSQL 数据库类型。
6. 仅在新环境没有任何用户时，在仓库根目录运行以下命令，按提示输入管理员邮箱、密码和临时令牌。现有实例不要重复初始化；令牌与密码不会回显或写入命令历史：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-staging-admin.ps1
   ```

7. 脚本确认管理员创建和登录验证成功后，从 API 服务中删除 `AI_RADAR_ADMIN_TOKEN` 并重新部署。

Embedding 模板配置为 `AI_RADAR_RETRIEVAL_MODE=hybrid`、Cloudflare `@cf/baai/bge-m3`，硬预算为每日最多 1,000 Neurons 与 1,000 次请求。缺少向量时按实际库内容与预算建立持久索引，不固定写成某个历史 Claim 数量；内容哈希变化后需要重新建立对应向量。凭证缺失、预算超限或远端异常时回退 lexical 并记录原因。配置预算不能证明账户实际套餐，也不授权升级或新增付费调用。

候选抽取由 `AI_RADAR_EXTRACTION_API_URL/KEY/MODEL` 配置，当前为 SoleAPI。模型需求解析使用独立的 `AI_RADAR_DECISION_INTERPRETATION_*` 地址、模型、账号与预算配置，当前开关为 false。两者的连接存在不代表业务调用已成功，不在文档核对中自动发送探针。

邮件模板选择 Resend HTTPS，但完整投递还需要 `AI_RADAR_EMAIL_API_KEY` 与已验证发件人 `AI_RADAR_SMTP_FROM`；当前这两项未配置，摘要仅保留在 Outbox。任何密钥均不得提交到模板或 `VITE_` 变量。

## 4. 部署 Cloudflare 预览前端

使用仓库已提交的 `.env.staging` 构建预发前端。浏览器通过 Cloudflare 同域代理访问 API，SSR 直接访问 Render 上游，避免 Worker 回调自身：

```powershell
bun run build:staging
bun run prepare:cloudflare:staging
bun run verify:cloudflare:staging
$previousCloudflareToken = $env:CLOUDFLARE_API_TOKEN
try {
  $env:CLOUDFLARE_API_TOKEN = $env:CLOUDFLARE_DEPLOY_API_TOKEN
  npx --no-install wrangler deploy --config .output/server/wrangler.staging.json
} finally {
  $env:CLOUDFLARE_API_TOKEN = $previousCloudflareToken
}
```

不得使用默认 `bun run build` 的产物部署预发 Worker。Nitro 的 Cloudflare 适配层不会把 Worker 运行时变量继续传入 SSR 服务；预发构建必须通过 `--mode staging` 将 Render 上游写入服务端运行时代码。`verify:cloudflare:staging` 会分别检查浏览器代理地址和 SSR 上游地址，只有 Wrangler 配置中存在变量也不能通过。`CLOUDFLARE_API_TOKEN` 保留给 Workers AI；Wrangler 部署必须临时映射专用的 `CLOUDFLARE_DEPLOY_API_TOKEN`，并在命令结束后恢复原变量，避免两个有效 Token 因名称冲突而被误用。

现有自定义域名为 `airadar.rainza.cn`。新建独立环境时使用自己的域名或 `workers.dev` 地址，核对构建脚本中的路由，避免将试验构建部署到现有网站。准备脚本仅修改被 Git 忽略的 `.output`；Wrangler 部署使用已授权的专用部署凭据。

部署完成后，将最终前端 HTTPS 地址回填到 Render API 的 `AI_RADAR_CORS_ORIGINS`，再执行无凭据冒烟检查：

```bash
AI_RADAR_SMOKE_API_URL=https://你的API地址 \
AI_RADAR_SMOKE_FRONTEND_URL=https://你的前端地址 \
AI_RADAR_SMOKE_PROXY_URL=https://你的前端地址/backend \
bun run smoke:staging
```

`AI_RADAR_SMOKE_PROXY_URL`（可选）额外经前端 Worker 的同域 `/backend` 代理检查 GET、HEAD、POST；浏览器只走这条路径，不直接访问 API 地址。未设置时跳过，行为与之前一致。

数据质量看板使用公开只读接口 `/api/quality/metrics`（兼容别名 `/api/v2/quality/metrics`）。业务指标在请求时从当前数据库轻量聚合，固定集评估从版本化的 `backend/data/quality_evaluation.json` 读取，两者更新时间独立。当前评估 cadence 为 `on-evaluation-publication`；仓库提供手动评估工作流，没有每日自动评估调度。检索策略或题集变化后显式执行并通过 `scripts/publish_quality_metrics.py` 发布报告；不能放进每 30 分钟的自动化周期，也不能在页面请求时调用 Embedding provider。

部署后以无登录窗口完成以下验收：

1. 访问 `https://你的API地址/api/quality/metrics`，确认 HTTP 200，`business.updatedAt` 与 `evaluation.updatedAt` 均存在且彼此独立。
2. 访问 `https://你的前端地址/quality`，确认业务质量和 Golden Set 两组指标可见，并分别显示更新时间。
3. 确认页面显示报告真实更新时间和发布节奏，不把每 5 分钟刷新业务数据说成重新运行固定集评估。
4. 对照公开快照确认业务计数一致；对照版本化评估结果确认 Golden Set 版本、样本数、检索模式和四项指标一致。

## 5. 启用 Cloudflare Cron 并保留 GitHub 手动回退

Cloudflare Cron 是 staging 的主调度器。GitHub `schedule` 曾在工作流启用、默认分支配置正确且多次重新登记后仍连续缺失，因此不再作为无人值守完成证据。

定时任务使用独立的 `AI_RADAR_AUTOMATION_TOKEN`，只能调用单周期自动化接口，不能登录审核后台，也不能替代管理员 JWT。不要复用 `AI_RADAR_ADMIN_TOKEN`、数据库密码或其他 API Key。

1. 在本机密码管理器中生成至少 32 位的随机值，不要把值发送到聊天或提交到仓库。
2. 在 Render 的 `ai-radar-api-staging` 服务中新增 Secret `AI_RADAR_AUTOMATION_TOKEN`，保存并等待 API 重新部署完成。
3. 先部署不包含定时触发器的 Worker，确保秘密缺失时不会运行任务：

   ```powershell
   npx --no-install wrangler deploy --config ops/cloudflare-cron/wrangler.setup.json
   ```

4. 按 Wrangler 提示在本机输入与 Render 相同的随机值：

   ```powershell
   npx --no-install wrangler secret put AI_RADAR_AUTOMATION_TOKEN --config ops/cloudflare-cron/wrangler.setup.json
   ```

5. 最后部署包含定时触发器的配置：

   ```powershell
   npx --no-install wrangler deploy --config ops/cloudflare-cron/wrangler.json
   ```

Cron 同时注册 `*/5 * * * *`（进程保活）与 `*/30 * * * *`（自动化），不能通过提高采集频率代替保活。保活直连 Render 的 `/health`、禁用缓存和重定向、最多等待 90 秒，并要求 JSON 的 `ok=true`；Render 启动 HTML 或错误状态不会被算作成功。`backend-keepalive-started/succeeded/failed` 日志与自动化周期日志分开记录。现有 Worker Secret 在常规代码部署时保留。调度器变更按以上 Wrangler 步骤单独发布并核对 Cron；网站仍由 Quality 检查通过后自动部署。部署凭据只具备网站权限时，使用已登录的控制台发布调度器，不能因此扩大令牌权限或开启公开路由。

自动化仍每 30 分钟执行一次。PostgreSQL advisory lock、15 分钟周期租约以及信源和邮件自身的持久租约共同阻止并发重复执行。自动化请求对网络错误及 429/502/503/504 最多尝试三次；下一次定时周期会继续接管。

保活变更的验收范围：

- 检查五分钟事件只请求 `/health`，半小时事件才调用自动化，凭据不进入保活请求；
- 在隔离的 Worker 运行时验证事件分发与健康响应判断；
- 核对线上两项 Cron 表达式、部署版本和实际成功日志；
- 连续观察超过 15 分钟后再测页面及 API，期间不以人工请求代替定时保活；
- 核对 GET/HEAD/POST 同域代理，保活不能改变鉴权、缓存或业务请求行为。

### GitHub Actions 手动回退

1. 在仓库 `Settings → Secrets and variables → Actions` 保留 Repository Secret `AI_RADAR_DATABASE_URL`，核对它指向预期 Supabase 环境。不能用 Render 已更新代替 GitHub Secret 同步检查，也不要将连接串提交到仓库或聊天。
2. 若需要从应急任务自动投递邮件，再保留可选 Secrets `AI_RADAR_EMAIL_API_KEY` 与 `AI_RADAR_SMTP_FROM`；未配置时摘要仍会安全进入 Outbox。
3. 只有故障处置或验收需要时，才在 Actions 的 `Automation` 工作流中执行 `Run workflow`。确认迁移与周期成功，并核对 `scheduler-github-actions` 心跳。

工作流使用 `concurrency` 串行执行，并由数据库周期租约继续阻止重复处理；单次任务限制为 20 分钟。它不配置 `schedule`，不能替代 Cloudflare Cron 的持续健康检查。

自动抽取随同一周期检查，但普通运行的 Snapshot 上限默认为 0。只有用户明确授权的有限批次，才允许临时提高上限，并必须同时设置唯一批次 ID、Snapshot 硬预算和完成后的恢复动作：

- 默认 `AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE=0`；授权批次结束后必须立即恢复为 0；
- 每个快照最多生成 10 条候选；
- 同一快照成功处理后不会重复调用模型；
- 抽取审计记录包含明确的管线版本；升级管线不会自动授权重跑历史 Snapshot；
- 不同快照或不同信源再次抽取到主实体、谓词、值和有效期相同的事实时，会按语义指纹识别；待审事实会合并新增证据，已发布事实会跳过，不会重复进入审核或虚增公开 Claim；
- 失败会写入审计与运行诊断，并进入 360 分钟自动退避；人工抽取计划仍会保留该快照，管理员可立即手动重试；
- `AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS=false`；所有自动抽取结果只生成待审核候选并执行冲突检测，不自动批准；
- 自动抽取会按“来源实体、关系类型、目标实体、有效期”与公开事实、待审核事实和现有图谱边统一去重；同一事实的新证据会合并到待审核项，已经公开的关系不会重复生成候选。
- 只有管理员或审核员实际批准的证据才会增加人工核验覆盖率，避免正式数据门槛被自动流程虚高。
- 抽取候选会尝试从采集快照中确定性定位主客体同段出现的原文片段，并与证据链接一起显示在审核卡片；找不到同段原文时不会生成或伪造摘录。
- 其他事实、存在歧义的关系、证据不完整的候选和任何冲突项仍保留在人工审核队列中。

这些参数分别由 `AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE`、`AI_RADAR_AUTO_EXTRACTION_MAX_CANDIDATES_PER_SNAPSHOT` 和 `AI_RADAR_AUTO_EXTRACTION_RETRY_MINUTES` 控制。审核后台的“外部集成状态”会显示当前是否启用及实际上限，但不会返回 API Key。

Render 免费 API 可能需要冷启动，首次定时请求延迟不代表数据丢失。SMTP 仍受 Render 免费端口限制；未配置可用投递方式时，摘要只会安全进入 Outbox。

## 6. 验收顺序

当前发布分支是 `main`。Quality 在 push/PR 上执行，只有 `main` 的 push 才在前后端检查成功后发布已验证的 Cloudflare 构建；Render Blueprint 同样跟踪 `main`，模板使用 `checksPass`。独立 Staging acceptance 在 main 的 Quality 成功后运行，等待前端 `version.txt` 和 API `buildCommit` 对齐该提交，再执行直接 API 与同域代理冒烟。以这些现有工作流为准，日常启动无需创建或保留历史开发分支。

修改文档后若推送 main，也会触发当前自动发布流程。发布前完成检查，发布后核对两端版本与业务冒烟结果。不能把提交成功、构建上传成功或一项 HTTP 200 当作新版本全链路验收。

1. `/health`、`/ready` 和 API 服务健康检查均通过。
2. Supabase PostgreSQL 位于目标版本的 Alembic head，公开快照可读。
3. 普通 viewer 无法进入审核后台。
4. 静态管理员令牌已经撤销。
5. 手动采集和审核发布流程正常。
6. 未启用 Cron 时，“生产上线预检”准确显示 worker 未部署；启用后，审核后台可看到最近的 `scheduled` 周期和新鲜心跳。
7. 免费 API 休眠后能够被正常唤醒。
8. 只有存在明确授权批次且普通自动抽取上限已临时提高时，新快照才会生成候选；所有候选进入审核队列，不自动批准。重复运行不会为同一快照生成重复候选，批次结束后上限恢复为 0。
9. 管理员集成状态与实际研究请求分别核对模式、provider 与降级原因；凭据不进入响应。故障注入在隔离环境使用模拟传输验证，不在现有云端临时删除或替换有效 Token。新增真实 Embedding 调用需要独立预算授权。
10. 公开质量指标 API 与 `/quality` 页面可访问，业务/评估更新时间分离，固定集评估没有进入高频 Cron。

预发布稳定运行并完成正式数据质量、自动任务、备份、监控和邮件投递验收前，不得切换为 `live`。
