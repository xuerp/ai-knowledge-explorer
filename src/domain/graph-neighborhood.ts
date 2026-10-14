/** A bounded neighborhood preserves every neighbor across pages, with a fixed center. */
export function graphNeighborhoodPage(
  ids: readonly string[],
  centerId: string,
  page: number,
  capacity: number,
  bridges: ReadonlyMap<string, string> = new Map(),
) {
  const neighbors = [...new Set(ids)].filter((id) => id !== centerId);
  const size = Math.max(bridges.size ? 2 : 1, Math.floor(capacity) - 1);
  const groups: string[][] = [];
  let group = new Set<string>();
  for (const id of neighbors) {
    const bridge = bridges.get(id);
    const required = bridge && neighbors.includes(bridge) ? [bridge, id] : [id];
    if (group.size + required.filter((nodeId) => !group.has(nodeId)).length > size) {
      groups.push([...group]);
      group = new Set();
    }
    required.forEach((nodeId) => group.add(nodeId));
  }
  if (group.size || !groups.length) groups.push([...group]);
  const pages = groups.length;
  const current = Math.max(0, Math.min(Math.floor(page), pages - 1));
  return {
    ids: [centerId, ...groups[current]],
    page: current,
    pages,
    total: neighbors.length + 1,
  };
}
