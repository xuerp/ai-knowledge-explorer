import type { Entity } from "@/domain/types";
import {
  groupModelProductLines,
  isCurrentProductLineVersion,
  isInactiveReleaseStage,
} from "@/domain/model-product-lines";
import { isComparableModelRelease } from "./comparison-selection";

export const COMPARISON_LIMIT = 4;

export function toggleComparisonModel(selected: string[], id: string) {
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  return selected.length < COMPARISON_LIMIT ? [...selected, id] : selected;
}

export function comparisonVersionGroups(models: Entity[], familyId: string) {
  const versions = models.filter(
    (model) =>
      model.type === "model" && model.familyId === familyId && isComparableModelRelease(model),
  );
  const groups = groupModelProductLines(versions).map((line) => ({
    id: line.id,
    name: line.name,
    versions: line.versions.map((model) => ({
      model,
      current: isCurrentProductLineVersion(line, model),
    })),
  }));
  const ungrouped = versions.filter((model) => !model.release?.productLine);
  if (ungrouped.length)
    groups.push({
      id: "other",
      name: { zh: "其他版本", en: "Other releases" },
      versions: ungrouped.map((model) => ({
        model,
        current:
          model.release?.catalogCurrent !== false && !isInactiveReleaseStage(model.release?.stage),
      })),
    });
  return groups;
}

export function filterComparisonGroups(
  groups: ReturnType<typeof comparisonVersionGroups>,
  {
    lineId = "",
    query = "",
    includeHistory = false,
  }: { lineId?: string; query?: string; includeHistory?: boolean },
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .filter((line) => !lineId || line.id === lineId)
    .map((line) => ({
      ...line,
      versions: line.versions.filter(({ model, current }) => {
        if (!includeHistory && !current) return false;
        const searchable = [
          model.name.zh,
          model.name.en,
          model.release?.releaseId,
          ...(model.release?.apiModelIds ?? []),
          ...(model.aliases ?? []),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return words.every((word) => searchable.includes(word));
      }),
    }))
    .filter((line) => line.versions.length);
}
