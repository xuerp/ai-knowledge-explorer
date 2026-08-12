import type { Entity, EntityType, GraphEdge } from "@/domain/types";
import { expandNeighborhood, findShortestPath, type GraphPath } from "@/domain/graph";

export interface RelationshipStep {
  edge: GraphEdge;
  from: Entity;
  to: Entity;
}

export interface EcosystemGroup {
  type: EntityType;
  entities: Entity[];
}

export interface RelationshipStats {
  relationshipCount: number;
  relatedEntityCount: number;
  relationKindCount: number;
  verifiedCount: number;
  sourcedCount: number;
  sourceCount: number;
}

export interface ImpactRoute {
  bridgeId: string;
  firstEdgeId: string;
  secondEdgeId: string;
}

export interface ImpactLead {
  entityId: string;
  routes: ImpactRoute[];
}

export function incidentRelations(edges: GraphEdge[], entityId: string): GraphEdge[] {
  return edges.filter((edge) => edge.fromId === entityId || edge.toId === entityId);
}

export function ecosystemGroups(
  entities: Entity[],
  edges: GraphEdge[],
  entityId: string,
): EcosystemGroup[] {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const relatedIds = new Set<string>();
  for (const edge of incidentRelations(edges, entityId)) {
    relatedIds.add(edge.fromId === entityId ? edge.toId : edge.fromId);
  }
  const grouped = new Map<EntityType, Entity[]>();
  for (const id of relatedIds) {
    const entity = entityById.get(id);
    if (!entity) continue;
    grouped.set(entity.type, [...(grouped.get(entity.type) ?? []), entity]);
  }
  return [...grouped.entries()]
    .map(([type, related]) => ({ type, entities: related }))
    .sort((left, right) => right.entities.length - left.entities.length);
}

export function relationshipSteps(
  entities: Entity[],
  edges: GraphEdge[],
  path: GraphPath | null,
): RelationshipStep[] {
  if (!path) return [];
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const steps: RelationshipStep[] = [];
  path.edgeIds.forEach((edgeId, index) => {
    const edge = edgeById.get(edgeId);
    const from = entityById.get(path.nodeIds[index]);
    const to = entityById.get(path.nodeIds[index + 1]);
    if (edge && from && to) steps.push({ edge, from, to });
  });
  return steps;
}

export function connectionPath(
  entities: Entity[],
  edges: GraphEdge[],
  startId: string,
  endId: string,
): { path: GraphPath | null; steps: RelationshipStep[] } {
  const path = startId && endId ? findShortestPath(edges, startId, endId) : null;
  return { path, steps: relationshipSteps(entities, edges, path) };
}

export function connectionPaths(
  entities: Entity[],
  edges: GraphEdge[],
  startId: string,
  endId: string,
  limit = 3,
): Array<{ path: GraphPath; steps: RelationshipStep[] }> {
  if (!startId || !endId || limit <= 0) return [];
  const first = findShortestPath(edges, startId, endId);
  if (!first) return [];

  const paths: GraphPath[] = [first];
  const queued = [first];
  const seen = new Set([first.edgeIds.join("|")]);
  let attempts = 0;
  while (queued.length && paths.length < limit && attempts < 24) {
    const candidate = queued.shift()!;
    for (const edgeId of candidate.edgeIds) {
      attempts += 1;
      const alternative = findShortestPath(
        edges.filter((edge) => edge.id !== edgeId),
        startId,
        endId,
      );
      if (!alternative) continue;
      const key = alternative.edgeIds.join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push(alternative);
      queued.push(alternative);
      if (paths.length >= limit) break;
    }
  }

  return paths
    .sort((left, right) => left.edgeIds.length - right.edgeIds.length)
    .map((path) => ({ path, steps: relationshipSteps(entities, edges, path) }));
}

export function relationshipStats(edges: GraphEdge[], entityId: string): RelationshipStats {
  const incident = incidentRelations(edges, entityId);
  const relatedIds = new Set(
    incident.map((edge) => (edge.fromId === entityId ? edge.toId : edge.fromId)),
  );
  const sourceIds = new Set(incident.flatMap((edge) => edge.sourceIds));
  return {
    relationshipCount: incident.length,
    relatedEntityCount: relatedIds.size,
    relationKindCount: new Set(incident.map((edge) => edge.kind)).size,
    verifiedCount: incident.filter((edge) => edge.confidence === "verified").length,
    sourcedCount: incident.filter((edge) => edge.sourceIds.length > 0).length,
    sourceCount: sourceIds.size,
  };
}

export function impactLeads(edges: GraphEdge[], entityId: string): ImpactLead[] {
  const directIds = expandNeighborhood(edges, entityId, 1);
  directIds.delete(entityId);
  const leads = new Map<string, ImpactRoute[]>();

  for (const firstEdge of incidentRelations(edges, entityId)) {
    const bridgeId = firstEdge.fromId === entityId ? firstEdge.toId : firstEdge.fromId;
    for (const secondEdge of incidentRelations(edges, bridgeId)) {
      if (secondEdge.id === firstEdge.id) continue;
      const candidateId = secondEdge.fromId === bridgeId ? secondEdge.toId : secondEdge.fromId;
      if (candidateId === entityId || directIds.has(candidateId)) continue;
      const routes = leads.get(candidateId) ?? [];
      if (!routes.some((route) => route.bridgeId === bridgeId)) {
        routes.push({ bridgeId, firstEdgeId: firstEdge.id, secondEdgeId: secondEdge.id });
      }
      leads.set(candidateId, routes);
    }
  }

  return [...leads.entries()]
    .map(([leadId, routes]) => ({ entityId: leadId, routes }))
    .sort((left, right) => right.routes.length - left.routes.length);
}

export function impactScope(
  entities: Entity[],
  edges: GraphEdge[],
  entityId: string,
  depth: 1 | 2,
): { entityIds: string[]; directIds: Set<string>; indirectIds: Set<string> } {
  const knownIds = new Set(entities.map((entity) => entity.id));
  const directIds = expandNeighborhood(edges, entityId, 1);
  directIds.delete(entityId);
  const allIds = expandNeighborhood(edges, entityId, depth);
  allIds.delete(entityId);
  const indirectIds = new Set([...allIds].filter((id) => !directIds.has(id)));
  return {
    entityIds: [...allIds].filter((id) => knownIds.has(id)),
    directIds,
    indirectIds,
  };
}
