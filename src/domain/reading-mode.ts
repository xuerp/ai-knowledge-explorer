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
export type SectionDensity = "focus" | "supporting" | "hidden";

export interface ReadingModeOption {
  id: ReadingMode;
  shortLabel: LocalizedText;
  label: LocalizedText;
  description: LocalizedText;
  focusAreas: readonly LocalizedText[];
  knowledgeBlockOrder: readonly KnowledgeBlock[];
}

export const READING_MODE_OPTIONS: readonly ReadingModeOption[] = [
  {
    id: "general",
    shortLabel: { zh: "通俗", en: "General" },
    label: { zh: "通俗模式", en: "General" },
    description: {
      zh: "先回答发生了什么，以及这件事对你有什么影响。",
      en: "Start with what happened and what it means for you.",
    },
    focusAreas: [
      { zh: "发生了什么", en: "What changed" },
      { zh: "为什么重要", en: "Why it matters" },
      { zh: "对你的影响", en: "User impact" },
    ],
    knowledgeBlockOrder: ["guide", "use-cases", "limitations"],
  },
  {
    id: "product",
    shortLabel: { zh: "产品", en: "Product" },
    label: { zh: "产品模式", en: "Product" },
    description: {
      zh: "围绕用户场景、竞争变化、成本限制与产品选择组织信息。",
      en: "Organize information around users, competition, cost, limits, and product choice.",
    },
    focusAreas: [
      { zh: "用户影响", en: "User impact" },
      { zh: "适用场景", en: "Use cases" },
      { zh: "竞品与商业变化", en: "Competition & business" },
    ],
    knowledgeBlockOrder: ["use-cases", "limitations", "guide"],
  },
  {
    id: "technical",
    shortLabel: { zh: "技术", en: "Technical" },
    label: { zh: "技术模式", en: "Technical" },
    description: {
      zh: "优先核对规格参数、API、Benchmark、技术限制与原始 Evidence。",
      en: "Prioritize specifications, APIs, benchmarks, technical limits, and original evidence.",
    },
    focusAreas: [
      { zh: "规格参数", en: "Specifications" },
      { zh: "API 与 Benchmark", en: "APIs & benchmarks" },
      { zh: "Evidence", en: "Evidence" },
    ],
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

const ENTITY_SECTION_DENSITY: Record<
  EntityPageKind,
  Record<ReadingMode, Partial<Record<EntitySection, SectionDensity>>>
> = {
  model: {
    general: {
      guide: "focus",
      claims: "focus",
      lineage: "supporting",
      relationships: "supporting",
      timeline: "supporting",
      questions: "supporting",
      profile: "hidden",
      comparison: "hidden",
      evidence: "hidden",
    },
    product: {
      guide: "focus",
      claims: "focus",
      lineage: "focus",
      comparison: "focus",
      relationships: "supporting",
      timeline: "supporting",
      profile: "hidden",
      questions: "hidden",
      evidence: "hidden",
    },
    technical: {
      profile: "focus",
      claims: "focus",
      relationships: "focus",
      timeline: "focus",
      evidence: "focus",
      lineage: "supporting",
      guide: "supporting",
      comparison: "hidden",
      questions: "hidden",
    },
  },
  generic: {
    general: {
      guide: "focus",
      claims: "focus",
      relationships: "supporting",
      timeline: "supporting",
      profile: "hidden",
      evidence: "hidden",
    },
    product: {
      guide: "focus",
      claims: "focus",
      relationships: "focus",
      timeline: "supporting",
      profile: "hidden",
      evidence: "hidden",
    },
    technical: {
      profile: "focus",
      claims: "focus",
      relationships: "focus",
      timeline: "focus",
      evidence: "focus",
      guide: "supporting",
    },
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

export function getEntitySectionDensity(
  mode: ReadingMode,
  page: EntityPageKind,
  section: EntitySection,
): SectionDensity {
  return ENTITY_SECTION_DENSITY[page][mode][section] ?? "hidden";
}

export function getVisibleEntitySections(
  mode: ReadingMode,
  page: EntityPageKind,
  availableSections: readonly EntitySection[],
): EntitySection[] {
  return availableSections.filter(
    (section) => getEntitySectionDensity(mode, page, section) !== "hidden",
  );
}
