import type { ReviewQueueItem } from "@/services/admin-api";

export type ClaimLifecycleMatch = {
  target: ReviewQueueItem;
  relationship: "duplicate" | "update";
};

function normalize(value?: string) {
  return (value ?? "").trim().toLocaleLowerCase().replaceAll(/\s+/g, " ");
}

export function findClaimLifecycleMatches(
  candidate: ReviewQueueItem,
  history: readonly ReviewQueueItem[],
): ClaimLifecycleMatch[] {
  const subject = normalize(candidate.claim.subject);
  const predicate = normalize(candidate.claim.predicate);
  if (!candidate.entityId || !subject || !predicate) return [];

  return history
    .filter(
      (target) =>
        target.status === "approved" &&
        target.lifecycleStatus === "current" &&
        target.publicationAction !== "merged-evidence" &&
        target.entityId === candidate.entityId &&
        normalize(target.claim.subject) === subject &&
        normalize(target.claim.predicate) === predicate,
    )
    .map((target) => ({
      target,
      relationship:
        normalize(target.claim.objectOrValue) === normalize(candidate.claim.objectOrValue) &&
        (target.claim.validFrom ?? "") === (candidate.claim.validFrom ?? "") &&
        (target.claim.validTo ?? "") === (candidate.claim.validTo ?? "")
          ? ("duplicate" as const)
          : ("update" as const),
    }))
    .sort(
      (left, right) =>
        Number(left.relationship === "update") - Number(right.relationship === "update"),
    )
    .slice(0, 3);
}

export function lifecycleIdempotencyKey(
  candidate: ReviewQueueItem,
  target: ReviewQueueItem,
  action: "merged-evidence" | "superseding",
) {
  const source = `${candidate.id}|${candidate.version}|${target.id}|${target.version}|${action}`;
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `review-lifecycle-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
