import { findClaimLifecycleMatches } from "@/domain/claim-lifecycle";
import { assessReviewItem } from "@/domain/review-priority";
import type { ReviewQueueItem } from "@/services/admin-api";

export type ReviewLane =
  "fresh-safe" | "duplicate" | "possible-update" | "high-risk" | "invalid-stale";

function normalize(value?: string) {
  return (value ?? "").trim().toLocaleLowerCase().replaceAll(/\s+/g, " ");
}

function hasAnchoredExcerpt(item: ReviewQueueItem) {
  const subject = normalize(item.claim.subject);
  const objectOrValue = normalize(item.claim.objectOrValue);
  return Boolean(
    subject &&
    objectOrValue &&
    item.evidenceItems.some((evidence) => {
      const excerpt = normalize(evidence.sourceExcerpt);
      return excerpt.includes(subject) && excerpt.includes(objectOrValue);
    }),
  );
}

export function classifyReviewLane(
  item: ReviewQueueItem,
  history: readonly ReviewQueueItem[],
  now: Date = new Date(),
): ReviewLane {
  const assessment = assessReviewItem(item, now);
  if (
    !item.entityId ||
    item.evidenceItems.length === 0 ||
    !hasAnchoredExcerpt(item) ||
    assessment.freshness === "stale"
  ) {
    return "invalid-stale";
  }

  const lifecycleMatches = findClaimLifecycleMatches(item, history);
  if (lifecycleMatches.some((match) => match.relationship === "duplicate")) {
    return "duplicate";
  }
  if (lifecycleMatches.some((match) => match.relationship === "update")) {
    return "possible-update";
  }
  if (assessment.risk === "high") {
    return "high-risk";
  }
  return "fresh-safe";
}

export function reviewLaneCounts(
  items: readonly ReviewQueueItem[],
  history: readonly ReviewQueueItem[],
  now: Date = new Date(),
): Record<ReviewLane, number> {
  const counts: Record<ReviewLane, number> = {
    "fresh-safe": 0,
    duplicate: 0,
    "possible-update": 0,
    "high-risk": 0,
    "invalid-stale": 0,
  };
  for (const item of items) {
    counts[classifyReviewLane(item, history, now)] += 1;
  }
  return counts;
}
