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
