# AI Radar

AI Radar 是一个面向 AI 模型、Agent、框架、论文和 Benchmark 的时序知识图谱前端。它强调“变化、关系、时间和证据”，而不是新闻聚合、无依据排行榜或普通聊天机器人。

> 当前仓库是明确标记的演示快照。页面中的模型版本、指标、关系和日期用于验证产品体验，不应当作实时事实引用。

## 当前已实现

- 首页、知识库、实体详情、模型对比、证据化问答、关注管理和可标记已读的站内通知。
- 生产级 2D 图谱：搜索定位、时间 / 类型 / 关系 / 可信度筛选、缩放、平移、节点拖拽、邻域展开、最短路径高亮、边证据检查器和列表替代视图。
- 私密研究记录与公开分享页，支持逐结论引用、Markdown 下载和浏览器打印 / PDF。
- `/admin/review-demo` 只读审核后台：来源健康度、同步运行、候选 Claim、冲突风险和半自动审核流水线。
- 三步兴趣初始化，以及可查看、修改、暂停、清空的本地个性化画像。
- 每日邮件摘要偏好设置；演示版只在本机持久化并明确提示尚未连接投递服务。
- PWA manifest、安装入口、应用壳缓存、离线回退和最后缓存时间提示。
- 中文 / English、通俗 / 产品 / 技术阅读模式、明暗主题。
- 语言、阅读模式、主题、关注和个性化设置的本地持久化。
- 强类型领域模型，包括 Entity、Claim、Evidence、Timeline、Graph、Research、Review 和 Sync。
- 可替换的 `KnowledgeRepository`：未配置 API 时读取演示 adapter，配置后只读取真实 API，不静默回退。
- FastAPI、Pydantic、SQLAlchemy 与 Alembic 后端基础；公共 API 会隔离未审核 Claim。
- 受管理令牌保护的审核批准/拒绝、乐观并发控制和发布历史。
- loading、error、offline、cached、stale、unverified 和 conflict 的统一状态语义。
- 390px、1024px 和 1440px 响应式布局。
- 生产构建、TypeScript、ESLint 和领域 / 图谱 / PWA 自动测试。
- GitHub Actions 前后端质量门禁，包括演示种子漂移、迁移、静态检查、测试和构建。

## 仍为演示或尚未实现

- 当前没有真实采集、用户认证或模型调用；后端数据库与审核写入已经具备本地纵向闭环。
- AI 研究答案来自强类型演示快照，不会伪装为在线模型输出。
- 公开审核演示页严格只读；后端已提供受保护审核 API，但尚未建设真实管理端登录页面。
- 关注提醒与每日摘要尚未连接真实站内通知和事务邮件服务。
- 公开分享页当前读取演示快照；尚未连接真实发布权限与持久化 URL。
- PWA 在生产环境注册 Service Worker；正式安装和离线能力需要 HTTPS 部署验证。
- 登录、跨设备同步、真实公开部署和隔离的 3D 实验仍在后续范围。

## 主要演示入口

| 路径                                 | 用途                     |
| ------------------------------------ | ------------------------ |
| `/`                                  | 个性化变化与全行业必看   |
| `/knowledge`                         | 分类浏览实体             |
| `/knowledge/model/gpt`               | GPT 六段式实体档案       |
| `/graph`                             | 完整交互式 2D 知识图谱   |
| `/ask`                               | 证据化 AI 研究           |
| `/research/research-demo-gpt-claude` | 私密研究记录与导出       |
| `/share/research-demo-gpt-claude`    | 主动公开的研究页         |
| `/following`                         | 关注、提醒强度与兴趣画像 |
| `/onboarding`                        | 兴趣初始化               |
| `/admin/review-demo`                 | 只读数据治理与审核后台   |

三分钟演示路径见 [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)，架构与数据可信闭环见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，逐项交付边界见 [`docs/SPEC_TRACEABILITY.md`](docs/SPEC_TRACEABILITY.md)。

## 本地开发

需要 Node.js 20.19+。仓库保留 Lovable 生成的 `bun.lock`；可使用 Bun，也可以使用兼容的 npm/pnpm 环境。

```bash
npm install
npm run dev
```

后端搭建、迁移、运行和审核 API 示例见 [`backend/README.md`](backend/README.md)。

常用检查：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check
```

## 数据源切换

复制 `.env.example` 为本地环境文件并配置：

```bash
VITE_API_BASE_URL=https://api.example.com
```

未配置时，应用读取 `src/data/demo-adapter.ts`，所有页面保持“演示数据”标识。配置后，前端请求：

```text
GET {VITE_API_BASE_URL}/api/snapshot
```

真实 API 请求失败时显示错误状态，不会用演示数据伪装成实时响应。

## PWA 与离线

生产构建包含：

```text
public/manifest.webmanifest
public/sw.js
public/offline.html
public/icon.svg
```

Service Worker 只缓存同源 GET 页面和静态资源，不缓存 `/api/` 请求，也不会在网络失败时把演示数据冒充成实时 API。已访问页面可以离线打开；页面顶部会明确显示离线状态和最后在线缓存时间。

## 关键目录

```text
src/
├─ domain/       # 领域契约
├─ data/         # 明确标记的演示 adapter
├─ services/     # API / repository 边界
├─ hooks/        # React Query 接入
├─ components/   # 共享 UI、状态、图谱、研究报告与 PWA 状态
└─ routes/       # TanStack Start 文件路由

backend/
├─ app/           # FastAPI、可信快照、审核和持久化
├─ migrations/    # Alembic 数据库迁移
├─ data/          # 由前端强类型演示数据导出的种子
└─ tests/         # API 与审核门禁测试
```

## 协作约束

Lovable 负责集中视觉校准，Codex 负责类型、架构、数据、测试和生产化。同一时间只由一方修改已同步分支，避免 Lovable 与本地代码相互覆盖。
