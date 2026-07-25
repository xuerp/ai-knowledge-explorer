import type { Confidence, GraphEdge, RelationKind } from "@/domain/types";

export interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
}

export interface EdgeFilters {
  relationKinds?: Set<RelationKind>;
  confidences?: Set<Confidence>;
}

export function filterGraphEdges(edges: GraphEdge[], filters: EdgeFilters): GraphEdge[] {
  return edges.filter((edge) => {
    if (filters.relationKinds && !filters.relationKinds.has(edge.kind)) return false;
    if (filters.confidences && !filters.confidences.has(edge.confidence)) return false;
    return true;
  });
}

export function expandNeighborhood(
  edges: GraphEdge[],
  centerId: string,
  depth: 1 | 2,
): Set<string> {
  const visible = new Set<string>([centerId]);
  let frontier = new Set<string>([centerId]);

  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.fromId) && !visible.has(edge.toId)) next.add(edge.toId);
      if (frontier.has(edge.toId) && !visible.has(edge.fromId)) next.add(edge.fromId);
    }
    next.forEach((id) => visible.add(id));
    frontier = next;
    if (!frontier.size) break;
  }

  return visible;
}

export function findShortestPath(
  edges: GraphEdge[],
  startId: string,
  endId: string,
): GraphPath | null {
  if (startId === endId) return { nodeIds: [startId], edgeIds: [] };

  const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
  for (const edge of edges) {
    const from = adjacency.get(edge.fromId) ?? [];
    from.push({ nodeId: edge.toId, edgeId: edge.id });
    adjacency.set(edge.fromId, from);

    const to = adjacency.get(edge.toId) ?? [];
    to.push({ nodeId: edge.fromId, edgeId: edge.id });
    adjacency.set(edge.toId, to);
  }

  const queue = [startId];
  const visited = new Set([startId]);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();

  while (queue.length) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor.nodeId)) continue;
      visited.add(neighbor.nodeId);
      previous.set(neighbor.nodeId, { nodeId: current, edgeId: neighbor.edgeId });
      if (neighbor.nodeId === endId) {
        const nodeIds = [endId];
        const edgeIds: string[] = [];
        let cursor = endId;
        while (cursor !== startId) {
          const step = previous.get(cursor);
          if (!step) return null;
          edgeIds.unshift(step.edgeId);
          nodeIds.unshift(step.nodeId);
          cursor = step.nodeId;
        }
        return { nodeIds, edgeIds };
      }
      queue.push(neighbor.nodeId);
    }
  }

  return null;
}
