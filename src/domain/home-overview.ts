import type { ChangeEvent, Entity, GraphEdge, KnowledgeSnapshot, Source } from "./types";
import { catalogRelationships } from "./relationship-catalog";
import { featuredRelationships } from "./relationship-insights";

export type HomeEntity = Pick<
  Entity,
  "id" | "type" | "slug" | "name" | "familyId" | "vendor" | "latestVersion"
>;

export interface HomeOverview {
  meta: KnowledgeSnapshot["meta"];
  entityCount: number;
  claimCount: number;
  sourcedClaimCount: number;
  relationshipCount: number;
  entities: HomeEntity[];
  evidence: Pick<Source, "id" | "url">[];
  changes: Pick<ChangeEvent, "id" | "entityId" | "date" | "summary" | "confidence" | "sourceIds">[];
  featuredRelations: GraphEdge[];
  researchQuestions: KnowledgeSnapshot["researchQuestions"];
}

/** Used only for explicit offline browsing or an older API's full public response. */
export function projectHomeOverview(snapshot: KnowledgeSnapshot): HomeOverview {
  const featuredRelations = featuredRelationships(snapshot);
  const ids = new Set(
    snapshot.entities
      .filter((item) => item.type === "model" && !item.familyId)
      .map((item) => item.id),
  );
  const changes = snapshot.changes.slice(0, 3);
  for (const change of changes) ids.add(change.entityId);
  for (const edge of featuredRelations) {
    ids.add(edge.fromId);
    ids.add(edge.toId);
  }
  const sourceIds = new Set(featuredRelations.flatMap((edge) => edge.sourceIds));
  return {
    meta: snapshot.meta,
    entityCount: snapshot.entities.length,
    claimCount: snapshot.claims.length,
    sourcedClaimCount: snapshot.claims.filter((item) => item.sourceIds.length > 0).length,
    relationshipCount: catalogRelationships(snapshot).length,
    entities: snapshot.entities
      .filter((item) => ids.has(item.id))
      .map(({ id, type, slug, name, familyId, vendor, latestVersion }) => ({
        id,
        type,
        slug,
        name,
        familyId,
        vendor,
        latestVersion,
      })),
    evidence: snapshot.evidence
      .filter((item) => sourceIds.has(item.id))
      .map(({ id, url }) => ({ id, url })),
    changes: changes.map(({ id, entityId, date, summary, confidence, sourceIds }) => ({
      id,
      entityId,
      date,
      summary,
      confidence,
      sourceIds,
    })),
    featuredRelations,
    researchQuestions: snapshot.researchQuestions.slice(0, 3),
  };
}
