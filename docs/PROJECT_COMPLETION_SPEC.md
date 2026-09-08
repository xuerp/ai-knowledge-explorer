# AI Radar 项目完成实施 Spec

## 文档状态

- 状态：当前唯一项目收尾执行清单
- 更新时间：2026-09-08
- 工作分支：`codex/productionize`
- 最近完成 staging 验收的后端提交：`cc3974df0cc7d01d94a2016684a2307a4499de40`
- 最近完成 staging 验收的前端提交：`cc3974df0cc7d01d94a2016684a2307a4499de40`
- 数据模式：`demo`
- 适用环境：staging；当前没有已验收的正式 production 环境

本文件定义剩余工作的顺序、授权边界和验收条件。历史设计、评估报告和 ADR 只能提供证据，不能覆盖本文件与 `AI_RADAR_IMPROVEMENT_SPEC_V2_EXECUTION.md` 的红线。

产品设计目标、页面结构和体验原则以 `../PRODUCT_ROADMAP.md` 的“产品设计规划”为准；本文件只负责把它转化为可执行工作包和验收证据。若两者冲突，以本文件的安全顺序、数据边界和上线门禁为准。

## 1. 执行红线

1. 指标用于验证，不是必须凑齐的 KPI。不得编造 Claim、Evidence、Relation、Timeline 或研究答案。
2. LLM 只能生成 Candidate；未经审核的内容不得进入公开快照。
3. `AI_RADAR_DATA_MODE` 保持 `demo`，直到机器门禁和外部人工检查同时通过。
4. 未获当次明确授权，不执行外部模型调用、批量审核、生产数据写入、Secret 轮换、部署、合并或推送。
5. 不在聊天、日志、命令输出、Markdown 或仓库文件中保存 Secret。只引用本机或平台安全配置的环境变量名。
6. 每个写操作必须有：只读预检、精确目标、并发版本、有限批次、结果核对和真实回滚方式。
7. 保留用户无关改动；禁止 force push、rebase、amend 或 squash 已推送历史。
8. 一项节点只有在验收证据实际生成后才能完成，不能以“代码已写”“已发起部署”代替完成。

## 2. 当前核实基线

### 2.1 运行状态

| 项目           | 当前事实                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| 验收 Git 基线  | `cc3974d`                                                                  |
| GitHub Quality | #258 全绿；frontend、backend、deploy-staging 均通过                        |
| Render         | `/ready` 返回 200，commit `cc3974d`，schema `20260905_0023`                |
| Cloudflare     | 不可变 `/releases/<sha>.txt` 返回完整 commit `cc3974d`，与后端一致         |
| 数据           | 49 Entity / 198 Claim / 220 Evidence / 77 Relation / 55 Timeline           |
| 数据质量       | Evidence 引用覆盖率 100%，核心关系缺口 42                                  |
| 核心实体       | 16 个低于当前关系覆盖门槛                                                  |
| 检索           | Hybrid，Cloudflare `@cf/baai/bge-m3`，固定 80 条评估通过率 100%            |
| 审核           | open 34 / approved 195 / rejected 397；管理明细需有效管理员认证            |
| 关系批次       | `2026-09-core-relations-02` 完成 4/4；1 Candidate、1 Duplicate、0 自动批准 |

### 2.2 已完成能力

- Candidate / Verified Claim 隔离、Evidence Anchor、冲突与语义去重。
- PostgreSQL、Alembic 单一 head、JWT/RBAC、审核并发保护和审计日志。
- Lexical、Alias、Cloudflare Hybrid、预算限制和安全 lexical fallback。
- 数据质量、审核统计、生产预检、故障场景和部署 Runbook。
- 关系批次按授权预算执行，未自动批准 Relation。
- 本地前端门禁通过：格式、ESLint、TypeScript、112 项契约测试、Core Model 覆盖检查和 production build 全绿。
- 本地后端门禁通过：Ruff、196 项 pytest；SQLite 空库可升级到 `20260905_0023 (head)`，`alembic check` 无模型漂移。
- 结构化决策输入、证据绑定输出、冲突/证据不足拒答、刷新/分享恢复和普通用户诊断脱敏已落地。
- 390px 浏览器验收无横向溢出，表单字号满足移动端要求，Evidence 锚点可定位，控制台无新增错误。

