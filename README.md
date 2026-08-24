# AI Radar

> 持续追踪 AI 模型、Agent 与产品生态的变化，把分散的官方资料转化为有证据的事实、时间线、关系和研究结论。

[在线体验](https://ai-radar-staging.1966761779.workers.dev) · [产品 Case Study](https://ai-radar-staging.1966761779.workers.dev/case-study) · [架构说明](docs/ARCHITECTURE.md)

![AI Radar 公开首页](docs/assets/portfolio/home-desktop.png)

## 为什么需要 AI Radar

通用 AI Chat 适合一次性研究，但长期追踪几十个模型、Agent 和框架时，用户仍要重复搜索、核验来源、整理历史和重建比较维度。AI Radar 把这些重复工作沉淀为持续维护的知识层。

| 通用 AI Chat | AI Radar |
| --- | --- |
| 每次重新提问 | 持续维护实体状态 |
| 一次性生成 | Claim、Timeline、Relation 长期沉淀 |
| 来源附属于回答 | Evidence 是一级数据 |
| 对比依赖临时 Prompt | 固定维度下长期 Compare |
| 模型直接组织结论 | Candidate 经过验证后才能公开 |
| 内容不足时可能补全 | 证据不足时明确拒答 |

## 三个核心体验

### 1. Timeline：看一个 AI 产品如何演进

实体档案把关键事实、最近变化、版本、关系、时间线和证据放在同一上下文中。“发生了什么”和“为什么重要”保持视觉与语义区分。

### 2. Compare：比较 GPT、Claude 与 Gemini 的路线

默认提供系列级路线比较，并可下钻到具体版本的上下文、价格、模态、工具和可用范围。底层接受任意可比较模型，不维护 Showcase 专用静态比较表。

### 3. Research：基于 Evidence 做跨实体研究

未登录访客可以运行三条预置研究路径；登录后研究记录进入私密账户。每个结论回到已发布 Claim 和 Evidence，覆盖不足时返回可信拒答。

### 4. 可信 RAG：先检索可核验事实，再生成回答

当前研究链路已经具备 PostgreSQL 全文检索、逐条 Claim 引用、Evidence 校验、检索诊断和黄金问题评估。Embedding、混合检索、Reranker 与带引用生成均采用默认关闭的扩展接口；未确认供应商和费用上限时，系统保持零额外模型费用的 `lexical + extractive` 模式。

最近一次本地基线中，引用覆盖率为 100%，但 RAG 检索通过率仅为 20%、实体 Recall@8 为 29.17%，因此 `ragReady=false`。项目不会用“能生成回答”替代真实召回质量。

## 工作方式

```text
官方信源
  ↓
安全采集 → Snapshot / Diff
  ↓
LLM 结构化抽取
  ↓
Candidate
  ↓
Evidence Anchor + Schema Validation
  ↓
语义去重 + 冲突检测 + 风险分级
  ↓
自动 / 批量 / 人工审核
  ↓
Verified Claim
  ↓
Timeline / Compare / Graph / Research
```

LLM 在系统中是“提议者”，不是“事实裁决者”。模型输出不能直接进入公开知识库。

## AI 可信与产品决策

- **Candidate / Verified Claim 分离：** 明确区分模型生成和系统认可。
- **证据锚点：** 除来源链接外，保存支持结论的原文片段。
- **结构化降级但不降标准：** 供应商不兼容 JSON Schema 时可使用 `json_object`，仍执行严格字段校验。
- **语义去重与冲突保护：** 阻止同义重复、有效期重叠和相互矛盾内容静默发布。
- **风险分级审核：** 低风险内容只有在真实精度达到阈值后才能扩大自动批准；价格、Benchmark、安全事件和冲突保留人工审核。
- **Showcase / Live 分离：** 作品集使用明确标记的精选快照；正式模式继续受 Claim、关系、黄金问题和生产就绪门槛约束。

完整决策说明见[产品 Case Study 文档](docs/PORTFOLIO_CASE_STUDY.md)和[简历与面试材料](docs/RESUME_AND_INTERVIEW.md)。

## 当前公开状态

- 前端：Cloudflare Workers
- API：Render FastAPI
- 数据库：Neon PostgreSQL
- 定时任务：Cloudflare Cron，每 30 分钟一次
- 环境：`production`
- 数据模式：`demo`
- 快照新鲜度：`cached`

截至 2026-08-21，公开快照包含 49 个实体、23 条 Claim、40 条 Evidence、71 条 Relation 和 55 条 Timeline；34/40 条公开证据来自官方来源。正式门槛为 150 条已审核 Claim，且 17 个核心实体仍存在约 49 条关系缺口，因此不切换为 `live`。

## 主要入口

| 路径 | 用途 |
| --- | --- |
| `/` | 产品定位、最近变化、核心实体、Why ChatGPT 与三个核心体验 |
| `/knowledge` | 分类浏览实体知识库 |
| `/knowledge/model/gpt` | GPT 系列档案、版本和时间线 |
| `/compare` | GPT、Claude、Gemini 路线与具体版本比较 |
| `/graph` | 可解释关系查询、邻域、路径与来源 |
| `/ask` | 未登录预置研究与登录后私密研究 |
| `/case-study` | 正式公开产品故事、决策、风险和取舍 |
| `/admin/review-demo` | 无需登录的只读审核闭环 |
| `/admin/review` | 真实 reviewer/admin 工作台 |

## 技术架构

- 前端：React、TypeScript、TanStack Router/Start、Tailwind CSS、PWA。
- 后端：FastAPI、Pydantic、SQLAlchemy、Alembic、JWT/RBAC。
- 数据：PostgreSQL；本地和 CI 同时保护 SQLite/PostgreSQL 迁移兼容。
- 部署：Cloudflare Workers 同域代理 → Render API → Neon PostgreSQL。
- 自动化：安全采集、租约、退避、OpenAI-compatible 抽取、审核、通知 Outbox 与 Cloudflare Cron。
- RAG：PostgreSQL 全文检索、GIN 投影索引、逐 Claim 引用、严格生成 Schema、失败降级与黄金问题评估。
- 质量：ESLint、TypeScript、83 项前端测试、130 项后端测试、Ruff、生产构建、SQLite/PostgreSQL 迁移验证和数据质量门槛。

详细结构见[架构说明](docs/ARCHITECTURE.md)。

## 本地运行

前端要求 Node.js 22 和 Bun 1.3.14：

```bash
bun install --frozen-lockfile
bun run dev
```

后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --env-file .env
```

前端 `.env`：

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

不配置 API 时，公开产品使用明确标记的内置演示快照；配置后如果 API 暂时不可用，首屏和预置研究会显式说明正在使用该快照，不会冒充实时结果。

## 质量检查

```bash
bun install --frozen-lockfile
node scripts/export-demo-snapshot.mjs
bun run check
bun run prepare:cloudflare:staging
cd backend
python -m ruff format --check app tests migrations
python -m ruff check app tests migrations
python -m compileall -q app tests migrations
python -m pytest
python -m alembic upgrade head
python -m alembic current --check-heads
python -m alembic check
```

项目采用风险测试：日常改动执行针对性检查，Epic 完成执行完整回归，发布时再执行匿名浏览器与线上关键路径验收。

## 安全与负责任披露

- 真实 `.env`、数据库连接串、模型 Key、JWT Secret、SMTP 密码和云平台 Token 不进入 Git。
- Render 与 Cloudflare 只通过平台 Secret 注入凭据，前端变量不得保存敏感信息。
- 管理员初始化完成后移除静态 bootstrap Token，日常管理使用短期 JWT 与 RBAC。
- 安全问题请按照[安全策略](SECURITY.md)私密报告，不要在公开 Issue 中提交凭据或漏洞细节。

## 路线与边界

### Portfolio v1

- 收敛首页、Timeline、Compare、Research、Evidence 与 Case Study。
- 完成 README、截图、演示脚本、简历和面试材料。
- 不降低正式数据门槛。

### v1.5 Live Ready

- 扩充到 150+ 已审核 Claim 与核心关系覆盖。
- 运行黄金问题、数据质量和生产就绪检查。
- 完成 SMTP、正式域名、外部监控和备份恢复演练。
- 只有 `liveReady=true` 后才把 `AI_RADAR_DATA_MODE` 改为 `live`。

## 项目资料

- [作品集版本基线](docs/SHOWCASE_BASELINE.md)
- [作品集实施计划](docs/SHOWCASE_IMPLEMENTATION_PLAN.md)
- [Spec 覆盖与交付边界](docs/SPEC_TRACEABILITY.md)
- [审核、信源与内容新鲜度治理 Spec](docs/REVIEW_SOURCE_FRESHNESS_SPEC.md)
- [阅读模式与知识生命周期治理 Spec](docs/READING_MODE_AND_KNOWLEDGE_LIFECYCLE_SPEC.md)
- [作品集验收与截图](docs/PORTFOLIO_ACCEPTANCE.md)
- [3 分钟演示与短视频脚本](docs/DEMO_SCRIPT.md)
- [产品 Case Study 文档](docs/PORTFOLIO_CASE_STUDY.md)
- [简历与面试材料](docs/RESUME_AND_INTERVIEW.md)
- [生产运行手册](docs/PRODUCTION_RUNBOOK.md)
