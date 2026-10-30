import type { ChangeItem } from "@/domain/types";

export const RECENT_CHANGES: ChangeItem[] = [
  {
    id: "ch10",
    entityId: "e-kimi",
    date: "2026-07-16",
    summary: {
      zh: "Kimi K3 成为当前旗舰，上下文扩展至 100 万 tokens，并聚焦软件工程与知识工作。",
      en: "Kimi K3 becomes the flagship with a 1M-token context for software engineering and knowledge work.",
    },
    kind: "new",
    confidence: "verified",
    sourceIds: ["s-kimi-platform", "s-kimi-news"],
  },
  {
    id: "ch11",
    entityId: "e-doubao",
    date: "2026-02-14",
    summary: {
      zh: "Seed2.0 发布 Pro、Lite、Mini 与 Code 四档，强化多模态理解和长程 Agent。",
      en: "Seed2.0 launches Pro, Lite, Mini and Code tiers with stronger multimodality and long-horizon agents.",
    },
    kind: "new",
    confidence: "verified",
    sourceIds: ["s-seed-2"],
  },
  {
    id: "ch12",
    entityId: "e-ernie",
    date: "2026-05-09",
    summary: {
      zh: "ERNIE 5.1 发布，以更小激活规模强化 Agent、推理、深度搜索和创意写作。",
      en: "ERNIE 5.1 launches with a smaller active footprint and stronger agents, reasoning, search and writing.",
    },
    kind: "new",
    confidence: "verified",
    sourceIds: ["s-ernie-51"],
  },
  {
    id: "ch1",
    entityId: "e-gpt",
    date: "2026-07-15",
    summary: {
      zh: "GPT-5 在 SWE-bench Verified 上刷新记录（62.4%）。",
      en: "GPT-5 sets new SWE-bench Verified record (62.4%).",
    },
    kind: "benchmark",
    confidence: "verified",
  },
  {
    id: "ch2",
    entityId: "e-claude",
    date: "2026-07-14",
    summary: {
      zh: "Claude 4.5 新增 200 万 token 长文档预览。",
      en: "Claude 4.5 adds 2M-token long doc preview.",
    },
    kind: "updated",
    confidence: "verified",
  },
  {
    id: "ch3",
    entityId: "e-deepseek",
    date: "2026-07-13",
    summary: {
      zh: "DeepSeek R2 权重上传 Hugging Face，社区开始复现基准。",
      en: "DeepSeek R2 weights on Hugging Face; community starts reproducing benchmarks.",
    },
    kind: "new",
    confidence: "verified",
  },
  {
    id: "ch9",
    entityId: "e-deepseek",
    date: "2026-07-11",
    summary: {
      zh: "DeepSeek R2 API 输入价格下调 30%，上下文窗口扩展至 256K。",
      en: "DeepSeek R2 API input pricing drops 30% and context expands to 256K.",
    },
    kind: "updated",
    confidence: "inferred",
    sourceIds: ["s-deepseek-r2"],
  },
  {
    id: "ch4",
    entityId: "e-gemini",
    date: "2026-07-12",
    summary: {
      zh: "Gemini 2.5 Pro 视频输入延长到 2 小时。",
      en: "Gemini 2.5 Pro video input extended to 2h.",
    },
    kind: "updated",
    confidence: "verified",
  },
  {
    id: "ch5",
    entityId: "e-gpt",
    date: "2026-07-10",
    summary: {
      zh: "社区传闻 GPT-5 上下文可达 1M，官方未确认。",
      en: "Community rumor: GPT-5 context up to 1M; not confirmed.",
    },
    kind: "rumor",
    confidence: "unverified",
  },
  {
    id: "ch6",
    entityId: "e-mcp",
    date: "2026-07-08",
    summary: {
      zh: "MCP 1.0 稳定版发布，主流 IDE 已集成。",
      en: "MCP 1.0 stable released; major IDEs integrated.",
    },
    kind: "new",
    confidence: "verified",
  },
  {
    id: "ch7",
    entityId: "e-qwen",
    date: "2026-07-07",
    summary: { zh: "Qwen3-Max 开源 480B 参数版本。", en: "Qwen3-Max open-sources 480B variant." },
    kind: "new",
    confidence: "verified",
  },
  {
    id: "ch8",
    entityId: "e-cursor",
    date: "2026-07-06",
    summary: {
      zh: "Cursor 支持自定义 Agent 编排。",
      en: "Cursor adds custom agent orchestration.",
    },
    kind: "updated",
    confidence: "verified",
  },
];
