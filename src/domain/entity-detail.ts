import type { EntityType, KnowledgeSnapshot } from "./types";

/** Offline counterpart of the public detail projection. Never hydrate a full catalog. */
export function projectEntityDetail(snapshot: KnowledgeSnapshot, type: EntityType, slug: string) {
  const target = snapshot.entities.find((item) => item.type === type && item.slug === slug);
  if (!target) return null;
  const familyId = target.familyId ?? target.id;
  const primaryIds = new Set([
    target.id,
    familyId,
    ...snapshot.entities.filter((item) => item.familyId === familyId).map((item) => item.id),
  ]);
  const edges = snapshot.graph.edges.filter(
    (edge) => edge.fromId === target.id || edge.toId === target.id,
  );
  const entityIds = new Set([...primaryIds, ...edges.flatMap((edge) => [edge.fromId, edge.toId])]);
  const entities = snapshot.entities
    .filter((item) => entityIds.has(item.id))
    .map((item) =>
      item.id === target.id || item.id === target.familyId
        ? item
        : { ...item, knowledge: undefined, metrics: undefined, capabilities: undefined },
    );
  const claims = snapshot.claims.filter((item) => item.entityId === target.id);
  const timeline = { [target.id]: snapshot.timeline[target.id] ?? [] };
  const changeIds = target.familyId ? new Set([target.id]) : primaryIds;
  const changes = snapshot.changes.filter((item) => changeIds.has(item.entityId));
  const accessUrls = new Set(target.release?.accessChannels.map((channel) => channel.url));
  const sourceIds = new Set<string>();
  function collect(value: unknown) {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.sourceIds))
        record.sourceIds.forEach((id) => sourceIds.add(String(id)));
      Object.values(record).forEach(collect);
    }
  }
  collect([entities, claims, edges, changes, timeline]);
  return {
    ...snapshot,
    entities,
    claims,
    timeline,
    changes,
    evidence: snapshot.evidence.filter(
      (item) => sourceIds.has(item.id) || accessUrls.has(item.url),
    ),
    graph: {
      ...snapshot.graph,
      edges,
      nodes: snapshot.graph.nodes.filter((item) => entityIds.has(item.entityId)),
    },
    following: [],
    interestProfile: [],
    researchQuestions: [],
    researchAnswers: [],
    notifications: [],
    reviewCandidates: [],
    syncRuns: [],
  } satisfies KnowledgeSnapshot;
}
