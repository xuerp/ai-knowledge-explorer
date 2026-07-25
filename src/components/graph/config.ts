import type { EntityType } from "@/domain/types";

export const NODE_TYPES: { type: EntityType; zh: string; en: string }[] = [
  { type: "model", zh: "模型", en: "Model" },
  { type: "company", zh: "公司", en: "Company" },
  { type: "framework", zh: "框架 / 协议", en: "Framework" },
  { type: "benchmark", zh: "评测", en: "Benchmark" },
  { type: "paper", zh: "论文", en: "Paper" },
  { type: "application", zh: "应用", en: "Application" },
];
