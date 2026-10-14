import type { ChangeEvent } from "./types";

export type ChangeKind = ChangeEvent["kind"];

// An empty selection means all kinds; selected kinds are joined with OR.
export function toggleChangeKind(selected: ChangeKind[], value: ChangeKind | "all") {
  if (value === "all") return [];
  return selected.includes(value)
    ? selected.filter((kind) => kind !== value)
    : [...selected, value];
}

export function matchesChangeKinds(change: ChangeEvent, selected: ChangeKind[]) {
  return selected.length === 0 || selected.includes(change.kind);
}

export function hasLinkedChangeSource(change: ChangeEvent, linkedSourceIds: Set<string>) {
  return Boolean(change.sourceIds?.some((id) => linkedSourceIds.has(id)));
}
