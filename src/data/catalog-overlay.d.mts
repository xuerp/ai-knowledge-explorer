import type { KnowledgeSnapshot } from "@/domain/types";

export function applyCatalogOverlays(
  baseline: KnowledgeSnapshot,
  extension: object,
  frontier: object,
): KnowledgeSnapshot;
