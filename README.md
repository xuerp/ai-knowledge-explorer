<div align="center">

# AI Radar

### 让 AI 技术选型有据可查

从官方资料到结构化事实，再到可追溯的研究结论。

**React · TypeScript · TanStack · FastAPI · SQLAlchemy**

[项目案例](docs/portfolio/CASE_STUDY.md) · [运行与演示](docs/portfolio/WALKTHROUGH.md) · [真实数据](docs/portfolio/real-data/README.md) · [简历与面试](docs/portfolio/RESUME.md)

</div>

---

AI 工具的介绍容易找到，适用条件、信息时点与证据却常常散落各处。**AI Radar 是一个面向 AI 技术研究与选型的全栈项目**：将实体、事实和来源分开管理，让用户查清“这个判断依据什么”，再决定下一步。

项目的重点是证据建模、审核边界和跨页面研究流程。当前作品集使用小而可核对的真实资料集，不预置模型测评成绩、用户试用结果或商业效果。

## 一眼看懂项目

| 用户任务             | 产品能力                       | 工程实现                                |
| -------------------- | ------------------------------ | --------------------------------------- |
| 了解一个工具能做什么 | 搜索知识库、查看实体与能力要点 | Entity 与 Claim 分离，事实关联 Evidence |
| 核对判断是否可信     | 查看原文摘录、来源和日期       | 官方文档固定版本、来源引用、数据状态    |
| 带着具体需求研究     | 输入需求，查看证据与限制       | 检索、结构化回答、证据不足状态          |
| 留下研究过程         | 保存研究、查看历史与报告       | 账户、持久化 API、报告路由              |
| 维护公共知识         | 候选审核后发布                 | Candidate / Claim 分层、审核 API 与迁移 |

上表描述代码中的功能结构，不代表本次真实资料集已完成所有功能的端到端验收。[验证记录](docs/portfolio/VALIDATION.md)列明当前证据和缺口。

## 真实数据，而不是编造的展示内容

本次资料集于 **2026-10-24** 核对，包含 **2 个实体、6 条事实、2 份官方文档**：

| 对象      | 已收录事实范围                           | 原始资料                                                                                                                      |
| --------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dify      | 自托管入口、可视化工作流、RAG 文档处理   | [官方 README，固定 commit](https://github.com/langgenius/dify/blob/b535806c4acd03f3970dedc99537e1c1928034ce/README.md)        |
| LangChain | Agent / LLM 应用框架、组件接口、独立使用 | [官方 README，固定 commit](https://github.com/langchain-ai/langchain/blob/b15a385cb1aa4507b86a3ba1e6430748b0c4ae4b/README.md) |

6 条引用对应 2 份文档，不是 6 个独立信源。文档声称的能力不等于已经实测的效果。资料集没有虚构价格、性能排名、关注人数、通知或用户答案；没有依据的关系和更新事件保持为空。

[数据快照](docs/portfolio/real-data/snapshot.json)与[来源清单](docs/portfolio/real-data/sources.json)可直接检查；清单记录固定版本、原文摘录与原始 HTTP 字节的 SHA-256。

```bash
python scripts/verify-portfolio-sources.py --fetch
```

## 本地运行真实来源版本

需要 Python 3.12、Node.js 22 和 Bun 1.4.3。在仓库根目录创建环境：

```bash
git clone https://github.com/xuerp/ai-knowledge-explorer.git
cd ai-knowledge-explorer
python -m venv backend/.venv
```

Windows PowerShell：

```powershell
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe backend/scripts/serve_portfolio.py
```

macOS / Linux：

```bash
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python backend/scripts/serve_portfolio.py
```

另开终端启动前端：

```bash
bun install --frozen-lockfile
node scripts/dev-portfolio.mjs
```

打开[知识库（本机）](http://127.0.0.1:8085/knowledge?category=all)，API 文档位于[本机 /docs](http://127.0.0.1:8004/docs)。两个进程都需要保持运行。

专用启动器统一前端初始快照和后端资料来源，使用独立 SQLite 数据库，不需要模型密钥，不启用付费生成、自动抽取或邮件发送。数据库与会话密钥保存在被 Git 忽略的 `artifacts/portfolio-local/`；资料版本变化时使用新的数据库，避免旧种子残留。

> 请使用上述专用启动方式。普通 `bun run dev` 保留历史开发样例配置；预发布网站与本资料集不是同一部署。界面的 `demo` 是现有运行模式标记，不代表这些官方事实是虚构数据，也不代表已通过生产就绪门槛。

## 架构与关键取舍

| 层次             | 职责                           | 代码入口                                                 |
| ---------------- | ------------------------------ | -------------------------------------------------------- |
| React / TanStack | 路由、知识库、研究与报告       | [`src/routes`](src/routes)                               |
| API 客户端       | 数据访问与用户操作             | [`src/services`](src/services)                           |
| FastAPI          | 请求校验、权限与业务接口       | [`backend/app/main.py`](backend/app/main.py)             |
| 知识层           | Entity、Claim、Evidence 与快照 | [`backend/app/repository.py`](backend/app/repository.py) |
| 数据持久化       | SQLAlchemy 与数据库迁移        | [`backend/migrations`](backend/migrations)               |

- **事实与推断分开**：来源是独立对象，候选内容不能直接等同于已审核事实。
- **检索先于生成**：本地作品集关闭模型生成，便于检查证据链。
- **未知保持未知**：没有实测结果时，不将文档能力包装成性能结论。
- **小范围可复核**：以固定来源证明数据流；扩大市场覆盖需要独立的数据质量工作。

详细设计见[架构文档](docs/ARCHITECTURE.md)和[架构决策记录](docs/adr)。历史评测仅适用于原记录的版本与语料，不作为当前成绩。

## 项目边界

当前交付目标是可复现、可解释的作品集项目。实时全市场覆盖、长期无人值守采集、跨供应商真实模型评测和生产稳定性，不在本次已验证能力之内。真实资料集上的完整浏览器验收仍待完成，详见[验证记录](docs/portfolio/VALIDATION.md)。

没有宣称用户增长、节省成本、生产 SLA 或不存在的准确率。用于简历时，请按实际参与范围描述个人职责。

## 继续阅读

- [项目案例](docs/portfolio/CASE_STUDY.md) · [演示路线](docs/portfolio/WALKTHROUGH.md)
- [简历与面试](docs/portfolio/RESUME.md) · [完整文档索引](docs/README.md)
- [后端说明](backend/README.md) · [MIT License](LICENSE)
