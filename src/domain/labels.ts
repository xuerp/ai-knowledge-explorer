import type { Confidence, EntityType, LocalizedText } from "@/domain/types";

export const ENTITY_TYPE_LABELS: Record<EntityType, LocalizedText> = {
  model: { zh: "模型", en: "Model" },
  agent: { zh: "Agent", en: "Agent" },
  framework: { zh: "框架", en: "Framework" },
  paper: { zh: "论文", en: "Paper" },
  benchmark: { zh: "评测", en: "Benchmark" },
  company: { zh: "公司", en: "Company" },
  dataset: { zh: "数据集", en: "Dataset" },
  api: { zh: "API", en: "API" },
  tool: { zh: "工具", en: "Tool" },
  application: { zh: "应用", en: "Application" },
};

export const CONFIDENCE_LABELS: Record<Confidence, LocalizedText> = {
  verified: { zh: "已核验事实", en: "Verified" },
  inferred: { zh: "基于证据的推断", en: "Inferred" },
  unverified: { zh: "未核验", en: "Unverified" },
  conflict: { zh: "存在冲突", en: "Conflict" },
};
