import type { Entity } from "@/domain/types";
import { groupModelProductLines } from "@/domain/model-product-lines";

export type ComparisonScope = "versions" | "families";

const defaultFamilyIds = ["e-gpt", "e-claude", "e-gemini"];

export function isComparableModelRelease(entity: Entity) {
  return (
    Boolean(entity.familyId) && entity.release?.stage !== "pending" && entity.status !== "rumor"
  );
}

export function defaultComparableVersionIds(models: Entity[]) {
  return defaultFamilyIds.flatMap((familyId) => {
    const versions = models
      .filter(
        (entity) =>
          entity.familyId === familyId &&
          isComparableModelRelease(entity) &&
          entity.release?.catalogCurrent !== false &&
          !["retired", "deprecated"].includes(entity.release?.stage ?? ""),
      )
      .sort((left, right) =>
        (right.release?.releasedAt ?? right.firstReleasedAt ?? "").localeCompare(
          left.release?.releasedAt ?? left.firstReleasedAt ?? "",
        ),
      );
    const representative = groupModelProductLines(versions)[0]?.latest ?? versions[0];
    return representative ? [representative.id] : [];
  });
}

export function resolveComparisonSelection(
  modelSearch: string | undefined,
  models: Entity[],
): { scope: ComparisonScope; selected: string[] } {
  if (!modelSearch) return { scope: "families", selected: defaultFamilyIds };

  const entityById = new Map(models.map((model) => [model.id, model]));
  const requested = modelSearch
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((id) => entityById.get(id))
    .filter(
      (entity): entity is Entity =>
        Boolean(entity) && (!entity?.familyId || isComparableModelRelease(entity)),
    );

  if (!requested.length) return { scope: "families", selected: defaultFamilyIds };
  const scope: ComparisonScope = requested.every((entity) => Boolean(entity.familyId))
    ? "versions"
    : "families";
  const selected = requested.map((entity) =>
    scope === "versions" ? entity.id : (entity.familyId ?? entity.id),
  );
  return { scope, selected: [...new Set(selected)] };
}
