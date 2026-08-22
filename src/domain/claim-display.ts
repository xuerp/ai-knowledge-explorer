import type { Claim } from "@/domain/types";

export function splitClaimsForDisplay<T extends Pick<Claim, "updatedAt" | "id">>(
  claims: readonly T[],
  visibleLimit = 8,
): { visible: T[]; history: T[] } {
  if (!Number.isInteger(visibleLimit) || visibleLimit < 1) {
    throw new Error("事实默认展示数量必须是正整数。");
  }
  const ordered = [...claims].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
  return {
    visible: ordered.slice(0, visibleLimit),
    history: ordered.slice(visibleLimit),
  };
}
