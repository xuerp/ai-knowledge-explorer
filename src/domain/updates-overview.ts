import type { Entity, Evidence, KnowledgeSnapshot } from "./types";

/** The updates workspace needs no claims, graph, account or review payloads. */
export type UpdatesOverview = Pick<KnowledgeSnapshot, "meta" | "changes"> & {
  entities: Entity[];
  evidence: Evidence[];
};

export function projectUpdatesOverview(snapshot: KnowledgeSnapshot): UpdatesOverview {
  const sourceIds = new Set(snapshot.changes.flatMap((change) => change.sourceIds ?? []));
  return {
    meta: snapshot.meta,
    changes: snapshot.changes,
    entities: snapshot.entities.map((entity) => {
      const projected = { ...entity };
      delete projected.specs;
      delete projected.capabilities;
      delete projected.metrics;
      delete projected.knowledge;
      return projected;
    }),
    evidence: snapshot.evidence
      .filter((source) => sourceIds.has(source.id))
      .map((source) => {
        const projected = { ...source };
        delete projected.sourceExcerpt;
        delete projected.supportsClaimIds;
        delete projected.contradictsClaimIds;
        return projected;
      }),
  };
}
