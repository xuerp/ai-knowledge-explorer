import type { Entity } from "./types";

export type ProductLineGroup = {
  id: string;
  name: NonNullable<NonNullable<Entity["release"]>["productLine"]>["name"];
  positioning: NonNullable<NonNullable<Entity["release"]>["productLine"]>["positioning"];
  versions: Entity[];
  latest: Entity;
};

export function modelReleaseDate(version: Entity) {
  return version.release?.releasedAt ?? version.firstReleasedAt ?? "";
}

export function compareModelReleaseDates(left: Entity, right: Entity) {
  return (
    modelReleaseDate(right).localeCompare(modelReleaseDate(left)) || left.id.localeCompare(right.id)
  );
}

function productLinePriority(id: string) {
  const generation = /^gpt-(\d+)(?:-(\d+)|o)?$/.exec(id);
  if (generation) return -Number(generation[1]) * 100 - Number(generation[2] ?? 0);
  if (/(?:pro|astra|fable|max|flagship)$/.test(id)) return 10;
  if (id.endsWith("-opus")) return 15;
  if (/(?:sol|sonnet|plus)$/.test(id)) return 20;
  if (/(?:luna|haiku|mini|lite)$/.test(id)) return 30;
  if (/(?:coder|code)$/.test(id)) return 35;
  if (/(?:general)$/.test(id)) return 120;
  if (id.endsWith("-flash")) return 20;
  if (id.endsWith("-flash-lite")) return 30;
  if (id.includes("live")) return 40;
  if (id.includes("image")) return 50;
  if (id.includes("tts") || id.includes("audio")) return 60;
  if (id.includes("transcribe")) return 70;
  if (id.includes("video")) return 80;
  if (id.includes("research")) return 90;
  if (id.includes("embedding")) return 100;
  if (id.includes("robotics")) return 110;
  return 100;
}

export function groupModelProductLines(versions: Entity[]): ProductLineGroup[] {
  const lines = new Map<string, ProductLineGroup>();

  [...versions].sort(compareModelReleaseDates).forEach((version) => {
    const productLine = version.release?.productLine;
    if (!productLine) return;
    const existing = lines.get(productLine.id);
    if (existing) {
      existing.versions.push(version);
      if (
        (isInactiveReleaseStage(existing.latest.release?.stage) &&
          !isInactiveReleaseStage(version.release?.stage)) ||
        (!isInactiveReleaseStage(version.release?.stage) &&
          version.release?.catalogCurrent === true &&
          existing.latest.release?.catalogCurrent !== true)
      ) {
        existing.latest = version;
      }
      return;
    }
    lines.set(productLine.id, {
      ...productLine,
      versions: [version],
      latest: version,
    });
  });

  return Array.from(lines.values())
    .map((line) => {
      if (/^gpt-\d/.test(line.id)) {
        const tierOrder = [
          "Standard",
          "Astra",
          "Sol",
          "Pro",
          "Terra",
          "Luna",
          "Mini",
          "Nano",
          "Instant",
          "Codex",
        ];
        const rank = (version: Entity) => {
          const index = tierOrder.indexOf(version.release?.variant ?? "");
          return index < 0 ? tierOrder.length : index;
        };
        const versions = [...line.versions].sort((left, right) => rank(left) - rank(right));
        const latest =
          versions.find((version) => version.release?.catalogCurrent === true) ?? line.latest;
        return { ...line, latest, versions };
      }
      return {
        ...line,
        versions: [
          line.latest,
          ...line.versions.filter((version) => version.id !== line.latest.id),
        ],
      };
    })
    .sort(
      (left, right) =>
        productLinePriority(left.id) - productLinePriority(right.id) ||
        left.id.localeCompare(right.id),
    );
}

export function isInactiveReleaseStage(stage: NonNullable<Entity["release"]>["stage"] | undefined) {
  return stage === "retired" || stage === "deprecated" || stage === "pending";
}

export function isCurrentProductLineVersion(line: ProductLineGroup, version: Entity) {
  if (isInactiveReleaseStage(version.release?.stage)) return false;
  if (version.release?.catalogCurrent === false) return false;
  if (version.release?.catalogCurrent === true) return true;
  const latestDate = line.latest.release?.releasedAt ?? line.latest.firstReleasedAt;
  const versionDate = version.release?.releasedAt ?? version.firstReleasedAt;
  return version.id === line.latest.id || Boolean(latestDate && versionDate === latestDate);
}
