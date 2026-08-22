import type { LocalizedText, ReadingMode } from "@/domain/types";

export type KnowledgeBlock = "guide" | "use-cases" | "limitations";
export type EntitySection =
  | "guide"
  | "profile"
  | "claims"
  | "lineage"
  | "relationships"
  | "timeline"
  | "comparison"
  | "questions"
  | "evidence";
export type EntityPageKind = "model" | "generic";

export interface ReadingModeOption {
  id: ReadingMode;
  shortLabel: LocalizedText;
  label: LocalizedText;
  description: LocalizedText;
  knowledgeBlockOrder: readonly KnowledgeBlock[];
}

export const READING_MODE_OPTIONS: readonly ReadingModeOption[] = [
  {
    id: "general",
    shortLabel: { zh: "通俗", en: "General" },
    label: { zh: "通俗模式", en: "General" },
    description: {
      zh: "解释术语，优先说明发生了什么、为什么重要。",
      en: "Explain terms and prioritize what happened and why it matters.",
    },
    knowledgeBlockOrder: ["guide", "use-cases", "limitations"],
  },
  {
    id: "product",
    shortLabel: { zh: "产品", en: "Product" },
    label: { zh: "产品模式", en: "Product" },
    description: {
      zh: "优先展示使用场景、产品机会、限制与版本选择。",
      en: "Prioritize use cases, opportunities, limits, and release choices.",
    },
    knowledgeBlockOrder: ["use-cases", "limitations", "guide"],
  },
  {
    id: "technical",
    shortLabel: { zh: "技术", en: "Technical" },
    label: { zh: "技术模式", en: "Technical" },
    description: {
      zh: "优先展示规格、指标、关系、时间线与原始证据。",
      en: "Prioritize specifications, metrics, relations, timeline, and evidence.",
    },
    knowledgeBlockOrder: ["guide", "limitations", "use-cases"],
  },
] as const;

const ENTITY_SECTION_ORDER: Record<
  EntityPageKind,
  Record<ReadingMode, readonly EntitySection[]>
> = {
  model: {
    general: [
      "guide",
      "profile",
      "claims",
      "lineage",
      "relationships",
      "timeline",
      "comparison",
      "questions",
      "evidence",
    ],
    product: [
      "guide",
      "claims",
      "lineage",
      "comparison",
      "relationships",
      "timeline",
      "profile",
      "questions",
      "evidence",
    ],
    technical: [
      "profile",
      "lineage",
      "claims",
      "relationships",
      "timeline",
      "evidence",
      "guide",
      "comparison",
      "questions",
    ],
  },
  generic: {
    general: ["guide", "profile", "claims", "relationships", "timeline", "evidence"],
    product: ["guide", "claims", "relationships", "timeline", "profile", "evidence"],
    technical: ["profile", "relationships", "timeline", "evidence", "claims", "guide"],
  },
};

export const getReadingModeOption = (mode: ReadingMode): ReadingModeOption =>
  READING_MODE_OPTIONS.find((option) => option.id === mode) ?? READING_MODE_OPTIONS[0];

export function getKnowledgeBlockOrder(mode: ReadingMode, block: KnowledgeBlock): number {
  return getReadingModeOption(mode).knowledgeBlockOrder.indexOf(block);
}

export function getEntitySectionPresentation(
  mode: ReadingMode,
  page: EntityPageKind,
  visibleSections: readonly EntitySection[],
): Record<EntitySection, { order: number; eyebrow: string }> {
  const configured = ENTITY_SECTION_ORDER[page][mode];
  const ordered = configured.filter((section) => visibleSections.includes(section));
  const result = {} as Record<EntitySection, { order: number; eyebrow: string }>;

  configured.forEach((section) => {
    const visibleIndex = ordered.indexOf(section);
    result[section] = {
      order: configured.indexOf(section),
      eyebrow: visibleIndex >= 0 ? String(visibleIndex + 1).padStart(2, "0") : "",
    };
  });

  return result;
}
