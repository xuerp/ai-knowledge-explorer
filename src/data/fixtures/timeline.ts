import type { TimelineEvent } from "@/domain/types";

export const TIMELINE: Record<string, TimelineEvent[]> = {
  "e-gpt": [
    {
      id: "t-gpt-1",
      date: "2018-06-11",
      title: { zh: "GPT-1 发布", en: "GPT-1 released" },
      summary: {
        zh: "1.17 亿参数，验证“通用预训练 + 任务微调”路线；以文本理解为主，尚无公开 API 定价。",
        en: "117M parameters validated general pre-training plus task fine-tuning; text-only and no public API pricing.",
      },
      kind: "release",
      sourceIds: ["s-openai-gpt5"],
      confidence: "verified",
    },
    {
      id: "t-gpt-2",
      date: "2020-05-28",
      title: { zh: "GPT-3 发布", en: "GPT-3 released" },
      summary: {
        zh: "扩展到 1750 亿参数，重点变化是无需微调的 few-shot 提示能力，并开始形成按 token 计费的 API 产品形态。",
        en: "Scaled to 175B parameters, introduced strong few-shot prompting and established token-priced API access.",
      },
      kind: "release",
      sourceIds: ["s-openai-gpt5"],
      confidence: "verified",
    },
    {
      id: "t-gpt-3",
      date: "2022-11-30",
      title: { zh: "ChatGPT 上线", en: "ChatGPT launched" },
      summary: {
        zh: "将指令微调与对话界面结合，5 天内突破百万用户；模型能力从 API 组件变成普通用户可直接使用的产品。",
        en: "Combined instruction tuning with a chat UI, reaching 1M users in five days and turning model APIs into a consumer product.",
      },
      kind: "release",
      sourceIds: ["s-openai-gpt5"],
      confidence: "verified",
    },
    {
      id: "t-gpt-4",
      date: "2023-03-14",
      title: { zh: "GPT-4 发布", en: "GPT-4 released" },
      summary: {
        zh: "新增图像输入并显著提高复杂推理；首发提供 8K / 32K 上下文，演示归一化 API 价格约为输入 $30、输出 $60 / 百万 tokens。",
        en: "Added image input and stronger reasoning, with 8K/32K context; normalized launch pricing was about $30 input and $60 output per 1M tokens.",
      },
      kind: "release",
      sourceIds: ["s-openai-gpt5"],
      confidence: "verified",
    },
    {
      id: "t-gpt-4o",
      date: "2024-05-13",
      title: { zh: "GPT-4o：原生全模态与成本下降", en: "GPT-4o: native omni and lower cost" },
      summary: {
        zh: "文本、图像与音频走向原生统一处理，延迟明显降低；128K 上下文，演示价格为输入 $2.5、输出 $10 / 百万 tokens。",
        en: "Unified text, image and audio processing with lower latency; 128K context and demo pricing of $2.5 input / $10 output per 1M tokens.",
      },
      kind: "release",
      sourceIds: ["s-openai-gpt5"],
      confidence: "verified",
    },
    {
      id: "t-gpt-45",
      date: "2025-02-27",
      title: { zh: "GPT-4.5：知识与自然表达增强", en: "GPT-4.5: knowledge and natural writing" },
      summary: {
        zh: "重点改善知识覆盖、写作自然度与意图理解，而非单纯追求推理速度；128K 上下文，演示价格为输入 $75、输出 $150 / 百万 tokens。",
        en: "Focused on knowledge, natural writing and intent understanding rather than raw reasoning speed; 128K context and demo pricing of $75/$150.",
      },
      kind: "release",
      sourceIds: ["s-openai-gpt5"],
      confidence: "verified",
    },
    {
      id: "t-gpt-5",
      date: "2026-07-12",
      title: { zh: "GPT-5 发布（演示）", en: "GPT-5 released (demo)" },
      summary: {
        zh: "统一推理、多模态与 Agent 工具调用；上下文扩至 256K、支持 8 个并行工具，演示价格为输入 $0.5、输出 $1.5 / 百万 tokens。",
        en: "Unified reasoning, multimodality and agentic tool use; 256K context, eight parallel tools and demo pricing of $0.5/$1.5.",
      },
      kind: "release",
      sourceIds: ["s-openai-gpt5", "s-swebench"],
      confidence: "verified",
    },
    {
      id: "t-gpt-rumor",
      date: "2026-07-10",
      title: { zh: "社区传闻：1M 上下文", en: "Community rumor: 1M context" },
      summary: {
        zh: "多个开发者社区讨论 GPT-5 可能支持 1M token 上下文，官方未确认。",
        en: "Developers speculate 1M context for GPT-5; not officially confirmed.",
      },
      kind: "update",
      sourceIds: ["s-community-rumor"],
      confidence: "unverified",
    },
  ],
  "e-claude": [
    {
      id: "t-c-1",
      date: "2023-03-14",
      title: { zh: "Claude 首版发布", en: "Claude 1 released" },
      summary: {
        zh: "Anthropic 首个对外模型产品，以长文本、可靠对话和 Constitutional AI 路线为主要差异点。",
        en: "Anthropic's first public model, differentiated by long-form dialogue and Constitutional AI.",
      },
      kind: "release",
      sourceIds: ["s-anthropic-claude"],
      confidence: "verified",
    },
    {
      id: "t-c-35",
      date: "2024-06-20",
      title: {
        zh: "Claude 3.5 Sonnet：代码与性价比跃升",
        en: "Claude 3.5 Sonnet: coding and value",
      },
      summary: {
        zh: "在 200K 上下文中强化代码、视觉理解和工具调用；演示价格为输入 $3、输出 $15 / 百万 tokens。",
        en: "Improved coding, vision and tool use in a 200K context window; demo pricing of $3/$15 per 1M tokens.",
      },
      kind: "release",
      sourceIds: ["s-anthropic-claude"],
      confidence: "verified",
    },
    {
      id: "t-c-4",
      date: "2025-05-22",
      title: {
        zh: "Claude 4 Sonnet：面向 Agent 的持续执行",
        en: "Claude 4 Sonnet: sustained agent execution",
      },
      summary: {
        zh: "增强多步骤 Agent、代码仓库理解与并行工具调用；200K 上下文，演示价格维持输入 $3、输出 $15。",
        en: "Added stronger multi-step agents, repository understanding and parallel tools; 200K context at demo pricing of $3/$15.",
      },
      kind: "release",
      sourceIds: ["s-anthropic-claude"],
      confidence: "verified",
    },
    {
      id: "t-c-2",
      date: "2026-06-20",
      title: { zh: "Claude 4.5 Sonnet 发布", en: "Claude 4.5 Sonnet released" },
      summary: {
        zh: "上下文扩至 2M（预览），强化 Agent 与代码能力并降低误拒；演示价格为输入 $3、输出 $15 / 百万 tokens。",
        en: "Expanded to a 2M context preview with better agents, coding and fewer false refusals; demo pricing of $3/$15.",
      },
      kind: "release",
      sourceIds: ["s-anthropic-claude"],
      confidence: "verified",
    },
  ],
  "e-gemini": [
    {
      id: "t-gemini-15-pro",
      date: "2024-02-15",
      title: { zh: "Gemini 1.5 Pro：超长上下文", en: "Gemini 1.5 Pro: ultra-long context" },
      summary: {
        zh: "上下文扩展到 2M tokens，新增长视频、代码库和大规模文档分析；演示价格为输入 $1.25、输出 $5 / 百万 tokens。",
        en: "Expanded to 2M tokens for long video, codebases and large documents; demo pricing of $1.25/$5 per 1M tokens.",
      },
      kind: "release",
      sourceIds: ["s-google-gemini"],
      confidence: "verified",
    },
    {
      id: "t-gemini-25-pro",
      date: "2025-03-25",
      title: { zh: "Gemini 2.5 Pro：思考与代码增强", en: "Gemini 2.5 Pro: thinking and code" },
      summary: {
        zh: "在长上下文上增加思考模式、代码执行与搜索增强；演示输出价格调整为 $10 / 百万 tokens。",
        en: "Added thinking, code execution and search grounding; demo output pricing changed to $10 per 1M tokens.",
      },
      kind: "release",
      sourceIds: ["s-google-gemini"],
      confidence: "verified",
    },
  ],
  "e-deepseek": [
    {
      id: "t-deepseek-v3",
      date: "2024-12-26",
      title: { zh: "DeepSeek-V3：高效 MoE 基座", en: "DeepSeek-V3: efficient MoE foundation" },
      summary: {
        zh: "以 MoE 架构降低训练与推理成本，强化中文和代码，并提供 API 与开放权重部署路径。",
        en: "Used MoE to reduce training and inference cost, strengthening Chinese and code with API and open-weight deployment.",
      },
      kind: "release",
      sourceIds: ["s-deepseek-r2"],
      confidence: "verified",
    },
    {
      id: "t-deepseek-r2",
      date: "2026-05-30",
      title: { zh: "DeepSeek-R2：推理版本预览", en: "DeepSeek-R2: reasoning preview" },
      summary: {
        zh: "演示版本将上下文扩至 256K，并增加代码沙箱和 Agent 编排；价格随 API 或自托管环境变化。",
        en: "Demo release expands to 256K with code sandboxing and agent orchestration; cost depends on API or self-hosting.",
      },
      kind: "release",
      sourceIds: ["s-deepseek-r2"],
      confidence: "verified",
    },
  ],
  "e-qwen": [
    {
      id: "t-qwen-25-max",
      date: "2025-01-29",
      title: { zh: "Qwen2.5-Max：企业与代码能力", en: "Qwen2.5-Max: enterprise and code" },
      summary: {
        zh: "强化中文、代码和结构化输出，主要通过百炼 API 提供；价格随地区和云平台计费。",
        en: "Improved Chinese, code and structured output through Bailian APIs; pricing varies by region and cloud.",
      },
      kind: "release",
      sourceIds: ["s-qwen-models"],
      confidence: "verified",
    },
    {
      id: "t-qwen-3-max",
      date: "2026-07-01",
      title: { zh: "Qwen3-Max：混合推理与 Agent", en: "Qwen3-Max: hybrid reasoning and agents" },
      summary: {
        zh: "演示版本统一快速与深度推理，新增 256K 上下文、并行工具调用和中文多模态理解。",
        en: "Demo release unifies fast and deep reasoning with 256K context, parallel tools and Chinese multimodality.",
      },
      kind: "release",
      sourceIds: ["s-qwen-models"],
      confidence: "verified",
    },
  ],
  "e-kimi": [
    {
      id: "t-kimi-k26",
      date: "2026-04-20",
      title: { zh: "Kimi K2.6：通用多模态与代码 Agent", en: "Kimi K2.6: multimodal agents" },
      summary: {
        zh: "统一视觉与文本输入、思考与非思考模式以及代码 Agent；256K 上下文，官方 API 页面记录输入 $0.95、输出 $4 / 百万 tokens。",
        en: "Unified vision/text input, thinking modes and coding agents with 256K context; official API pricing lists $0.95 input and $4 output per 1M tokens.",
      },
      kind: "release",
      sourceIds: ["s-kimi-platform", "s-kimi-news"],
      confidence: "verified",
    },
    {
      id: "t-kimi-k3",
      date: "2026-07-16",
      title: { zh: "Kimi K3：百万上下文旗舰", en: "Kimi K3: 1M-context flagship" },
      summary: {
        zh: "上下文扩展至 1M tokens，定位软件工程、知识工作与深度推理；官方 API 页面记录输入 $3、输出 $15 / 百万 tokens。",
        en: "Expanded to 1M tokens for software engineering, knowledge work and deep reasoning; official API pricing lists $3/$15 per 1M tokens.",
      },
      kind: "release",
      sourceIds: ["s-kimi-platform", "s-kimi-news"],
      confidence: "verified",
    },
  ],
  "e-doubao": [
    {
      id: "t-doubao-seed18",
      date: "2025-12-18",
      title: { zh: "Seed1.8：通用 Agent 模型", en: "Seed1.8: general agent model" },
      summary: {
        zh: "增加文本与图像输入、搜索、代码、GUI Agent 和三种思考模式，面向信息检索与复杂工作流。",
        en: "Added text/image input, search, code, GUI agents and three thinking modes for retrieval and complex workflows.",
      },
      kind: "release",
      sourceIds: ["s-seed-18"],
      confidence: "verified",
    },
    {
      id: "t-doubao-seed20",
      date: "2026-02-14",
      title: { zh: "Seed2.0 Pro：复杂真实任务旗舰", en: "Seed2.0 Pro: complex-workflow flagship" },
      summary: {
        zh: "系统提升多模态理解、长链推理与 Agent 稳定性，并以 Pro、Lite、Mini 和 Code 四档覆盖不同生产需求。",
        en: "Improved multimodality, long-chain reasoning and agent reliability across Pro, Lite, Mini and Code tiers.",
      },
      kind: "release",
      sourceIds: ["s-seed-2"],
      confidence: "verified",
    },
  ],
  "e-ernie": [
    {
      id: "t-ernie-45",
      date: "2025-06-30",
      title: { zh: "ERNIE 4.5：十款模型开放权重", en: "ERNIE 4.5: ten open-weight variants" },
      summary: {
        zh: "发布覆盖 0.3B 稠密、21B/300B 语言模型和多模态变体的十款模型，并采用 Apache 2.0 许可。",
        en: "Released ten variants spanning a 0.3B dense model, 21B/300B language models and multimodal releases under Apache 2.0.",
      },
      kind: "release",
      sourceIds: ["s-ernie-45"],
      confidence: "verified",
    },
    {
      id: "t-ernie-50",
      date: "2026-02-06",
      title: { zh: "ERNIE 5.0：原生全模态基础模型", en: "ERNIE 5.0: native multimodal foundation" },
      summary: {
        zh: "以 2.4 万亿参数超稀疏 MoE 在统一自回归架构中建模文本、图像、视频与音频，训练上下文扩展至 128K。",
        en: "Used a 2.4T ultra-sparse MoE to unify text, image, video and audio, with training context extended to 128K.",
      },
      kind: "release",
      sourceIds: ["s-ernie-50"],
      confidence: "verified",
    },
    {
      id: "t-ernie-51",
      date: "2026-05-09",
      title: { zh: "ERNIE 5.1：效率与 Agent 强化", en: "ERNIE 5.1: efficiency and agents" },
      summary: {
        zh: "从 ERNIE 5.0 弹性子模型矩阵提取高效结构，总参数约压缩至三分之一，强化 Agent、推理、知识、搜索和写作。",
        en: "Extracted an efficient subnetwork from ERNIE 5.0, reducing total parameters to roughly one third while strengthening agents, reasoning, search and writing.",
      },
      kind: "release",
      sourceIds: ["s-ernie-51"],
      confidence: "verified",
    },
  ],
  "e-gpt-4o": [],
  "e-gpt-45": [],
  "e-gpt-5": [],
  "e-claude-35": [],
  "e-claude-4": [],
  "e-claude-45": [],
  "e-gemini-15-pro": [],
  "e-gemini-25-pro": [],
  "e-deepseek-v3": [],
  "e-deepseek-r2": [],
  "e-qwen-25-max": [],
  "e-qwen-3-max": [],
  "e-kimi-k26": [],
  "e-kimi-k3": [],
  "e-doubao-seed18": [],
  "e-doubao-seed20-pro": [],
  "e-ernie-45": [],
  "e-ernie-50": [],
  "e-ernie-51": [],
};

