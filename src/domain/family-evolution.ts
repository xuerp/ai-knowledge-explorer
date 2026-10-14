import type { TimelineEntry } from "./types";

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
