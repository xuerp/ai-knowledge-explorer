import type { ChangeEvent, Entity, TimelineEntry } from "./types";

export function latestFamilyChange(changes: ChangeEvent[], familyId: string, entities: Entity[]) {
  const ids = new Set([
    familyId,
    ...entities.filter((entity) => entity.familyId === familyId).map((entity) => entity.id),
  ]);
  return changes
    .filter(
      (change) =>
        ids.has(change.entityId) &&
        change.confidence !== "conflict" &&
        change.confidence !== "unverified",
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))[0];
}

// Reviewing a catalog entry is not an iteration in the vendor's model history.
// The disclosure uses a prefix and suffix of this one ordered sequence.
export function familyEvolutionEvents(events: TimelineEntry[]) {
  return events
    .filter(
      (event) =>
        event.dateKind !== "catalog-review" &&
        event.confidence !== "conflict" &&
        event.confidence !== "unverified",
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