### 2.3 当前阻塞项

1. `admin_token.txt` 是已于 2026-09-02 失效的短期访问令牌，本地 tip 已删除并加入忽略规则；远端 tip 仍需通过正常提交清理，历史改写不在本轮授权范围内。
2. Blueprint 已部署，但 `/api/v2/admin/integrations` 需要有效管理员认证；运行时普通自动抽取上限尚待授权后只读核验。
3. GitHub Quality #258、Cloudflare staging、Render staging 和 smoke 已在提交 `cc3974d` 上通过。
4. `staging-acceptance.yml` 只有进入默认分支后才会稳定接收 `workflow_run`；当前分支已用同等人工命令完成验收，但自动闭环仍待合并后验证。
5. 登录态实时研究、发布分享和完整 staging 用户流程仍需使用有效测试账号做浏览器验收。
6. 管理端数据质量、审核库存和 release baseline 均返回 401；Node 3/5 需要有效管理员认证后才能继续只读核验。
7. 数据质量门禁仍未证明通过，不能切换 `live`；当前也未定义正式 production 环境与责任人。

## 3. 完成定义

项目收尾完成必须同时满足：

- [ ] 疑似泄露凭证已轮换，旧令牌已失效，公开仓库 tip 不再包含凭证或调试产物。
- [ ] 普通自动抽取上限恢复为 0；任何新模型调用均有新的明确授权和预算。
- [x] 前后端完整门禁绿色，部署流程只在所有检查通过后启动。
- [x] Render 与 Cloudflare 运行同一已验证提交。
- [ ] `/ready`、公开快照、质量指标、审核统计和 staging smoke 全部通过。
- [ ] 核心用户流程在桌面和移动端通过真实浏览器验收。
- [ ] 关系 Candidate 和开放审核项经过人工判断；不以数量门槛替代证据质量。
- [ ] `live` 只在 `/api/v2/admin/production-readiness` 无自动阻塞项、质量报告 `liveReady=true`、外部人工检查完成后切换。
- [ ] 正式发布分支、Render 服务、Cloudflare Worker、域名、监控和回滚责任已明确；否则只声明 staging 完成。

## 4. 执行顺序

### 执行总览

| 节点   | 目标                          | 当前状态                                       | 可交付证据                                     |
| ------ | ----------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Node 0 | 安全收口与停止未授权抽取      | 部分完成；运行时开关核验需要管理员认证         | 旧凭证失效证明、tip 清理、运行时开关响应       |
| Node 1 | 固化当前代码与 UI 基线        | 已完成；产品闭环提交及后续 CI 修复均已推送     | 完整本地门禁、桌面与真实 390px 验收、有限 diff |
| Node 2 | 让 CI 和 staging 运行同一提交 | 已完成；Quality #258、双端 SHA、smoke 全部通过 | 绿色 Quality、两端完整 commit、smoke 记录      |
| Node 3 | 收口开放审核和关系候选        | 可执行只读预检；管理端明细需要管理员认证       | 逐条决定记录、操作前后计数、质量报告           |
| Node 4 | 交付完整产品闭环              | 本地已完成；待 staging 登录态真实浏览器验收    | 页面级验收、交互测试、引用链路和任务测试       |
| Node 5 | 判断是否具备 live 条件        | 阻塞                                           | 机器门禁响应和外部人工检查记录                 |
| Node 6 | 明确正式发布并执行发布决策    | 未定义 production                              | 环境责任表、发布窗口、回滚提交和最终验收       |

