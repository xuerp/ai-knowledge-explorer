import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import { knowledgeRepository } from "@/services/knowledge-repository";

export const knowledgeKeys = {
  all: ["knowledge"] as const,
  snapshot: () => [...knowledgeKeys.all, "snapshot"] as const,
};

const subscribeToConnectivity = (onStoreChange: () => void) => {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
};

export function useKnowledgeSnapshot() {
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => window.navigator.onLine,
    () => true,
  );
  const query = useQuery({
    queryKey: knowledgeKeys.snapshot(),
    queryFn: ({ signal }) => knowledgeRepository.getSnapshot(signal),
    initialData: knowledgeRepository.mode === "demo" ? DEMO_KNOWLEDGE_SNAPSHOT : undefined,
    staleTime: knowledgeRepository.mode === "demo" ? Infinity : 60_000,
    retry: knowledgeRepository.mode === "demo" ? false : 2,
  });

  return {
    ...query,
    online,
    unavailableKind: query.error ? (online ? "error" : "offline") : "loading",
  } as const;
}
