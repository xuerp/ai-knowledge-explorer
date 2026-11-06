import { useQuery } from "@tanstack/react-query";
import initialOverview from "@/data/generated/home-overview.json";
import type { HomeOverview } from "@/domain/home-overview";
import { homeOverviewQueryOptions } from "@/domain/home-sync";
import { knowledgeRepository } from "@/services/knowledge-repository";

export function useHomeOverview() {
  const query = useQuery(
    homeOverviewQueryOptions(knowledgeRepository, initialOverview as HomeOverview),
  );
  return {
    ...query,
    automatic: knowledgeRepository.mode === "live",
    hasSynced: query.dataUpdatedAt > 0,
  };
}
