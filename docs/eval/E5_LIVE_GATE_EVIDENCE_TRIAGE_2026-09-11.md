# E5 Live Gate：只读核验、Golden 评估与关系证据分级

日期：2026-09-11

范围：只读核验、本地隔离评估，以及经授权的单次 staging Hybrid Golden 评测。未切换 `live`，未执行 production 写入，未触发模型抽取、关系批准或外部供应商探针。Hybrid 评测允许在 staging 写入 Embedding 索引/预算账本。

## 1. 当前结论

E5 尚未通过，必须继续保持 `demo/staging`。

- staging `/ready` 与 `/health` 均返回 200；应用构建为 `edd9131222acca6f7f9b4d5f35707517207768c3`，迁移版本为 `20260905_0023`。
- 运行环境报告 `production`，但数据模式仍为 `demo`；JWT 已启用，管理员写入能力存在但本次未使用。
- 公开快照时间为 `2026-09-11T00:57:51.751519+00:00`，包含 49 Entity、200 Claim、222 Evidence、78 Relation、55 Timeline。
- 质量计算结果：Evidence 引用覆盖 100%，官方 Evidence 97.30%，人工核验 99.10%，180 天新鲜度 100%，已核验内容 98.50%，23 个来源域名，0 个缺失引用或缺失实体。
- `liveReady=false` 的当前数据阻塞仍只有核心关系覆盖：16 个核心实体合计距既有阈值 41 条。
- 关系回填批次 `2026-09-core-relations-02` 已完成 4/4：成功 4、候选 1、重复 1、自动批准 0、剩余合格 Snapshot 0。
- 管理员会话恢复后，于 2026-09-11 09:15–09:16（UTC+8）重新读取受保护页面：`production-readiness` 为 3 项阻塞、0 项警告；阻塞项仍为 `demo`、邮件未配置和数据质量未通过。
- worker 心跳正常；最近周期 `59087ef4-c51e-4bba-9379-11894c931c98` 于 09:01:12 自动完成，耗时 19.1 秒。采集重试、采集熔断、抽取冷却、邮件待发/重试/发送中/终态失败均为 0；仍有 4 个待抽取 Snapshot。
- AI 抽取已配置但自动抽取未启用；关系自动批准保持为 0。Hybrid 为 Cloudflare `@cf/baai/bge-m3`、1024 维。
- 当前 Hybrid 面板显示每日上限为 1000 Neurons / 1000 次请求，而历史发布基线记录为 100 / 100；该差异必须作为供应商预算配置漂移核对，不能默认视为已授权扩容。
- 提交 `edd9131` 的 GitHub Quality #297（1 分 46 秒）与 Staging acceptance #19（1 分 43 秒）均通过；Cloudflare 与 Render 已由发布门确认对齐该提交。
- 2026-09-11 17:53–17:54（UTC+8）通过受保护管理后台运行一次完整 Hybrid Golden：证据可回答 18/20（90%），检索 17/20（85%），`ragReady=true`。RAG 子门禁通过，但 E5 整体仍被核心关系覆盖、`demo` 数据模式、邮件和外部人工门禁阻塞。

## 2. Golden 问题评估

### 2.1 20 题产品 Golden Set（staging Cloudflare Hybrid）

在构建 `edd9131` 的受保护 staging 管理后台运行完整端点；检索模式为 Hybrid，Embedding 为 Cloudflare `@cf/baai/bge-m3`（1024 维）。

| 指标 | 结果 | 判断 |
| --- | ---: | --- |
| 证据可回答性 | 18 / 20（90%） | 通过 85% 门槛 |
| RAG 检索通过 | 17 / 20（85%） | `ragReady=true`，无安全余量 |
| Entity Recall@8 | 92.50% | 通过 |
| Claim Recall@8 | 100% | 通过 |
| Citation Coverage | 100% | 通过 |
| Official Source Ratio | 97.39% | 通过 |
| Temporal Accuracy | 66.67% | 需继续改善 |
| Refusal Accuracy | 100% | 通过 |
| Lifecycle Precision | 100% | 通过 |

检索失败 3 题：

1. `gq-02` GPT 与 Claude 上下文比较：Entity Recall@8 为 50%，Citation Coverage 为 100%。
2. `gq-04` DeepSeek 演化路径：Entity Recall@8 为 100%、Citation Coverage 为 100%，但仍未满足 RAG 基线的 Claim 检索约束。
3. `gq-16` 过去一年模型能力变化：Entity Recall@8 为 0%、Citation Coverage 为 100%，同时证据图未覆盖 `e-claude`、`e-gemini`、`e-gpt`。