节点严格按 0 → 6 推进。允许在不产生外部写入的情况下准备后续节点的代码、测试和文档，但不能提前宣称节点完成，也不能绕过前置条件部署或切换数据模式。

### Node 0：安全收口

#### 0.1 疑似凭证事件

只读预检：

```powershell
git log --oneline --all -- admin_token.txt
git ls-files admin_token.txt
```

外部人工动作：

1. 在 Render 安全配置中轮换 `AI_RADAR_ADMIN_TOKEN`。
2. 若该文件可能包含已签发 JWT，同时轮换 `AI_RADAR_JWT_SECRET`。
3. 检查 GitHub Secret Scanning。

仓库动作须在用户确认轮换完成后执行：从 tip 删除凭证和调试产物并更新 `.gitignore`。历史清理是独立安全事件，必须专项授权和协调，不得直接重写远端历史。

验收：旧凭证不可用；仓库 tip 不含凭证；没有在输出中暴露任何 Secret。

#### 0.2 停止未授权普通抽取

将 `render.yaml` 的 `AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE` 恢复为 `0`，保留 `AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS=false`。

验收：部署后的 `/api/v2/admin/integrations` 显示 `automaticExtractionEnabled=false`，关系批次状态仍保持 complete，未产生新模型调用。

推荐使用统一的只读审计命令。凭据只通过进程环境传入，输出不会回显令牌；命令内部只允许 HTTPS，并且只发送 allowlist 内的 `GET` 请求：

```powershell
$env:AI_RADAR_STAGING_BEARER_TOKEN='<short-lived-admin-jwt>'
npm run audit:staging:readonly
Remove-Item Env:AI_RADAR_STAGING_BEARER_TOKEN
```

也可通过 `AI_RADAR_STAGING_ADMIN_TOKEN` 使用已轮换的 legacy token。不要把任一凭据写入 `.env`、命令输出、文档或提交；缺少凭据时命令默认拒绝执行。

### Node 1：代码与 UI 稳定化

范围：只处理当前明确回归，不同时进行大规模组件重构。

本地门禁：

```powershell
npm run format:check
npx --no-install eslint .
npx --no-install tsc --noEmit
node --test --test-concurrency=1 tests/*.test.mjs
npx --no-install vite build

$python = Resolve-Path backend/.venv/Scripts/python.exe
Push-Location backend
& $python -m pytest
& $python -m ruff check app tests migrations ../scripts
Pop-Location

git diff --check
```

若本机工具版本与 CI 不一致，以锁定依赖后的 CI 为最终门禁，不以跳过检查解决漂移。

浏览器验收：

1. 桌面点击每个时间线圆点，详情卡片可见且不被裁剪。
2. 390px 手机视图不同时渲染桌面横轴和移动列表。
3. 滚动页面时阅读模式选择器不覆盖顶部导航。
4. 三种阅读模式均能切换，键盘焦点和 `aria-expanded` 正确。
5. 控制台无新增错误。

退出条件：本地门禁全绿，并形成可审查的有限 diff。

### Node 2：CI 与部署门禁

实施要求：

1. frontend 和 backend 仅负责检查。
2. 独立 staging deploy job 必须 `needs` 两个检查 job。
3. Wrangler 固定在项目依赖中，不使用会漂移的远程最新版本。
4. Render 不得在 Quality 失败时自动部署失败提交。
5. 部署后运行 `smoke:staging`，并比较 GitHub、Render `/ready`、Cloudflare `/releases/<sha>.txt` 的完整 commit。

验收命令：

```powershell
Invoke-RestMethod https://ai-radar-api-staging.onrender.com/ready
Invoke-WebRequest https://ai-radar-staging.1966761779.workers.dev/releases/<full-sha>.txt
npm run smoke:staging
```

退出条件：GitHub Quality 绿色，前后端 commit 完全一致，smoke 通过。仅“部署已启动”不算完成。

### Node 3：审核与关系批次收口

