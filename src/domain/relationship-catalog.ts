import type { Entity, GraphEdge, KnowledgeSnapshot } from "./types";
import { filteredRelationships } from "./relationship-insights";

export interface CatalogRelationship extends GraphEdge {
  /** Original records remain authoritative, including version-specific scope. */
  records: GraphEdge[];
}

export function familyEntityId(entities: Entity[], id: string): string {
  const entity = entities.find((item) => item.id === id);
  return entity?.familyId && entities.some((item) => item.id === entity.familyId)
    ? entity.familyId
    : id;
}

export function graphEntryEntities(entities: Entity[]): Entity[] {
  return entities.filter((entity) => !entity.familyId);
}

/** A family-level reading index, never a replacement for the original evidence. */
export function catalogRelationships(
  snapshot: KnowledgeSnapshot,
  filters: { confidence?: string; linkedOnly?: boolean } = {},
): CatalogRelationship[] {
  const grouped = new Map<string, CatalogRelationship>();
  for (const edge of filteredRelationships(snapshot, {
    linkedOnly: filters.linkedOnly ?? true,
    confidence: filters.confidence,
  })) {
    // Rivalry is a comparison task; archive succession belongs in the family dossier.
    if (edge.kind === "competes-with" || edge.kind === "successor-of") continue;
    const fromId = familyEntityId(snapshot.entities, edge.fromId);
    const toId = familyEntityId(snapshot.entities, edge.toId);
    if (fromId === toId) continue;
    const key = `${fromId}:${edge.kind}:${toId}:${edge.confidence}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.records.push(edge);
      existing.sourceIds = [...new Set([...existing.sourceIds, ...edge.sourceIds])];
    } else {
      grouped.set(key, { ...edge, id: key, fromId, toId, records: [edge] });
    }
  }
  return [...grouped.values()];
}

export function relationshipPurpose(
  edge: GraphEdge,
  entities: Entity[] = [],
): "provider" | "application" | "research" | "technology" {
  if (edge.kind === "developed-by" || edge.kind === "part-of") return "provider";
  if (
    edge.kind === "uses" &&
    entities.some(
      (entity) => entity.id === edge.toId && ["framework", "api", "paper"].includes(entity.type),
    )
  )
    return "technology";
  if (edge.kind === "uses" || edge.kind === "integrates-with") return "application";
  if (edge.kind === "benchmarked-on" || edge.kind === "cited-by") return "research";
  return "technology";
}