证据可回答性失败 2 题：`gq-15` 因快照没有可解释的冲突或证据不足候选而拒答，`gq-16` 因问题解析及一跳证据图未覆盖三个预期模型系列而失败。结果显示当前改进守住了 85% RAG 门槛，但与本地候选 lexical 95% 仍有差距，且不能把 Hybrid 通过误写为 E5 整体通过。

### 2.2 20 题产品 Golden Set（完整 RAG 路径，本地隔离 lexical）

对最新 staging 公共快照运行 `GoldenQuestionEvaluator`，使用隔离的内存 SQLite 和 `LexicalRagRetriever`，未调用外部 Embedding 或生成供应商。

| 指标 | 结果 | 判断 |
| --- | ---: | --- |
| 快速证据可回答性 | 18 / 20（90%） | 通过 85% 门槛 |
| RAG 检索通过（部署代码基线） | 17 / 20（85%） | `ragReady=true`，但没有安全余量 |
| RAG 检索通过（本地候选） | 19 / 20（95%） | 增加 10 个百分点余量 |
| Entity Recall@8（本地候选） | 95.00% | 改善 |
| Claim Recall@8（本地候选） | 100% | 通过 |
| Citation Coverage | 100% | 通过 |
| Official Source Ratio | 97.39% | 通过 |
| Temporal Accuracy（本地候选） | 83.33% | 从 66.67% 改善 |
| Refusal Accuracy | 100% | 通过 |
| Lifecycle Precision | 100% | 通过 |

部署代码基线的三个检索失败样本：

1. `gq-04` DeepSeek 演化路径：Entity Recall@8 为 0%。
2. `gq-07` OpenAI 图谱中的模型或协议：Entity Recall@8 为 50%。
3. `gq-16` 最近一周模型变化：Entity Recall@8 为 33.33%，同时也是快速证据层未通过项。

本地候选通过三个确定性改进，把 `gq-07` 和 `gq-16` 修复为通过：关系型查询纳入带完整 Evidence 的已核验一跳邻居；宽泛模型查询按顶层模型系列保留多样性；平台问题对 availability 谓词提供小幅确定性加权。没有改变门槛或 Golden 标注。

本地候选仍有一个失败：`gq-04`。最新快照中 DeepSeek 只有带来源 Timeline 和一条 `inferred` Claim，没有可被当前检索索引的 `verified` Claim。该项必须通过真实审核数据修复，不能由代码伪造 Citation。

### 2.3 80 题固定 Retrieval Golden Set（SQLite lexical）

最新快照 SHA-256 为 `ba027d3d476e99f41fa0b6a76f8dc62eadb375a65bb47f66a4a1dd3cd2601b9f`。

| 指标 | 结果 |
| --- | ---: |
| 通过率（部署代码基线） | 79 / 80（98.75%） |
| 通过率（本地候选） | 80 / 80（100%） |
| Recall@8（本地候选） | 100% |
| Precision@8（本地候选） | 14.22% |
| Entity Recall@8 | 99.38% |

部署代码唯一失败样本为 `timeline-015`：关于 Claude 3.7 Sonnet 提供平台的问题只召回了两个期望 Claim 中的一个。本地候选通过 availability 谓词意图加权将其修复为通过。

本结果是 SQLite 便携基线，不等同于 staging PostgreSQL FTS 或 Cloudflare Hybrid；staging Hybrid 发布基线见 2.1。

## 3. 41 条关系覆盖差值的证据分级

分级只回答“下一步是否有真实证据路径”，不把差值当作发布配额。

### P0：可直接安全发布

当前为 0 条。

最新快照有 84 条未被关系引用、且与核心实体关联的官方 Evidence，但没有一条同时满足：

1. 主语和宾语都能唯一解析到现有目录实体；
2. 谓词属于关系本体；
3. 不与已发布边语义重复；
4. Evidence 原文直接支持该双端点关系。

因此不能从现有 84 条 Evidence 直接批量制造关系。

### P1：已有官方 Evidence，但只能人工判定、合并 Evidence 或先补目录端点

