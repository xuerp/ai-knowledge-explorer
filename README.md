# AI Radar

AI Radar 是一个面向 AI 模型、Agent、框架、论文和 Benchmark 的时序知识图谱前端。它强调“变化、关系、时间和证据”，而不是新闻聚合、无依据排行榜或普通聊天机器人。

> 当前仓库是明确标记的演示快照。页面中的模型版本、指标、关系和日期用于验证产品体验，不应当作实时事实引用。

## 当前已实现

- 首页、知识库、实体详情、2D 图谱、证据化问答、关注管理和模型对比。
- 中文 / English、通俗 / 产品 / 技术阅读模式、明暗主题。
- 语言、阅读模式和主题的本地持久化及跨标签页同步。
- 强类型领域模型，包括 Entity、Claim、Evidence、Timeline、Graph、Research、Review 和 Sync。
- 可替换的 `KnowledgeRepository`：未配置 API 时读取演示 adapter，配置后只读取真实 API，不静默回退。
- loading、error、offline、cached、stale、unverified 和 conflict 的统一状态语义。
- 390px、1024px 和 1440px 响应式布局。

## 仍为演示或尚未实现

- 当前没有真实采集、数据库、审核写操作、认证或模型调用。
- AI 研究答案来自强类型演示快照，不会伪装为在线模型输出。
- 图谱是确定性 2D 演示布局；缩放、拖拽、路径搜索和证据抽屉属于下一阶段。
- `/admin/review-demo`、PWA、离线缓存时间、私密研究和公开分享尚未完成。

## 本地开发

需要 Node.js 20.19+。仓库保留 Lovable 生成的 `bun.lock`；可使用 Bun，也可以使用兼容的 npm/pnpm 环境。

```bash
npm install
npm run dev
```

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

## 关键目录

```text
src/
├─ domain/       # 领域契约
├─ data/         # 明确标记的演示 adapter
├─ services/     # API / repository 边界
├─ hooks/        # React Query 接入
├─ components/   # 共享 UI、状态与图谱
└─ routes/       # TanStack Start 文件路由
```

## 协作约束

Lovable 负责集中视觉校准，Codex 负责类型、架构、数据、测试和生产化。同一时间只由一方修改已同步分支，避免 Lovable 与本地代码相互覆盖。
