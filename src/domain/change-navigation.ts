import type { ChangeEvent } from "./types";

export function chronologicalChanges(changes: ChangeEvent[]) {
  return [...changes].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function visiblePageNumbers(pageIndex: number, pageCount: number) {
  if (pageCount < 1) return [];
  const length = Math.min(5, pageCount);
  const start = Math.max(0, Math.min(pageIndex - 2, pageCount - length));
  return Array.from({ length }, (_, index) => start + index);
}
