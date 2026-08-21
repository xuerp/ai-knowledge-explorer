# AI Radar 简历与面试材料

本文只使用已实现能力和真实公开数据，不把 `demo/cached` 描述成正式实时生产数据。

## 简历项目名称

**AI Radar｜AI 技术情报与研究平台｜独立产品设计与全栈落地**

## 中文简历版

- 独立设计并落地 AI 技术情报平台，将官方博客、文档、Release Notes 与技术资料转化为 Entity、Claim、Evidence、Timeline 和 Relation，形成持续采集—LLM 抽取—审核—发布—研究闭环。
- 针对 LLM 幻觉、结构化输出兼容、重复事实、冲突来源和过期信息，设计 Candidate/Verified Claim 分层、证据锚点、严格字段校验、语义去重、风险分级审核与黄金问题质量门槛。
- 设计 Timeline、GPT/Claude/Gemini Compare 与 Evidence-backed Research 三个核心体验；公开快照包含 49 个实体、23 条 Claim、40 条证据、71 条关系和 55 条时间线，并明确保持 `demo/cached` 直到正式质量门槛通过。
- 将 React/TanStack、FastAPI、PostgreSQL、Cloudflare Workers、Render 与 Neon 组合为可公开访问产品，并通过前后端测试、Ruff、TypeScript、生产构建和双数据库迁移验证保护发布质量。

## 招聘网站短版

独立完成 AI Radar：一个持续追踪 AI 模型、Agent 与产品变化的情报平台。产品不让 LLM 直接定义事实，而是通过 Candidate、Evidence、语义去重、冲突检测和人工/风险分级审核，把概率性输出转化为可追踪的 Timeline、Compare 和研究结论。项目已公开预发布，并保留严格的 demo→live 质量门槛。

## 30 秒介绍

> AI Radar 是一个持续追踪 AI 模型和 Agent 更新的情报平台。它把分散的官方资料转化成有证据的事实、时间线和关系。和一次性 ChatGPT 问答不同，AI Radar 会长期维护知识状态；LLM 只能生成 Candidate，内容经过证据、结构、重复、冲突和审核检查后才能进入公开知识库。

## 2 分钟介绍

> 我最初想解决“主流 AI 最近发生了什么变化”，第一反应也是直接做 LLM 问答。但这种方式没有长期状态，每次都要重新搜索和验证，而且模型输出如果直接保存，会把一次错误扩散到后续对比和研究。
>
> 所以我把产品从 AI Q&A 转向 Persistent AI Intelligence Layer。系统持续采集官方来源，保存快照和 Diff，让模型抽取 Candidate，再经过证据锚点、严格字段校验、语义去重、冲突检测和风险分级审核。通过后才成为 Verified Claim。
>
> 用户端我收敛成三个核心体验：用 Timeline 看一个产品如何演进；在统一维度下比较 GPT、Claude、Gemini；基于已审核 Claim 和 Evidence 做跨实体研究。证据不足时系统会明确拒答。
>
> 当前产品已经公开预发布，但我把 Showcase Ready 和 Live Ready 分开。作品集可以使用明确标记的精选快照；正式模式仍必须达到 150 条已审核 Claim、核心关系覆盖、黄金问题和生产检查，不能为了展示降低门槛。

## 高频面试问题

### 为什么不直接使用 ChatGPT？

ChatGPT 擅长一次性生成；AI Radar 解决长期追踪。它维护固定实体、时间线、关系和证据状态，减少反复搜索、重新组织 Prompt 和重新核验来源的成本。

### 为什么 LLM 不能直接写知识库？

模型可能漏掉限定词、混合相邻语句或补充记忆。一次回答错误是局部问题，直接写库会把错误传播到 Timeline、Compare、Graph 和 Research，因此 LLM 只承担提议者角色。

### 为什么区分 Candidate 和 Verified Claim？

这个边界明确表达“模型生成”和“系统认可”不是同一件事。Candidate 是待验证草稿，只有通过证据、结构、冲突、重复和审核检查后才获得公开事实资格。

### 为什么有链接还需要证据锚点？

链接只能把审核者带到整篇文档；锚点直接保存支持 Claim 的原文片段，既降低人工核验成本，也让系统检查模型是否真的能在原文中找到依据。

### 为什么 JSON Schema 不兼容时允许降级？

供应商兼容性会影响可用性，因此可以从 `json_schema` 降级到 `json_object`。但 `json_object` 只保证合法 JSON，不能保证业务结构，所以仍必须做严格字段、类型、枚举、长度和额外字段校验。

### 自动批准和人工审核怎么取舍？

先 Human-in-the-loop。只有官方来源、精确锚点、主体对象唯一、无冲突且不涉及价格、Benchmark、安全事件等高风险语义的 Tier 1 内容，才能在真实人工样本精度达到 98% 后扩大自动批准，并保留随机抽检。

### 为什么不直接把 demo 改成 live？

Showcase Ready 衡量产品是否容易理解和体验；Live Ready 衡量数据覆盖与生产运行是否足够正式。两者使用同一架构，但完成标准不同。提前改 live 会误导用户，也会破坏质量门槛的可信度。

### 你做过最重要的取舍是什么？

完成核心闭环后主动 Feature Freeze，把资源从继续增加后台功能转向首页、Timeline、Compare、Research、证据体验和 Case Study；同时坚持核心实体深度优先于实体总量。

## 不能夸大的内容

- 不能说当前是实时正式数据；公开模式仍为 `demo/cached`。
- 不能说已经达到 150 条 Claim 或核心关系门槛。
- 不能说 SMTP、正式域名、外部监控和备份恢复已经验收。
- 不能把演示数据中的模型指标当作当前采购依据。
