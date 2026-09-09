import type { Entity } from "@/domain/types";

export type ComparisonScope = "versions" | "families";

const defaultFamilyIds = ["e-gpt", "e-claude", "e-gemini"];

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
    .filter((entity): entity is Entity => Boolean(entity));

  if (!requested.length) return { scope: "families", selected: defaultFamilyIds };
  const scope: ComparisonScope = requested.every((entity) => Boolean(entity.familyId))
    ? "versions"
    : "families";
  const selected = requested.map((entity) =>
    scope === "versions" ? entity.id : (entity.familyId ?? entity.id),
  );
  return { scope, selected: [...new Set(selected)] };
}