| 核心实体 | 当前 / 差值 | 未用官方 Evidence | 证据判断 | 最短下一步 |
| --- | ---: | ---: | --- | --- |
| Claude Code | 3 / 2 | 22 | `Claude Code is an MCP host` 可补强已有 Claude Code→MCP 边；其余多为能力、状态或重复 Claim。Claude Opus 4.8、GitHub 等目标未必是现有目录端点。 | 仅做已有边 Evidence 合并审查；不计作新关系。 |
| OpenAI Codex | 2 / 3 | 2 | 两条都描述 `codex-mini-latest` 为 Codex CLI 优化；`Codex CLI` 已是 `e-codex` 别名，不能形成自环。 | 若产品确需版本级关系，先独立评审是否新增模型实体。 |
| Doubao | 2 / 3 | 3 | Seed 2.0、Volcano Engine 与 Doubao 的语义存在，但目标实体缺失或表述不足以唯一落到现有端点。 | 先确认目录建模边界，再决定是否新增公司/平台端点。 |
| LangGraph | 2 / 3 | 4 | 均为持久化、人机协作、durable execution、低层编排等能力 Claim，没有第二目录实体。 | 使用官方集成/依赖文档寻找双端点证据。 |
| Kimi | 3 / 2 | 4 | Kimi App、Chrome Extension 和工具调用能力的目标端点不在目录；Kimi K3 关系已经存在。 | 不把渠道和能力硬转成关系；需要新的目录端点或其他官方关系证据。 |
| Qwen | 3 / 2 | 10 | 涉及 Ollama、llama.cpp、Transformers、许可、上下文和未入目录版本；当前目标均不可唯一解析为现有实体。 | 只在目录策略允许新增端点后评审依赖关系。 |
| Gemini family | 4 / 1 | 4 | Managed Agents、Computer Use、File Search、Transcribe 多为能力/子产品，目标端点缺失。 | 优先人工核验 Gemini→Google `developed-by` 的直接官方锚点。 |
| MCP | 4 / 1 | 12 | 均为协议内部角色、传输和 primitives；不能把内部概念当作目录实体。与 Claude Code/Devin 的边已存在。 | 只接受新的产品集成官方文档，避免重复已有边。 |

P1 覆盖差值合计 17；这不表示这些差值都可由现有 Evidence 修复。

### P2：当前无可复核的未用官方 Evidence，需要明确的新信源或待抽取 Snapshot

| 核心实体 | 当前 / 差值 | 已知证据路径 | 可修复性 |
| --- | ---: | --- | --- |
| AutoGen | 1 / 4 | 已保存官方 MCP 扩展 Snapshot；需人工确认 AutoGen→MCP 与 `integrates-with` 语义。 | 高：待抽取/人工审核，但不得自动批准。 |
| CrewAI | 1 / 4 | 已保存官方 MCP adapter Snapshot；需确认主体是 CrewAI 产品本身。 | 高：待抽取/人工审核。 |
| Manus | 1 / 4 | 已保存官方 Connectors/MCP Snapshot；需区分 Connector 能力与已发布集成关系。 | 高：待抽取/人工审核。 |
| Devin | 2 / 3 | Devin→MCP 已批准并发布；当前无第二条未用官方 Evidence。 | 中：需新的官方集成证据。 |
| Gemini CLI | 2 / 3 | 可核验官方 MCP server 配置文档。 | 高：需新信源或受控采集。 |
| OpenAI Agents SDK | 2 / 3 | 可核验官方 SDK MCP 文档。 | 高：需新信源或受控采集。 |
| ERNIE Bot | 3 / 2 | 当前无未用官方 Evidence；需要官方版本、基准或集成公告，且目标必须已在目录。 | 中低。 |
| DeepSeek family | 4 / 1 | 当前无未用官方 Evidence；需要官方技术报告、模型卡或发布说明中的唯一双端点锚点。 | 中。 |

P2 覆盖差值合计 24。已保存的 AutoGen、CrewAI、Manus Snapshot 是最短的下一批，但启动抽取会调用外部模型并写入审核队列，需先获得明确授权和预算确认。

### 历史关系 Claim

受保护页面确认：26 条关系型 Claim、10 条已链接、0 条可确定性修复、16 条需要人工判断。