TIMELINE["e-gpt-4o"] = TIMELINE["e-gpt"].filter((event) => event.id === "t-gpt-4o");
TIMELINE["e-gpt-45"] = TIMELINE["e-gpt"].filter((event) => event.id === "t-gpt-45");
TIMELINE["e-gpt-5"] = TIMELINE["e-gpt"].filter((event) => event.id === "t-gpt-5");
TIMELINE["e-claude-35"] = TIMELINE["e-claude"].filter((event) => event.id === "t-c-35");
TIMELINE["e-claude-4"] = TIMELINE["e-claude"].filter((event) => event.id === "t-c-4");
TIMELINE["e-claude-45"] = TIMELINE["e-claude"].filter((event) => event.id === "t-c-2");
TIMELINE["e-gemini-15-pro"] = TIMELINE["e-gemini"].filter(
  (event) => event.id === "t-gemini-15-pro",
);
TIMELINE["e-gemini-25-pro"] = TIMELINE["e-gemini"].filter(
  (event) => event.id === "t-gemini-25-pro",
);
TIMELINE["e-deepseek-v3"] = TIMELINE["e-deepseek"].filter((event) => event.id === "t-deepseek-v3");
TIMELINE["e-deepseek-r2"] = TIMELINE["e-deepseek"].filter((event) => event.id === "t-deepseek-r2");
TIMELINE["e-qwen-25-max"] = TIMELINE["e-qwen"].filter((event) => event.id === "t-qwen-25-max");
TIMELINE["e-qwen-3-max"] = TIMELINE["e-qwen"].filter((event) => event.id === "t-qwen-3-max");
TIMELINE["e-kimi-k26"] = TIMELINE["e-kimi"].filter((event) => event.id === "t-kimi-k26");
TIMELINE["e-kimi-k3"] = TIMELINE["e-kimi"].filter((event) => event.id === "t-kimi-k3");
TIMELINE["e-doubao-seed18"] = TIMELINE["e-doubao"].filter(
  (event) => event.id === "t-doubao-seed18",
);
TIMELINE["e-doubao-seed20-pro"] = TIMELINE["e-doubao"].filter(
  (event) => event.id === "t-doubao-seed20",
);
TIMELINE["e-ernie-45"] = TIMELINE["e-ernie"].filter((event) => event.id === "t-ernie-45");
TIMELINE["e-ernie-50"] = TIMELINE["e-ernie"].filter((event) => event.id === "t-ernie-50");
TIMELINE["e-ernie-51"] = TIMELINE["e-ernie"].filter((event) => event.id === "t-ernie-51");
