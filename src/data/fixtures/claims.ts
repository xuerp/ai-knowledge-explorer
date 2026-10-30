import type { Claim } from "@/domain/types";

export const CLAIMS: Claim[] = [
  {
    id: "c-gpt5-swe",
    text: {
      zh: "GPT-5 在 SWE-bench Verified 上取得 62.4% 的通过率。",
      en: "GPT-5 achieves 62.4% pass rate on SWE-bench Verified.",
      technical: {
        zh: "在 SWE-bench Verified 500 题子集上，GPT-5 (2026-07-12 发布版) 单次尝试的解决率为 62.4%。",
        en: "On the 500-task SWE-bench Verified subset, GPT-5 (2026-07-12 release) solves 62.4% in a single attempt.",
      },
    },
    confidence: "verified",
    sourceIds: ["s-openai-gpt5", "s-swebench"],
    updatedAt: "2026-07-15",
  },
  {
    id: "c-gpt5-1m",
    text: {
      zh: "GPT-5 支持 1,000,000 token 的上下文窗口。",
      en: "GPT-5 supports a 1,000,000-token context window.",
    },
    confidence: "unverified",
    sourceIds: ["s-community-rumor"],
    updatedAt: "2026-07-10",
  },
  {
    id: "c-claude-align",
    text: {
      zh: "Claude 4.5 在 Anthropic 官方安全评估中拒绝率下降 18%，同时保持有害请求识别率。",
      en: "Claude 4.5 reduces false refusals by 18% while retaining harmful-request detection per Anthropic's evals.",
    },
    confidence: "verified",
    sourceIds: ["s-anthropic-claude"],
    updatedAt: "2026-06-20",
  },
  {
    id: "c-deepseek-cost",
    text: {
      zh: "DeepSeek R2 的推理成本约为同代闭源模型的 1/10。",
      en: "DeepSeek R2 inference cost is roughly 1/10 of comparable closed models.",
    },
    confidence: "inferred",
    sourceIds: ["s-deepseek-r2"],
    updatedAt: "2026-05-30",
  },
  {
    id: "c-gemini-video",
    text: {
      zh: "Gemini 2.5 Pro 原生支持 2 小时长视频输入。",
      en: "Gemini 2.5 Pro natively supports up to 2-hour video inputs.",
    },
    confidence: "verified",
    sourceIds: ["s-google-gemini"],
    updatedAt: "2026-07-05",
  },
];
