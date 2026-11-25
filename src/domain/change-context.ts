import type { ChangeEvent, Entity, ModelAccessChannel } from "@/domain/types";

/** Extra, already-reviewed context for one change on the updates page. No new claims. */
export interface ChangeContext {
  /** The model's place in its product line, from the reviewed release metadata. */
  lineup?: {
    lineName: Entity["name"];
    linePositioning?: Entity["name"];
    modelPositioning?: Entity["name"];
    siblings: Entity[];
  };
  /** Where the model can be used, from the reviewed access channels. */
  access: ModelAccessChannel[];
  /** The previous release in the same family, by release date. */
  previous?: Entity;
  /** Other changes for the same model or its family, newest first. */
  related: ChangeEvent[];
}

const releaseDate = (entity: Entity) => entity.release?.releasedAt ?? entity.firstReleasedAt ?? "";

const normalized = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, " ").trim();

function isPlainRelease(entity: Entity) {
  const release = entity.release;
  if (!release?.generation || !release.variant) return false;
  const plain = normalized(`${release.generation} ${release.variant}`);
  return [entity.name.en, entity.name.zh].some((name) => normalized(name) === plain);
}

export function changeContext(
  change: ChangeEvent,
  entities: readonly Entity[],
  changes: readonly ChangeEvent[],
  relatedLimit = 3,
): ChangeContext {
  const entity = entities.find((item) => item.id === change.entityId);
  if (!entity) return { access: [], related: [] };
  const familyId = entity.familyId ?? entity.id;
  const family = entities.filter((item) => item.familyId === familyId && item.release);

  const line = entity.release?.productLine;
  const lineup = line
    ? {
        lineName: line.name,
        linePositioning: line.positioning,
        modelPositioning: entity.release?.positioning,
        // Current members only: a lineup is what a reader can choose between today.
        siblings: family.filter(
          (item) =>
            item.id !== entity.id &&
            item.release?.productLine?.id === line.id &&
            item.release?.catalogCurrent === true,
        ),
      }
    : undefined;

  // The previous generation of the same variant (GPT-6.1 Sol before GPT-6.2 Sol).
  // Siblings released days apart in one lineup are not predecessors.
  const ownDate = releaseDate(entity);
  const ownGeneration = entity.release?.generation;
  const ownVariant = entity.release?.variant;
  const previous =
    ownDate && ownGeneration && ownVariant
      ? family
          .filter(
            (item) =>
              item.id !== entity.id &&
              item.release?.variant === ownVariant &&
              item.release?.generation !== ownGeneration &&
              releaseDate(item) !== "" &&
              releaseDate(item) < ownDate,
          )
          .sort((left, right) => releaseDate(right).localeCompare(releaseDate(left)))
          // Only a model named exactly "<earlier generation> <variant>" is shown: a
          // preview or experimental build of the same variant is not a predecessor,
          // and showing nothing is better than naming the wrong model.
          .find((item) => isPlainRelease(item))
      : undefined;

  const familyIds = new Set([familyId, ...family.map((item) => item.id)]);
  const related = changes
    .filter((item) => item.id !== change.id && familyIds.has(item.entityId))
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))
    .slice(0, relatedLimit);

  return { lineup, access: entity.release?.accessChannels ?? [], previous, related };
}
