# 关系官方信源缺口工作清单

版本：1.0.0

评估日期：2026-08-31

输入诊断：`relation_gap_diagnosis_v1.0.0_8978fef80e19.json`

> 本清单基于既有关系覆盖、官方 Evidence 使用情况和人工复核优先级，不基于核心实体两两组合。表中的覆盖差值不是关系配额；没有直接证据时不创建关系。

## 诊断结论

- 固定快照包含 19 个核心实体，其中 16 个低于既有 5 条质量阈值，覆盖差值为 44。
- 76 条已发布关系均为非冲突且 Evidence 引用完整。
- 212 条官方 Evidence 中，181 条未被任何已发布关系引用；其中 83 条可通过现有 Claim、Timeline 或实体字段关联到核心实体。
- `cited-by` 与 `integrates-with` 当前均为 0 条。该结果只说明类型尚未出现在发布图谱，不证明必须补充这两类关系。
- 先复核 83 条已有官方 Evidence，再考虑新增采集；不得把“未被关系使用”直接解释成“其中必然包含关系”。

## 16 个低覆盖核心实体的人工工作清单

“未用官方 Evidence”是指已在快照中、但未被任何已发布关系 `sourceIds` 引用的官方 Evidence 数量。

| 实体                                      | 已发布关系 / 类型                         | 未用官方 Evidence | 真实薄弱面与下一步                                                                            | 处理决定               |
| ----------------------------------------- | ----------------------------------------- | ----------------: | --------------------------------------------------------------------------------------------- | ---------------------- |
| AutoGen (`e-autogen`)                     | 1；`developed-by`                         |                 0 | 当前没有可复核的未用官方 Evidence；需要新的官方扩展或集成文档，且正文必须直接锚定两个目录实体 | A：准备新信源          |
| CrewAI (`e-crewai`)                       | 1；`developed-by`                         |                 0 | 当前没有可复核的未用官方 Evidence；优先检查官方 MCP/工具集成说明                              | A：准备新信源          |
| Devin (`e-devin`)                         | 1；`developed-by`                         |                 0 | 当前没有可复核的未用官方 Evidence；优先检查官方集成目录中的目录实体锚点                       | A：准备新信源          |
| Manus (`e-manus`)                         | 1；`developed-by`                         |                 0 | 当前没有可复核的未用官方 Evidence；优先检查官方 Connector/MCP 文档                            | A：准备新信源          |
| OpenAI Codex (`e-codex`)                  | 2；`developed-by`、`uses`                 |                 2 | 先复核现有 OpenAI 模型目录与 API 更新日志；只有出现明确双端点关系语义才进入候选               | A：先复核既有 Evidence |
| 豆包 Doubao (`e-doubao`)                  | 2；`part-of`                              |                 3 | 先复核 Seed 2.0 官方发布页中的版本演进、基准或明确依赖语义                                    | A：先复核既有 Evidence |
| Gemini CLI (`e-gemini-cli`)               | 2；`developed-by`、`uses`                 |                 0 | 当前无未用官方 Evidence；后续只检查官方仓库、发布说明或集成文档                               | B：等待 A 组复核结果   |
| Kimi (`e-kimi`)                           | 2；`part-of`                              |                 4 | 先复核 Kimi 平台与 Moonshot 官方材料；产品能力描述本身不转成关系                              | A：先复核既有 Evidence |
| LangGraph (`e-langgraph`)                 | 2；`based-on`、`part-of`                  |                 4 | 先复核 LangChain 官方框架材料中的明确集成或依赖锚点                                           | A：先复核既有 Evidence |
| OpenAI Agents SDK (`e-openai-agents-sdk`) | 2；`developed-by`、`uses`                 |                 0 | 当前无未用官方 Evidence；后续检查官方 SDK 文档中的协议或工具集成                              | B：等待 A 组复核结果   |
| Claude Code (`e-claude-code`)             | 3；`developed-by`、`uses`                 |                22 | 现有 Anthropic 与 MCP 官方 Evidence 数量充足，禁止新增采集前先完成关系语义复核与重复检查      | A：先复核既有 Evidence |
| 文心一言 ERNIE Bot (`e-ernie`)            | 3；`part-of`                              |                 0 | 当前无未用官方 Evidence；后续只检查百度官方版本、基准或集成公告                               | B：等待 A 组复核结果   |
| Model Context Protocol (`e-mcp`)          | 3；`developed-by`、`uses`                 |                12 | 先复核 MCP 官方架构材料；协议说明不能自动推导所有产品都与 MCP 集成                            | A：先复核既有 Evidence |
| 通义千问 Qwen (`e-qwen`)                  | 3；`benchmarked-on`、`part-of`            |                10 | 先复核官方模型 README 中的版本、基准与明确基础技术语义                                        | A：先复核既有 Evidence |
| DeepSeek 系列 (`e-deepseek`)              | 4；`based-on`、`competes-with`、`part-of` |                 0 | 当前无未用官方 Evidence；后续只检查官方技术报告、模型卡或发布说明                             | B：等待 A 组复核结果   |
| Gemini 系列 (`e-gemini`)                  | 4；`competes-with`、`part-of`、`uses`     |                 3 | 先复核 Gemini API 官方更新日志；一般能力更新不转成关系                                        | A：先复核既有 Evidence |