本节点默认只读，不调用模型，不自动批准。

执行入口：`npm run audit:staging:readonly`。该命令一次性读取构建、抽取开关、关系批次、审核统计、审核库存、数据质量与 release baseline，并输出脱敏聚合报告；它不会读取审核正文，也不会调用任何写接口。

只读接口：

```text
GET /api/v2/public/relation-backfill-status
GET /api/v2/review/stats
GET /api/v2/admin/review-queue?scope=open&limit=500
GET /api/v2/admin/review-queue-inventory
GET /api/v2/admin/data-quality
GET /api/v2/admin/release-baseline
```

执行原则：

- 对本批产生的 1 个 Candidate 逐条核验原文锚点、实体、predicate、重复和冲突。
- 关系不足不是批准理由；没有真实 Evidence 就保留缺口。
- 34 个开放项按风险和确定性分类处理，不设置“必须低于 20”之类的真实性无关指标。
- 每次批准、合并、替代或拒绝都使用当前 `expectedVersion`；生命周期操作同时使用目标 Claim 版本与幂等键。

任何写操作都必须获得当次明确授权。正确接口为：

```text
POST /api/v2/admin/review-queue/{id}/approve
POST /api/v2/admin/review-queue/{id}/merge-evidence
POST /api/v2/admin/review-queue/{id}/approve-superseding
POST /api/v2/admin/review-queue/{id}/reject
```

退出条件：授权范围内的项目已逐条得到终态；重新读取质量报告和发布历史，计数变化与操作一致。

### Node 4：产品体验验收

Node 4 分为四个串行工作包。每个工作包先完成代码和自动化验收，再进入一次桌面与移动端联合视觉检查；发现的问题在一个修复批次内处理，最多进行一次确认检查。

#### 4.1 信息架构与闭环

实施：

- 一级导航固定为动态、决策助手、知识库；桌面与移动端使用同一信息架构。
- `/graph` 仅由实体页关系区进入；Compare 由实体页或决策结果带上下文进入。
- 动态、实体、决策结果之间传递实体、事件或研究记录上下文；返回与分享后可恢复。
- 首页明确 8 个 Core Models 和 3 个 Anchor Models 的层级含义，避免被理解为榜单。

验收证据：导航契约测试、路由回退测试、桌面与 390px 导航截图、至少一条“动态 → 实体 → 决策助手 → Evidence”的浏览器记录。

#### 4.2 实体阅读与模式切换

实施：

- 模型页和通用实体页复用同一阅读模式和密度规则；模型页只保留一套时间线。
- 通俗、产品、技术模式基于同一 Claim / Evidence 计算各自的 section 顺序、密度和默认展开状态。
- 模式选择持久化到 URL 或用户偏好；刷新、前进后退和分享链接保持一致。
- 可读关系先于完整图谱，关系项展示方向、类型、可信状态和来源入口。

验收证据：渲染测试证明三个模式的首屏重点和前三个 section 不同；同一 Claim ID 与 Evidence ID 在不同模式下保持一致；键盘、`aria-expanded`、刷新恢复、空关系和长文本布局通过浏览器验收。

#### 4.3 结构化决策助手

当前 `/ask` 的自由文本入口只能算过渡态。完整交付必须建立结构化决策契约，同时允许自由文本补充。

输入契约：

```json
{
  "task": "string",
  "priority": "quality | cost | speed | privacy | control | balanced",
  "budget": { "mode": "cost-first | range | unknown", "min": null, "max": null, "currency": null },
  "deployment": "cloud-api | private | on-device | hybrid | undecided",
  "exclusions": ["string"],
  "candidateEntityIds": ["entity-id"],
  "notes": "string"
}
```

输出契约：

