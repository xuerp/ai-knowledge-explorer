import manifest from "../../product/core-models.v1.json";
import type { Entity } from "./types";

// The historical coverage registry orders established families; the catalog
// supplies additional families without claiming equivalent archive coverage.
export function browseModelFamilies(entities: Entity[]): Entity[] {
  const order = new Map(manifest.models.map((model, index) => [model.entityId, index]));
  return entities
    .filter((entity) => entity.type === "model" && !entity.familyId)
    .sort((left, right) => (order.get(left.id) ?? Infinity) - (order.get(right.id) ?? Infinity));
}
