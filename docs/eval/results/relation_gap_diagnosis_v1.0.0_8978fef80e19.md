# 关系缺口只读诊断

- 诊断版本：v1.0.0
- 快照 SHA-256：`8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e`
- 快照时间：`2026-08-30T12:53:42.447278+00:00`
- 已发布关系：76（Evidence 完整且非冲突：76）
- 核心实体：19；低于既有 5 条质量阈值：16；覆盖差值：44
- 官方 Evidence：212；未被任何已发布关系引用：181

> 本诊断只报告已观察到的覆盖和未用于关系的官方 Evidence，不生成“应该存在关系”的实体对。覆盖差值是既有质量规则的观测值，不是发布配额。

## 核心实体关系覆盖

| 实体 | 类型 | 已发布可解释关系 | 距既有阈值差值 |
| --- | --- | ---: | ---: |
| AutoGen (`e-autogen`) | framework | 1 | 4 |
| CrewAI (`e-crewai`) | framework | 1 | 4 |
| Devin (`e-devin`) | agent | 1 | 4 |
| Manus (`e-manus`) | agent | 1 | 4 |
| OpenAI Codex (`e-codex`) | agent | 2 | 3 |
| 豆包 Doubao (`e-doubao`) | model | 2 | 3 |
| Gemini CLI (`e-gemini-cli`) | agent | 2 | 3 |
| Kimi (`e-kimi`) | model | 2 | 3 |
| LangGraph (`e-langgraph`) | framework | 2 | 3 |
| OpenAI Agents SDK (`e-openai-agents-sdk`) | framework | 2 | 3 |
| Claude Code (`e-claude-code`) | agent | 3 | 2 |
| 文心一言 ERNIE Bot (`e-ernie`) | model | 3 | 2 |
| Model Context Protocol (`e-mcp`) | framework | 3 | 2 |
| 通义千问 Qwen (`e-qwen`) | model | 3 | 2 |
| DeepSeek 系列 (`e-deepseek`) | model | 4 | 1 |
| Gemini 系列 (`e-gemini`) | model | 4 | 1 |
| LangChain (`e-langchain`) | framework | 7 | 0 |
| Claude 系列 (`e-claude`) | model | 8 | 0 |
| GPT 系列 (`e-gpt`) | model | 14 | 0 |

## 本体类型覆盖

| 合法关系类型 | 已发布可解释关系 |
| --- | ---: |
| `developed-by` | 13 |
| `based-on` | 4 |
| `competes-with` | 6 |
| `benchmarked-on` | 10 |
| `uses` | 12 |
| `cited-by` | 0 |
| `part-of` | 20 |
| `successor-of` | 11 |
| `integrates-with` | 0 |

## 未被已发布关系引用的官方 Evidence

以下条目来自快照中的官方 Evidence；“关联核心实体”只依据现有 Claim、Timeline 或实体字段引用，不推断新关系。

