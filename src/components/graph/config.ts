import type { Confidence, EntityType, LocalizedText, RelationKind } from "@/domain/types";

export type NodeShape = "circle" | "square" | "diamond" | "hexagon";

export const NODE_TYPE_META: Record<
  EntityType,
  { label: LocalizedText; shape: NodeShape; color: string }
> = {
  model: {
    label: { zh: "模型", en: "Model" },
    shape: "circle",
    color: "var(--graph-node-model)",
  },
  company: {
    label: { zh: "公司", en: "Company" },
    shape: "square",
    color: "var(--graph-node-company)",
  },
  framework: {
    label: { zh: "框架 / 协议", en: "Framework" },
    shape: "diamond",
    color: "var(--graph-node-framework)",
  },
  benchmark: {
    label: { zh: "评测", en: "Benchmark" },
    shape: "hexagon",
    color: "var(--graph-node-benchmark)",
  },
  paper: {
    label: { zh: "论文", en: "Paper" },
    shape: "diamond",
    color: "var(--graph-node-paper)",
  },
  application: {
    label: { zh: "应用", en: "Application" },
    shape: "square",
    color: "var(--graph-node-agent)",
  },
  agent: {
    label: { zh: "Agent", en: "Agent" },
    shape: "circle",
    color: "var(--graph-node-agent)",
  },
  dataset: {
    label: { zh: "数据集", en: "Dataset" },
    shape: "hexagon",
    color: "var(--graph-node-paper)",
  },
  api: {
    label: { zh: "API", en: "API" },
    shape: "square",
    color: "var(--graph-node-framework)",
  },
  tool: {
    label: { zh: "工具", en: "Tool" },
    shape: "square",
    color: "var(--graph-node-framework)",
  },
};

const NODE_TYPE_ORDER: EntityType[] = [
  "model",
  "company",
  "framework",
  "benchmark",
  "paper",
  "application",
  "agent",
  "dataset",
  "api",
  "tool",
];

export const NODE_TYPES = NODE_TYPE_ORDER.map((type) => ({
  type,
  ...NODE_TYPE_META[type],
}));

export const RELATION_TYPES: RelationKind[] = [
  "developed-by",
  "based-on",
  "competes-with",
  "benchmarked-on",
  "uses",
  "cited-by",
  "part-of",
  "successor-of",
  "integrates-with",
];

export const CONFIDENCE_TYPES: Confidence[] = ["verified", "inferred", "unverified", "conflict"];