```json
{
  "status": "ready | insufficient-evidence | conflict | failed",
  "asOf": "ISO-8601 timestamp",
  "recommendation": { "primaryEntityId": null, "alternativeEntityIds": [], "summary": "string" },
  "conditions": ["string"],
  "tradeoffs": [{ "dimension": "string", "finding": "string", "claimIds": [] }],
  "risks": [
    { "state": "verified | inferred | unknown | conflict", "detail": "string", "claimIds": [] }
  ],
  "nextChecks": ["string"],
  "claimIds": [],
  "citations": [],
  "retrievalDiagnostics": {}
}
```

实施：

1. 定义前后端共享字段、枚举、校验和版本策略；现有 `POST /api/v2/research` 保持兼容，采用可选结构化字段或新增明确版本端点，选择以最小迁移风险为准。
2. 表单保存用户已输入内容；缺少必填项时就地解释，预算未知和部署未定是合法答案。
3. 检索只提供 Evidence 支撑的候选；推荐层逐项绑定 Claim ID 和 Citation。
4. Evidence 无法支撑比较或存在决定性冲突时，返回对应状态并说明需要补充什么，不回退成无来源推荐。
5. 结果页展示主选、备选、成立条件、取舍、风险、信息时点和下一步验证；管理员才看到完整检索诊断。
6. 从结果中的判断可直接定位 Evidence，并能带主选和备选进入 Compare。

验收证据：请求/响应 schema 契约测试；覆盖完整输入、预算未知、证据不足、冲突、网络失败和重复提交；所有事实性输出都能解析到公开快照中的 Claim 与 Evidence；普通用户不可见内部诊断；刷新和分享后的研究记录保持同一结论与信息时点。

#### 4.4 核心模型内容分层

实施：

- 建立版本化 Core Model manifest，首批包含 GPT、Claude、Gemini、DeepSeek、Qwen、Kimi、Doubao、ERNIE；标明 Anchor 层级和选择依据。
- 对每个模型生成只读覆盖报告：当前定位、关键版本、能力、限制、价格、部署、生态关系、官方来源和影响决策的空白。
- 只将有官方 Evidence 且能改变用户选择的缺口加入内容工作清单；LLM 产出仍只进入 Candidate。
- Anchor Models 优先支持深度时间线与 Compare；其他核心模型必须可进入追踪、比较和决策助手。长尾没有数量目标。

验收证据：manifest 与公开实体可解析；覆盖报告可复现；新增事实均有 Evidence Anchor 和审核记录；没有为达到条数而生成的事件或关系。

#### 4.5 用户任务验收矩阵

| 场景           | 前置状态       | 操作                                         | 通过条件                                           |
| -------------- | -------------- | -------------------------------------------- | -------------------------------------------------- |
| 发现重要变化   | 未登录、demo   | 首页选择变化并查看来源                       | 30 秒内说明变化、影响、数据模式和至少一条 Evidence |
| 有约束选型     | 登录           | 填写任务、优先级、预算、部署和排除条件       | 返回有条件主选/备选或明确拒答，事实均可追溯        |
| 研究具体模型   | 任意           | 搜索核心模型、切换阅读模式、查看关系         | 三种模式重点不同；关系可读；可进入完整图谱         |
| 核验决策依据   | 已有研究结果   | 从一项取舍进入 Claim 和 Evidence             | 两次操作内到达来源，并能返回原决策上下文           |
| Evidence 不足  | 任意           | 提交超出现有证据的问题                       | 明确显示未知范围和下一步，不生成确定性推荐         |
| 移动端完整流程 | 390px 真机视口 | 完成发现、实体阅读、决策输入和 Evidence 核验 | 无桌面重复结构、遮挡、横向溢出或不可操作控件       |

必须通过的用户流程：