## 新官方信源候选与去重结果

只为关系数最低且没有任何未用官方 Evidence 的 4 个实体准备首批候选。2026-08-31 已按去除尾斜杠后的完整 URL 与 218 条 Evidence 交叉检查，4 个 URL 的既有 Evidence 命中数均为 0。

| 实体    | 官方候选渠道                                                                                                | 页面中已观察到的关系锚点                                                | URL 去重 | Snapshot 状态       |
| ------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- | ------------------- |
| AutoGen | [官方 MCP 扩展参考](https://microsoft.github.io/autogen/stable/reference/python/autogen_ext.tools.mcp.html) | 页面明确说明 `McpWorkbench` 封装 MCP server；仍需人工确认目录端点和谓词 | 0 命中   | 已保存；30,599 字符 |
| CrewAI  | [官方 annotations 文档](https://docs.crewai.com/learn/using-annotations)                                    | 页面明确说明 MCP server adapter；仍需人工确认主语与集成方向             | 0 命中   | 已保存；7,030 字符  |
| Devin   | [官方集成概览](https://docs.devin.ai/integrations/overview)                                                 | 页面明确列出 MCP 与多类原生集成；只保留能唯一解析到目录实体的内容       | 0 命中   | 已保存；4,403 字符  |
| Manus   | [官方 Connectors 帮助页](https://help.manus.im/en/articles/12231777-how-can-i-use-manus-connectors)         | 页面明确提到 MCP servers；仍需区分 Connector 能力与已发布产品关系       | 0 命中   | 已保存；5,155 字符  |

### Snapshot 安全边界

已使用仓库现有 `SafeHttpFetcher` 对上述 4 个 URL 逐一执行只读抓取。当前执行环境的 DNS 对四个域名均返回了被策略判定为非公网的地址，抓取器按设计抛出 `Source hostname resolves to a non-public address.`，因此：

- 没有绕过 SSRF / DNS 安全校验；
- 没有伪造 Snapshot、内容哈希或 Diff；
- 没有写入 staging/生产数据库；
- 没有触发任何模型调用；
- 4 个候选保持 `安全抓取阻塞`，只能在受信任且 DNS 可验证为公网的采集环境中重试。

2026-09-01 的后续重试没有放宽上述边界：仓库只增加四个精确官方主机名，Render 部署提交 `7f5bd8f` 后使用相同 `SafeHttpFetcher` 逐个预检和采集。四个入口全部通过并形成不可变 Snapshot；CrewAI 自动采纳其官方版本化 Markdown canonical URL。后台审计逐项记录 `source.probe`、`source.update` 与 `source.collect`，当前为待抽取 4、采集重试 0、抽取冷却 0，且没有触发模型调用。

## 进入 2B 前的执行门

1. [x] 在受信任采集环境中用 `SafeHttpFetcher` 重试 A 组 4 个 URL，并保存不可变 Snapshot / Diff。
2. 对新 Snapshot 再做 URL、内容哈希和语义指纹三层去重。
3. 人工确认正文同时锚定两个唯一目录实体和本体谓词语义。
4. 需要模型抽取时先获得用户对新增付费调用的明确授权。
5. 所有候选进入人工审核；保持 `AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS=false`。
