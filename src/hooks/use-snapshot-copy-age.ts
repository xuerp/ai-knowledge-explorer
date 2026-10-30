import { useApp } from "@/lib/app-state";
import { staleSnapshotCopyAge } from "@/lib/edge-copy";

// Relative age of an edge-cached snapshot copy, or null while it is still recent.
export function useSnapshotCopyAgeLabel(cachedAt?: string | null): string | null {
  const { t } = useApp();
  const age = staleSnapshotCopyAge(cachedAt);
  if (age === null) return null;
  const hours = Math.floor(age / (60 * 60 * 1000));
  if (hours < 24) return t(`${hours} 小时前`, `${hours} h ago`);
  const days = Math.floor(hours / 24);
  return t(`${days} 天前`, `${days} d ago`);
}