1. 首页能在 30 秒内说明“追踪器是入口、决策助手是核心价值、关系与 Evidence 是可信基础设施”。
2. 知识页能区分实体系列、具体版本、当前事实和历史事实。
3. 一级导航只有动态、决策助手和知识库；`/graph` 从实体页以“完整关系网络”二级入口进入。
4. 实体页先用可读关系回答开发者、谱系、竞品和生态问题；`/graph` 继续支持高级查询，空结果不伪造节点。
5. 三种阅读模式共享同一事实层，但分别突出通俗影响、产品判断和技术 Evidence；切换后信息集合与排序可被立即感知。
6. `/ask` 以决策助手呈现；公开预置问题可用，登录后的研究通过 `POST /api/v2/research` 返回引用和检索诊断。
7. 首页明确展示 8 个已有 Evidence 支撑的核心模型，并区分 GPT、Claude、Gemini 三个 Anchor Models；不为补足条数制造事件。
8. Evidence 不足时明确拒答。
9. 桌面、手机、登录、未登录、加载、空状态和失败状态均有验收记录。

内容深度、时间线条数和关系条数是产品观察项，不是允许造数据的交付配额。

### Node 5：Live Gate

管理员只读检查：

```text
GET /api/v2/admin/data-quality
GET /api/v2/admin/golden-questions
GET /api/v2/admin/operations
GET /api/v2/admin/production-readiness
GET /api/v2/admin/release-baseline
```

字段口径：

- `data-quality.liveReady` 是数据机器门禁。
- `production-readiness.automatedReady` 和 `blockingCount` 是自动预检汇总。
- 检查状态只有 `ready`、`blocked`、`warning`、`manual`。
- 备份恢复、外部监控、域名、供应商额度等人工事实不得由服务自行宣称通过。

若任一条件不满足，保持 `demo` 并记录真实阻塞原因。不得通过删除 Demo 标签、放宽阈值或补造关系绕过门禁。

### Node 6：正式发布决策

当前 Render 和 Cloudflare 都以 `codex/productionize` 为 staging 发布源，不能假设合并 `main` 会自动产生生产发布。

在合并前必须由项目负责人明确：

1. `main` 是否为正式发布分支。
2. 正式 Render 服务、Cloudflare Worker、数据库和域名分别是什么。
3. staging 数据是否允许晋升，还是需要独立 production 数据库。
4. 监控、备份、回滚和事故响应责任人。
5. 发布窗口与回滚提交。

只有上述事实明确、CI 绿色、精确 commit 已验收且用户明确授权后，才执行合并、推送和生产部署。

## 5. 准确 API 契约摘要

### Claim 实体审计与修复

```text
GET  /api/v2/admin/claim-entity-audit
POST /api/v2/admin/claim-entity-repair
POST /api/v2/admin/claim-entity-resolution
```

Dry run：

```json
{ "mode": "dry-run", "claimIds": [] }
```

Apply 必须显式传入最多 50 个 Claim：

```json
{ "mode": "apply", "claimIds": ["claim-id"] }
```

人工解析：

```json
{
  "claimId": "claim-id",
  "action": "assign",
  "entityId": "entity-id",
  "expectedVersion": 1,
  "reason": "人工核验后的具体理由"
}
```

### 信源重试

```text
POST /api/v2/admin/sources/{sourceId}/retry
```

请求必须携带当前失败次数：

```json
{ "expectedFailureCount": 3 }
```

### 关系写入

仓库当前只有单条 upsert，没有 batch endpoint：

```text
POST /api/v2/admin/relations
```

请求必须符合 `GraphEdge`：`id`、`fromId`、`toId`、`kind`、`confidence`、`sourceIds`，可选 `label`、`validFrom`、`validTo`。

## 6. 收束规则

额度或时间接近上限时，只能收束到下列状态之一：

- 一个已通过本地检查、尚待用户授权推送的有限 diff；
- 一个已推送且 CI 正在运行的精确 commit；
- 一个 CI 已绿色、尚待用户授权部署的精确 commit；
- 一个已部署、正在等待有明确时限的 smoke/Cron 观察节点；
- 一个因具体外部条件阻塞、已有精确恢复步骤的节点。

不得把“文档已写”“命令已发出”“部署已开始”表述为节点完成。
