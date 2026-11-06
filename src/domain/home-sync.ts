import type { HomeOverview } from "@/domain/home-overview";
import { RELATION_LABELS } from "@/domain/labels";
import type { KnowledgeRepository } from "@/services/knowledge-repository";

export const HOME_SYNC_INTERVAL_MS = 5 * 60_000;

/** Reject incomplete responses before they can replace the last usable homepage. */
export function validateHomeOverview(value: HomeOverview): HomeOverview {
  const localized = (text: { zh: string; en: string } | undefined) =>
    typeof text?.zh === "string" && typeof text?.en === "string";
  const strings = (items: string[] | undefined) =>
    Array.isArray(items) && items.every((item) => typeof item === "string");
  const counts = value && [
    value.entityCount,
    value.claimCount,
    value.sourcedClaimCount,
    value.relationshipCount,
  ];
  if (
    !counts?.every((count) => Number.isInteger(count) && count >= 0) ||
    value.sourcedClaimCount > value.claimCount ||
    typeof value.meta?.retrievedAt !== "string" ||
    ![
      value.entities,
      value.changes,
      value.evidence,
      value.featuredRelations,
      value.researchQuestions,
    ].every(Array.isArray) ||
    !value.entities.every(
      (item) =>
        typeof item?.id === "string" && typeof item.slug === "string" && localized(item.name),
    ) ||
    !value.changes.every(
      (item) =>
        typeof item?.id === "string" &&
        typeof item.entityId === "string" &&
        typeof item.date === "string" &&
        localized(item.summary) &&
        strings(item.sourceIds),
    ) ||
    !value.evidence.every((item) => typeof item?.id === "string" && typeof item.url === "string") ||
    !value.featuredRelations.every(
      (item) =>
        typeof item?.id === "string" &&
        typeof item.fromId === "string" &&
        typeof item.toId === "string" &&
        Object.hasOwn(RELATION_LABELS, item.kind) &&
        strings(item.sourceIds),
    ) ||
    !value.researchQuestions.every(localized) ||
    (value.catalogUpdatedAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(value.catalogUpdatedAt))
  ) {
    throw new Error("Homepage response is incomplete; retaining the previous catalog.");
  }
  return value;
}

export function homeOverviewQueryOptions(
  repository: Pick<KnowledgeRepository, "mode" | "getHomeOverview">,
  initial: HomeOverview,
) {
  return {
    queryKey: ["knowledge", "home-auto-sync"] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      validateHomeOverview(await repository.getHomeOverview(signal)),
    // Identical server/browser first paint, followed by a non-blocking API refresh.
    initialData: initial,
    initialDataUpdatedAt: 0,
    enabled: repository.mode === "live",
    staleTime: 60_000,
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: "always" as const,
    refetchOnReconnect: "always" as const,
    refetchInterval: HOME_SYNC_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  };
}
