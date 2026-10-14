import type { Entity, ReadingMode } from "@/domain/types";

export function referenceSectionsForMode(entity: Entity, mode: ReadingMode) {
  const sections = entity.knowledge?.sections ?? [];
  if (mode === "general" || sections.length < 2) return sections;
  const focusIndex = mode === "product" ? sections.length - 1 : 1;
  return [sections[focusIndex], ...sections.filter((_, index) => index !== focusIndex)];
}
