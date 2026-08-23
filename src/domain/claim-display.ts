import type { Claim, Source } from "@/domain/types";

export type ClaimDisplayDate = {
  value: string;
  kind: "effective" | "published";
};

export function getClaimDisplayDate(
  claim: Pick<Claim, "validFrom" | "sourceIds">,
  evidence: readonly Pick<Source, "id" | "publishedAt">[],
): ClaimDisplayDate | undefined {
  if (claim.validFrom) return { value: claim.validFrom, kind: "effective" };

  const sourceIds = new Set(claim.sourceIds);
  const publishedAt = evidence
    .filter((source) => sourceIds.has(source.id) && source.publishedAt)
    .map((source) => source.publishedAt)
    .sort()[0];
  return publishedAt ? { value: publishedAt, kind: "published" } : undefined;
}

export function splitClaimsForDisplay<T extends Pick<Claim, "updatedAt" | "id">>(
  claims: readonly T[],
  visibleLimit = 5,
  preserveInputOrder = false,
): { visible: T[]; history: T[] } {
  if (!Number.isInteger(visibleLimit) || visibleLimit < 1) {
    throw new Error("事实默认展示数量必须是正整数。");
  }
  const ordered = preserveInputOrder
    ? [...claims]
    : [...claims].sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
      );
  return {
    visible: ordered.slice(0, visibleLimit),
    history: ordered.slice(visibleLimit),
  };
}
