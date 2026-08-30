import type { Confidence, EntityType, LocalizedText, RelationKind } from "@/domain/types";

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

export const RELATION_LABELS: Record<RelationKind, LocalizedText> = {
  "developed-by": { zh: "研发方", en: "Developed by" },
  "based-on": { zh: "基于", en: "Based on" },
  "competes-with": { zh: "竞品", en: "Competes with" },
  "benchmarked-on": { zh: "评测于", en: "Benchmarked on" },
  uses: { zh: "使用", en: "Uses" },
  "cited-by": { zh: "被引用", en: "Cited by" },
  "part-of": { zh: "属于", en: "Part of" },
  "successor-of": { zh: "继任", en: "Successor of" },
  "integrates-with": { zh: "集成", en: "Integrates with" },
};