| Evidence | 发布方 | 关联核心实体 | 已支撑内容 |
| --- | --- | --- | ---: |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-00e461b0d7a97835f264`) | Moonshot AI | — | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-0118c2584652c3ae00a2`) | Alibaba Qwen | `e-qwen` | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-0456fcc08c1b9651e461`) | OpenAI | — | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-0bb5fe18f20b9d37d620`) | Model Context Protocol | `e-mcp` | 1 |
| [Moonshot AI 模型与研究动态](https://www.moonshot.ai) (`evidence-0ca5886d7cce38744c4e`) | Moonshot AI | `e-kimi` | 1 |
| [Gemini API 官方更新日志](https://ai.google.dev/gemini-api/docs/changelog) (`evidence-0f2b9f758b0f58398ef7`) | Google | `e-gemini` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-0ffb64747e7a0626d653`) | Anthropic | `e-claude-code` | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-10b5e8c77ee04336-msq25f34`) | Model Context Protocol | `e-mcp` | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-10c240632ac093bc9152`) | Alibaba Qwen | `e-qwen` | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-1176c1661b5a43b0362d`) | ByteDance Seed | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-14f5b73d8708bbc4a360`) | Anthropic | `e-claude-code` | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-1519244ae09190af0d74`) | Anthropic | `e-claude` | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-15263d7ff2dfc3b95ce9`) | Alibaba Qwen | `e-qwen` | 1 |
| [OpenAI 弃用与下线记录](https://developers.openai.com/api/docs/deprecations.md) (`evidence-1718168ed069ec20533c`) | OpenAI | — | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-1b0f409b34194dc20bc3`) | ByteDance Seed | — | 1 |
| [OpenAI 弃用与下线记录](https://developers.openai.com/api/docs/deprecations.md) (`evidence-1b95f8c29e8060f435e5`) | OpenAI | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-1c42ca631a6caa60e4fe`) | Anthropic | `e-claude-code` | 1 |
| [Cursor Agent 官方文档](https://cursor.com/docs) (`evidence-1cf0729c9d4759a7ab0d`) | Cursor | `e-claude` | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-1d379a59788c82f7c2a0`) | Moonshot AI | — | 1 |
| [文心 ERNIE 5.0 技术报告](https://ernie.baidu.com/blog/zh/posts/ernie5.0) (`evidence-1df943f17b88c67f915b`) | Baidu ERNIE | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-1fdb85142657f6812e18`) | Moonshot AI | — | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-204d387cd78583653f04`) | arXiv | — | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-21ed507207e65f133a8d`) | Model Context Protocol | `e-mcp` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-22b1f161b39c7a6dc3ba`) | Anthropic | `e-claude-code` | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-263c6b747ae00eacada2`) | ByteDance Seed | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-26b1d5225baf5e9bf207`) | Moonshot AI | — | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-28476f793c22ba4bc0b4`) | ByteDance Seed | — | 1 |
| [ERNIE 4.5 模型系列正式开源](https://ernie.baidu.com/blog/zh/posts/ernie4.5) (`evidence-2883d69731b3106d64a8`) | Baidu ERNIE | — | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-2dd7114eca1f06d79501`) | Anthropic | `e-claude` | 1 |
| [Gemini API 官方更新日志](https://ai.google.dev/gemini-api/docs/changelog) (`evidence-30074cb26f8e04cba0f2`) | Google | `e-gemini` | 1 |
| [ERNIE 4.5 模型系列正式开源](https://ernie.baidu.com/blog/zh/posts/ernie4.5) (`evidence-30a448880d11cfd14526`) | Baidu ERNIE | — | 1 |
| [Anthropic Claude API 更新日志](https://platform.claude.com/docs/en/release-notes/overview.md) (`evidence-36513ae7dedc09e1fc93`) | Anthropic | `e-claude-code` | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-36b63a10cf3d42e607d0`) | OpenAI | — | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-37d0d89648d2a393d0c3`) | LangChain | `e-langchain` | 1 |
| [Anthropic Claude API 更新日志](https://platform.claude.com/docs/en/release-notes/overview.md) (`evidence-38cd91454308c906fc2e`) | Anthropic | `e-claude-code` | 1 |
| [Cursor Agent 官方文档](https://cursor.com/docs) (`evidence-39d21cb402f8fa3fb78f`) | Cursor | — | 1 |
| [Gemini API 官方更新日志](https://ai.google.dev/gemini-api/docs/changelog) (`evidence-3af2b5a5730aaf348a0d`) | Google | — | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-3bff854813e3b3c31dd9`) | arXiv | — | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-3d5d2da944a152e3a050`) | Anthropic | — | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-3e7ba4de99f29534fffd`) | LangChain | `e-langchain` | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-3ec4878162e369974a0b`) | Model Context Protocol | `e-claude-code` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-40c4970f43275ebe6ca6`) | Anthropic | `e-claude-code` | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-40da0986ded48569404c`) | OpenAI | — | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-443a8f47cbe2117e1aff`) | Anthropic | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-44a75c23edcd9681adda`) | Anthropic | `e-claude` | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-46a65791b4fe4379aa31`) | Model Context Protocol | `e-mcp` | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-4799cf4d38cec65fca19`) | Anthropic | `e-claude` | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-48213f05b19dcaf25309`) | ByteDance Seed | — | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-4c4c5c82687fd61b55d5`) | Alibaba Qwen | `e-qwen` | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-4d44703b700a9e08516e`) | Moonshot AI | — | 1 |
| [Gemini API 官方更新日志](https://ai.google.dev/gemini-api/docs/changelog) (`evidence-4f8f8d405cca177b06a3`) | Google | `e-gemini` | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-4fd46ae604567d5065bd`) | OpenAI | — | 1 |
| [Attention Is All You Need 论文](https://arxiv.org/abs/1706.03762) (`evidence-50c69855c226a60323a7`) | arXiv | — | 1 |
| [文心 ERNIE 5.1 官方发布](https://ernie.baidu.com/blog/posts/ernie-5.1-0508-release) (`evidence-514a641cc94e8c2e9089`) | Baidu ERNIE | — | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-567e0fde453f45cc666b`) | Anthropic | `e-claude` | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-56e09e8a092cf475a286`) | ByteDance Seed | — | 1 |
| [文心 ERNIE 5.1 官方发布](https://ernie.baidu.com/blog/posts/ernie-5.1-0508-release) (`evidence-586c43110316fad28627`) | Baidu ERNIE | — | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-5aaf53f59267692a608e`) | ByteDance Seed | — | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-5ea35a7e0f8dc4e729a9`) | ByteDance Seed | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-60772eb088c4d19aaa68`) | Anthropic | `e-claude-code` | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-60b87db2ddd7abbb6700`) | LangChain | `e-langgraph` | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-625b492fabee4c224e4f`) | arXiv | — | 1 |
| [ERNIE 4.5 模型系列正式开源](https://ernie.baidu.com/blog/zh/posts/ernie4.5) (`evidence-62739809ef16538072a1`) | Baidu ERNIE | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-62e6a41540009d41ae38`) | OpenAI | — | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-64413a939e7a8f19b690`) | arXiv | — | 1 |
| [Attention Is All You Need 论文](https://arxiv.org/abs/1706.03762) (`evidence-651c65451adfbda8426e`) | arXiv | — | 1 |
| [字节跳动 Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed-2-0-official-launch) (`evidence-67cdd43c2bbc5c3c9094`) | ByteDance Seed | `e-doubao` | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-67fa626d90510874782c`) | OpenAI | — | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-68c09107f4d766a73a57`) | Anthropic | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-691968ccd94f1eb55eff`) | Moonshot AI | — | 1 |
| [Google Gemini 2.5 Pro 更新](https://deepmind.google) (`evidence-69211c3a50070e32e98d`) | Google DeepMind | — | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-6bc3e8040e503b9761af`) | LangChain | `e-langchain` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-6d9735b8089f5c019ba7`) | Anthropic | `e-claude-code` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-6dc90055ed5cbd2e235f`) | Anthropic | `e-claude-code` | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-6f9aaf8ca2c9c500592f`) | ByteDance Seed | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-722c98db171d7018b8b3`) | OpenAI | — | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-739edf11461045ce579e`) | Model Context Protocol | `e-mcp` | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-73b3ff0afe9ef5d63fc9`) | Moonshot AI | — | 1 |
| [文心 ERNIE 5.1 官方发布](https://ernie.baidu.com/blog/posts/ernie-5.1-0508-release) (`evidence-74fd2e6ec62f858d75cc`) | Baidu ERNIE | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-764a228633c0890763fc`) | Anthropic | `e-claude-code` | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-776021b93f0cc62f59d8`) | OpenAI | — | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-789db8e8444fba20797b`) | Alibaba Qwen | `e-qwen` | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-7933c8f3e2e3532a7382`) | OpenAI | — | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-7a980fecbd8f15bc1c83`) | Model Context Protocol | `e-mcp` | 1 |
| [OpenAI 弃用与下线记录](https://developers.openai.com/api/docs/deprecations.md) (`evidence-7b675cc727012f320129`) | OpenAI | — | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-7e1ecc910190000a0cd3`) | arXiv | — | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-7f8f68faa57b9c45c7bc`) | arXiv | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-811c19b9a402e4282b29`) | Moonshot AI | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-826b91a6442532db10e4`) | Anthropic | `e-claude-code` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-852c17dc4b53a389f8d9`) | Anthropic | `e-claude-code` | 1 |
| [Gemini API 官方更新日志](https://ai.google.dev/gemini-api/docs/changelog) (`evidence-87feb225a273a9eac10b`) | Google | — | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-8952825de5396e9a8f32`) | OpenAI | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-8a2943bc0365104acd20`) | OpenAI | `e-codex` | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-8a595db59a1aa15c3d51`) | arXiv | — | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-8ebb1d7e525930e855ad`) | Anthropic | `e-claude` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-8f1b9dca9176013f7989`) | Anthropic | `e-claude-code` | 1 |
| [字节跳动 Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed-2-0-official-launch) (`evidence-907e86c15632fdc031a7`) | ByteDance Seed | — | 1 |
| [OpenAI 弃用与下线记录](https://developers.openai.com/api/docs/deprecations.md) (`evidence-90b09d0c9745cbcb877b`) | OpenAI | — | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-9198f4054e0c204fc1a9`) | Anthropic | — | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-93e11b12cd81ffd645d1`) | Anthropic | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-946116b1be917420287c`) | OpenAI | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-957f78f08bcffaa45776`) | Anthropic | `e-claude-code` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-964dfcfbc1b85062f986`) | Anthropic | `e-claude-code` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-9846a95a58624a071559`) | Anthropic | `e-claude-code` | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-9a17a4c22c2c11a5c5e1`) | arXiv | — | 1 |
| [字节跳动 Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed-2-0-official-launch) (`evidence-9a28d268080030afc6a8`) | ByteDance Seed | `e-doubao` | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-a18286f8beb841d14f78`) | arXiv | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-a3787c9919a5b1c28bee`) | Anthropic | `e-claude` | 1 |
| [Cursor Agent 官方文档](https://cursor.com/docs) (`evidence-a3e4d4f1e21a727d98cf`) | Cursor | — | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-a3fb5a9e3c7830c7f813`) | arXiv | — | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-a57816a743988f53e8b2`) | arXiv | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-a639efc294dac838279d`) | OpenAI | — | 1 |
| [字节跳动 Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed-2-0-official-launch) (`evidence-a65e9a56c5b78f050219`) | ByteDance Seed | — | 1 |
| [文心 ERNIE 5.1 官方发布](https://ernie.baidu.com/blog/posts/ernie-5.1-0508-release) (`evidence-a6bf7bb89ea9aeb1e43b`) | Baidu ERNIE | — | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-a7628b6146867f51e14e`) | ByteDance Seed | — | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-a843b7fd4e1a92e8a729`) | Anthropic | — | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-a8bb22fe32d08f888656`) | Alibaba Qwen | `e-qwen` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-aa028d98f64ccca7df43`) | Anthropic | `e-claude` | 1 |
| [字节跳动 Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed-2-0-official-launch) (`evidence-aa5ba10ed3df283961e4`) | ByteDance Seed | — | 1 |
| [文心 ERNIE 5.1 官方发布](https://ernie.baidu.com/blog/posts/ernie-5.1-0508-release) (`evidence-ab7cc2db59c77666bd0b`) | Baidu ERNIE | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-ad870454da073e213a53`) | Moonshot AI | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-aec3ec964cca35fb7ce0`) | Anthropic | `e-claude` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-b0df5acad928b3ed9397`) | Anthropic | `e-claude` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-b16d6589cd7104289b88`) | Anthropic | `e-claude` | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-b2e468b130a220c586ae`) | OpenAI | — | 1 |
| [字节跳动 Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed-2-0-official-launch) (`evidence-b2e9f9013b8927ec86bd`) | ByteDance Seed | — | 1 |
| [Cursor Agent 官方文档](https://cursor.com/docs) (`evidence-b31d73d2f91be48f6c5d`) | Cursor | `e-claude` | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-b4baf2feae10cc1faa7b`) | Model Context Protocol | `e-mcp` | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-b544c4cb8c1e5187ade6`) | OpenAI | — | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-b743aa575bc8317ca642`) | Anthropic | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-b87bc199a75ca6194a14`) | Moonshot AI | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-b966d05482e2862a2284`) | Anthropic | `e-claude-code` | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-bc0878766ddba613fcef`) | ByteDance Seed | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-bcdb62855ed445165f1f`) | OpenAI | — | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-bd0a65120b54c60efae5`) | Alibaba Qwen | `e-qwen` | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-bd61b1b266dd6e00f84e`) | Anthropic | — | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-bedca8ceed0954f4bc73`) | Model Context Protocol | `e-mcp` | 1 |
| [OpenAI API 更新日志](https://developers.openai.com/api/docs/changelog.md) (`evidence-c05a2d6e012bd55d093a`) | OpenAI | `e-codex` | 1 |
| [Moonshot AI 模型与研究动态](https://www.moonshot.ai) (`evidence-c11dc762b2d1f7bbc92a`) | Moonshot AI | `e-kimi` | 1 |
| [MMLU-Pro 论文](https://arxiv.org/abs/2406.01574) (`evidence-c138e58e601447cb2f39`) | arXiv | — | 1 |
| [Attention Is All You Need 论文](https://arxiv.org/abs/1706.03762) (`evidence-c197b2fed5266444ac67`) | arXiv | — | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-c1fd4b401bb605572fed`) | Anthropic | `e-claude` | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-c39776a16ff86e810567`) | Model Context Protocol | `e-mcp` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-c544c2ed2ada9fb5a54b`) | Anthropic | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-c782db99397aad682725`) | Moonshot AI | — | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-c7a1857e394448993d93`) | Model Context Protocol | `e-mcp` | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-c9729d582aad30fb2ef1`) | Alibaba Qwen | `e-qwen` | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-ccdb4b7fd2ff7c5ff3b3`) | Moonshot AI | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-ce8bf109d9ca8dda5e63`) | OpenAI | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-cf94fdbaa29a323ff09b`) | Moonshot AI | `e-kimi` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-d09942e317650cc3435d`) | Anthropic | `e-claude` | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-d164b5c3859aa142e64b`) | Anthropic | — | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-d46b4538f9f9a620139e`) | Moonshot AI | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-d52e477b9559be80d40d`) | OpenAI | — | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-d598a28918ce07b143fa`) | Model Context Protocol | `e-mcp` | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-d8c42aa4195b98cd5d4f`) | Alibaba Qwen | `e-qwen` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-dd07fb638a7530ff2309`) | Anthropic | `e-claude` | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-dd89bd1c8f5c53c061b1`) | LangChain | `e-langchain` | 1 |
| [Cursor Agent 官方文档](https://cursor.com/docs) (`evidence-e021559c9e3184633bb6`) | Cursor | `e-claude` | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-e3c74e6b9e4d6be016cd`) | LangChain | `e-langgraph` | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-e7774c003f95b0404903`) | OpenAI | — | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-e88536c0e20174d180b0`) | ByteDance Seed | — | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-e9324ee0b76670b71b21`) | LangChain | `e-langgraph` | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-e94705444bf4a1103976`) | Anthropic | — | 1 |
| [OpenAI 模型目录](https://developers.openai.com/api/docs/models.md) (`evidence-ea299deb61fc0d5eaa5a`) | OpenAI | — | 1 |
| [LangChain 官方框架概览](https://docs.langchain.com/oss/python/langchain/overview) (`evidence-eaf61ae41460b6ee9d7d`) | LangChain | `e-langgraph` | 1 |
| [字节跳动 Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed-2-0-official-launch) (`evidence-ecd9836d9329e8439569`) | ByteDance Seed | `e-doubao` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-ee0aaa3d27f27adc8c0f`) | Anthropic | `e-claude` | 1 |
| [Kimi API 平台与最新模型目录](https://platform.kimi.ai) (`evidence-efbc349eb971644543eb`) | Moonshot AI | `e-kimi` | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-f160486f6dd1f6c4205d`) | Anthropic | `e-claude-code` | 1 |
| [文心 ERNIE 5.1 官方发布](https://ernie.baidu.com/blog/posts/ernie-5.1-0508-release) (`evidence-f1e2af967f065102bbde`) | Baidu ERNIE | — | 1 |
| [OpenAI 弃用与下线记录](https://developers.openai.com/api/docs/deprecations.md) (`evidence-f54e84647bf091f465d2`) | OpenAI | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-f660ca6122fa1f704d0d`) | Anthropic | `e-claude-code` | 1 |
| [文心 ERNIE 5.1 官方发布](https://ernie.baidu.com/blog/posts/ernie-5.1-0508-release) (`evidence-f6c45a629d85f7abeb1f`) | Baidu ERNIE | — | 1 |
| [Qwen 模型版本说明](https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md) (`evidence-f73421ce48a5cc77b359`) | Alibaba Qwen | `e-qwen` | 1 |
| [Seed1.8 通用 Agent 模型官方发布](https://seed.bytedance.com/en/blog/official-release-of-seed1-8-a-generalized-agentic-model) (`evidence-f94f9f7b5033aa600b03`) | ByteDance Seed | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-fa38113d856b439d625a`) | Anthropic | `e-claude` | 1 |
| [MCP 官方架构概览](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) (`evidence-fbb75f711e265a8f9f29`) | Model Context Protocol | `e-mcp` | 1 |
| [Anthropic Claude 4.5 系统卡](https://www.anthropic.com) (`evidence-fe1416642f52fa55ce45`) | Anthropic | — | 1 |
| [Anthropic：Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) (`evidence-fe7400a84c600dfb05d1`) | Anthropic | `e-claude-code` | 1 |
| [Anthropic：公司、使命与研究方向](https://www.anthropic.com/company) (`evidence-fe887b41fe0b5d0518e1`) | Anthropic | — | 1 |
