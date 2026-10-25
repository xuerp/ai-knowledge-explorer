import { catalogChanges } from "./catalog-changes.mjs";

// Match KnowledgeRepository.load_seed: extension adds, frontier replaces by ID.
// Arrays are authoritative values; merging them would keep stale facts alive.
function mergeRecord(base, overlay) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
        ? mergeRecord(merged[key], value)
        : value;
  }
  return merged;
}

function mergeItems(base, overlay, replace) {
  const items = new Map(base.map((item) => [item.id, item]));
  for (const item of overlay) {
    if (!items.has(item.id)) items.set(item.id, item);
    else if (replace) items.set(item.id, mergeRecord(items.get(item.id), item));
  }
  return [...items.values()];
}

export function applyCatalogOverlays(baseline, extension, frontier) {
  const snapshot = structuredClone(baseline);
  for (const [overlay, replace] of [
    [extension, false],
    [frontier, true],
  ]) {
    for (const key of ["entities", "evidence", "claims"]) {
      snapshot[key] = mergeItems(snapshot[key] ?? [], overlay[key] ?? [], replace);
    }
    snapshot.graph.edges = mergeItems(snapshot.graph.edges, overlay.relations ?? [], replace);
    const nodeIds = new Set(snapshot.graph.nodes.map((node) => node.entityId));
    for (const entity of overlay.entities ?? []) {
      if (nodeIds.has(entity.id)) continue;
      snapshot.graph.nodes.push({
        id: `node-${entity.id}`,
        entityId: entity.id,
        type: entity.type ?? "model",
        importance: replace ? 0.9 : 0.82,
      });
      nodeIds.add(entity.id);
    }
    for (const [entityId, events] of Object.entries(overlay.timeline ?? {})) {
      snapshot.timeline[entityId] = mergeItems(snapshot.timeline[entityId] ?? [], events, replace);
    }
    if (overlay.supersededChangeIds?.length) {
      const superseded = new Set(overlay.supersededChangeIds);
      snapshot.changes = snapshot.changes.filter((change) => !superseded.has(change.id));
    }
  }
  snapshot.changes = mergeItems(snapshot.changes, catalogChanges(snapshot), true).sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
  const verifiedAt = [
    extension.meta?.verifiedAt,
    frontier.meta?.verifiedAt,
    frontier.meta?.changeEventsVerifiedAt,
  ]
    .filter(Boolean)
    .sort()
    .at(-1);
  if (verifiedAt) {
    snapshot.meta.retrievedAt = `${verifiedAt}T00:00:00Z`;
  }
  return snapshot;
}

export function publicCatalogSnapshot(catalog) {
  const snapshot = structuredClone(catalog);
  // Public knowledge is not a record of a visitor's activity. Real activity is
  // loaded from account APIs or explicit local preferences, never seed fixtures.
  for (const key of [
    "following",
    "interestProfile",
    "researchAnswers",
    "notifications",
    "reviewCandidates",
    "syncRuns",
  ]) {
    snapshot[key] = [];
  }
  return snapshot;
}
