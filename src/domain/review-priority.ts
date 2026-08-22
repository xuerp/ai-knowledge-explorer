import type { ReviewQueueItem } from "@/services/admin-api";

export type ReviewRisk = "high" | "standard";
export type ReviewFreshness = "fresh" | "aging" | "stale";

export type ReviewAssessment = {
  risk: ReviewRisk;
  freshness: ReviewFreshness;
  batchSafe: boolean;
  sortScore: number;
};

const sensitivePredicates = new Set([
  "available-as",
  "availability",
  "benchmark",
  "benchmark-score",
  "benchmarked-on",
  "context-window",
  "deprecation",
  "input-price",
  "output-price",
  "price",
  "pricing",
  "released-at",
  "release-date",
  "status",
]);

export function assessReviewItem(item: ReviewQueueItem, now: Date = new Date()): ReviewAssessment {
  const subject = normalize(item.claim.subject);
  const objectOrValue = normalize(item.claim.objectOrValue);
  const batchSafe =
    item.status === "pending" &&
    item.conflictClaimIds.length === 0 &&
    Boolean(subject && objectOrValue) &&
    item.evidenceItems.some((evidence) => {
      const excerpt = normalize(evidence.sourceExcerpt);
      return excerpt.includes(subject) && excerpt.includes(objectOrValue);
    });
  const risk: ReviewRisk =
    item.status === "needs-more-evidence" ||
    item.conflictClaimIds.length > 0 ||
    item.evidenceItems.length === 0 ||
    item.evidenceItems.some((evidence) => evidence.type === "community") ||
    sensitivePredicates.has(normalize(item.claim.predicate))
      ? "high"
      : "standard";
  const newestEvidenceAt = item.evidenceItems.reduce<number>((latest, evidence) => {
    const parsed = Date.parse(evidence.publishedAt || evidence.collectedAt);
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  const referenceAt = newestEvidenceAt || Date.parse(item.createdAt);
  const ageDays = Number.isFinite(referenceAt)
    ? Math.max(0, (now.getTime() - referenceAt) / 86_400_000)
    : Number.POSITIVE_INFINITY;
  const freshness: ReviewFreshness = ageDays <= 90 ? "fresh" : ageDays <= 365 ? "aging" : "stale";
  const freshnessScore = freshness === "fresh" ? 300 : freshness === "aging" ? 100 : 0;
  const riskScore = risk === "high" ? 200 : 0;
  const batchScore = batchSafe ? 25 : 0;
  const createdAt = Date.parse(item.createdAt);

  return {
    risk,
    freshness,
    batchSafe,
    sortScore:
      freshnessScore + riskScore + batchScore + (Number.isFinite(createdAt) ? createdAt / 1e13 : 0),
  };
}

export function orderReviewItems(
  items: readonly ReviewQueueItem[],
  now: Date = new Date(),
): ReviewQueueItem[] {
  return [...items].sort(
    (left, right) => assessReviewItem(right, now).sortScore - assessReviewItem(left, now).sortScore,
  );
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
}
