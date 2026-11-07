import type { KnowledgeRepository } from "@/services/knowledge-repository";
import type { UpdatesOverview } from "./updates-overview";

export function updatesQueryOptions(
  repository: Pick<KnowledgeRepository, "getUpdatesOverview">,
  initialData?: UpdatesOverview,
  updatedAt?: number,
) {
  return {
    queryKey: ["knowledge", "updates"] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => repository.getUpdatesOverview(signal),
    initialData,
    initialDataUpdatedAt: updatedAt,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
  };
}
