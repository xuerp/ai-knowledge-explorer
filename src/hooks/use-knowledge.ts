import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import type { EntityType } from "@/domain/types";
import { knowledgeRepository, type EntityQuery } from "@/services/knowledge-repository";

export const knowledgeKeys = {
  all: ["knowledge"] as const,
  snapshot: () => [...knowledgeKeys.all, "snapshot"] as const,
  entities: (query: EntityQuery) => [...knowledgeKeys.all, "entities", query] as const,
  modelFamilies: () => [...knowledgeKeys.all, "model-families"] as const,
  familyVersions: (familyId: string) =>
    [...knowledgeKeys.all, "model-families", familyId, "versions"] as const,
  versionComparison: (versionIds: string[]) =>
    [...knowledgeKeys.all, "model-versions", "compare", ...versionIds] as const,
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

export function useEntities(query: EntityQuery = {}) {
  return useQuery({
    queryKey: knowledgeKeys.entities(query),
    queryFn: ({ signal }) => knowledgeRepository.getEntities(query, signal),
    initialData:
      knowledgeRepository.mode === "demo"
        ? DEMO_KNOWLEDGE_SNAPSHOT.entities.filter(
            (entity) => !query.type || entity.type === query.type,
          )
        : undefined,
    staleTime: knowledgeRepository.mode === "demo" ? Infinity : 60_000,
  });
}

export function useModelCatalog() {
  return useEntities({ type: "model" satisfies EntityType });
}

export function useModelFamilies() {
  return useQuery({
    queryKey: knowledgeKeys.modelFamilies(),
    queryFn: ({ signal }) => knowledgeRepository.getModelFamilies(signal),
    staleTime: knowledgeRepository.mode === "demo" ? Infinity : 60_000,
  });
}

export function useFamilyVersions(familyId: string) {
  return useQuery({
    queryKey: knowledgeKeys.familyVersions(familyId),
    queryFn: ({ signal }) => knowledgeRepository.getFamilyVersions(familyId, signal),
    enabled: Boolean(familyId),
    staleTime: knowledgeRepository.mode === "demo" ? Infinity : 60_000,
  });
}

export function useModelVersionComparison(versionIds: string[]) {
  return useQuery({
    queryKey: knowledgeKeys.versionComparison(versionIds),
    queryFn: ({ signal }) => knowledgeRepository.compareModelVersions(versionIds, signal),
    enabled: versionIds.length >= 2,
    staleTime: knowledgeRepository.mode === "demo" ? Infinity : 60_000,
  });
}