| 分组 | Claim | 判断 |
| --- | --- | --- |
| 源实体关联需人工修复 | `claim-d09942e317650cc3435d`（Claude 3.7→SWE-bench Verified）、`claim-c544c2ed2ada9fb5a54b`（Claude 3.7→Anthropic） | 公共 Claim 已有关联实体，但历史审核行缺少合法源实体。需核对原始 Evidence 与具体版本归属；前者目标已在目录，后者的 Claude 3.7 具体端点仍不唯一。 |
| 可考虑新增明确产品/框架端点 | `claim-36513ae7dedc09e1fc93`（Claude Code→Claude Opus 4.8）、`claim-37d0d89648d2a393d0c3`（LangChain→LangSmith）、`claim-74fd2e6ec62f858d75cc`（ERNIE 5.1→PaddlePaddle） | 关系语义清楚，但目标不在当前目录。新增端点必须先通过目录范围评审。只有 Claude Code 这一条可能直接减少当前核心差值 1。 |
| Benchmark 端点候选 | `claim-28476f793c22ba4bc0b4`（WorldTravel）、`claim-263c6b747ae00eacada2`（ZeroBench）、`claim-bc0878766ddba613fcef`（VLMsAreBiased）、`claim-48213f05b19dcaf25309`（VideoMME）、`claim-ab7cc2db59c77666bd0b`（τ³-bench）、`claim-a6bf7bb89ea9aeb1e43b`（Arena Search）、`claim-586c43110316fad28627`（AIME26） | 可以保留为事实，但为修复单条历史 Claim 批量扩张 Benchmark 目录会制造低价值端点。这些边落在具体版本上，也不会直接降低 Doubao/ERNIE 系列的核心差值。 |
| 工具名称重复/规范化 | `claim-f94f9f7b5033aa600b03`、`claim-1b0f409b34194dc20bc3`（VideoCut） | 两条语义重复且目标文本不同；若新增 VideoCut，必须先合并语义指纹，不能形成两条边。 |
| 概念不应为补数而实体化 | `claim-bedca8ceed0954f4bc73`（MCP→JSON-RPC 2.0）、`claim-651c65451adfbda8426e`（Transformer paper→attention mechanisms） | 技术陈述可保留为 Claim；除非产品范围明确需要协议/概念节点，否则不为关系门槛新增端点。 |

结论：这 16 条没有可直接自动修复项，且最多只有 Claude Code→Claude Opus 4.8 明确可能减少核心差值 1。历史 Claim 审计不是填补 41 条差值的捷径。

## 4. E5 最短执行顺序

1. **继续稳定 Golden 检索。** staging Hybrid 已守住 17/20（85%）门槛，但没有安全余量；下一步聚焦 `gq-02`、`gq-04`、`gq-16`，目标不是勉强通过，而是恢复已发布 Hybrid 100% 基线或解释真实退化。
2. **核对 Hybrid 预算漂移。** 本次已在用户授权下运行一次限额内评测；后续再次运行全量评估前，仍需明确 100→1000 是否为负责人有意配置。
3. **处理 P1 人工证据审查。** 先确认 Gemini→Google 候选与 Claude Code→MCP Evidence 合并；其余条目只有在端点建模被明确接受时才继续。
4. **处理已保存的三条高可修复 Snapshot。** AutoGen、CrewAI、Manus 只进入小批量抽取和人工审核，保持自动抽取关闭、关系自动批准为 0。该步骤需要外部模型调用和 staging 写入授权。
5. **再扩展新信源。** Gemini CLI、OpenAI Agents SDK、Devin、DeepSeek、ERNIE 按单条官方来源采集，不做实体两两组合，不承诺填满 41。
6. **外部运行门禁。** 配置并验证邮件；完成域名/TLS/安全头、备份与真实恢复、站外监控故障注入、供应商预算/限流/告警留痕。
7. **最后才讨论 E6。** 仅当自动阻塞为 0、`liveReady=true`、四项人工检查和责任表完成，并获得明确授权后，才允许切换 `live` 或生产写入。

## 5. 当前需要用户的明确操作点

- staging 管理员会话已恢复；完整 Hybrid Golden 已通过新增加的按需按钮运行，结果为 17/20（85%），RAG 子门禁通过。
- 请确认 Hybrid 日上限 1000 Neurons / 1000 次是否为有意配置；历史基线是 100 / 100。
- 若要对 AutoGen、CrewAI、Manus 已保存 Snapshot 运行模型抽取，需要另行明确授权本次 staging 写入及外部模型预算；当前不执行。
- 邮件供应商、API/SMTP 密钥、正式域名绑定、付费监控与备份配置继续保持未操作状态。

## 6. 证据文件

- 最新关系诊断：`docs/eval/results/relation_gap_diagnosis_v1.0.0_ba027d3d476e.json`
- 最新关系诊断摘要：`docs/eval/results/relation_gap_diagnosis_v1.0.0_ba027d3d476e.md`
- 最新 80 题 lexical 结果：`docs/eval/results/v1.0.0_ba027d3d476e_sqlite_lexical_top8.json`
- 最新 80 题 lexical 摘要：`docs/eval/results/v1.0.0_ba027d3d476e_sqlite_lexical_top8.md`
- 本地候选 80 题 lexical 结果：`docs/eval/results/v1.0.0_ba027d3d476e_sqlite_lexical_top8_candidate.json`
- 本地候选 80 题 lexical 摘要：`docs/eval/results/v1.0.0_ba027d3d476e_sqlite_lexical_top8_candidate.md`
- 历史官方信源工作清单：`docs/eval/source_gap_worklist.md`
