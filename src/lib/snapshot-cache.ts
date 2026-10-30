import type { KnowledgeSnapshot } from "@/domain/types";

// Set by the Cloudflare Worker when it fetched the public snapshot from the API.
// Only cached edge copies carry it; offline and direct API responses do not.
export const snapshotFetchedAtHeader = "X-AI-Radar-Snapshot-Fetched-At";

// Younger copies are current enough that an extra notice would only add noise.
export const staleSnapshotCopyMs = 60 * 60 * 1000;

export function withSnapshotCopyTime(
  snapshot: KnowledgeSnapshot,
  fetchedAt: string | null,
): KnowledgeSnapshot {
  if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) return snapshot;
  return { ...snapshot, meta: { ...snapshot.meta, cachedAt: fetchedAt } };
}

// Age in milliseconds of a cached copy old enough to mention, otherwise null.
export function staleSnapshotCopyAge(
  cachedAt: string | null | undefined,
  now = Date.now(),
): number | null {
  const fetchedAt = cachedAt ? Date.parse(cachedAt) : Number.NaN;
  if (Number.isNaN(fetchedAt)) return null;
  const age = now - fetchedAt;
  return age >= staleSnapshotCopyMs ? age : null;
}
