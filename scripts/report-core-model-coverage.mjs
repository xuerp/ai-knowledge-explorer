import { readFile, writeFile } from "node:fs/promises";
import { applyCatalogOverlays } from "../src/data/catalog-overlay.mjs";

const manifestPath = new URL("../product/core-models.v1.json", import.meta.url);
const snapshotPath = new URL("../backend/data/demo_snapshot.json", import.meta.url);
const reportPath = new URL("../docs/CORE_MODEL_COVERAGE.md", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const snapshot = applyCatalogOverlays(
  JSON.parse(await readFile(snapshotPath, "utf8")),
  JSON.parse(
    await readFile(new URL("../backend/data/catalog_extension.json", import.meta.url), "utf8"),
  ),
  JSON.parse(
    await readFile(new URL("../backend/data/frontier_catalog_v1.json", import.meta.url), "utf8"),
  ),
);
const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
const timeline = snapshot.timeline ?? {};
const relations = snapshot.graph?.edges ?? [];

const rows = manifest.models.map((entry) => {
  const entity = entities.get(entry.entityId);
  if (!entity || entity.slug !== entry.slug) {
    throw new Error(`Manifest entry does not resolve: ${entry.entityId}/${entry.slug}`);
  }
  const timelineItems = (timeline[entry.entityId] ?? []).filter(
    (item) =>
      item.dateKind !== "catalog-review" &&
      item.confidence !== "conflict" &&
      item.confidence !== "unverified",
  );
  const releases = snapshot.entities.filter((item) => item.familyId === entity.id);
  const sourceIds = new Set([
    ...timelineItems.flatMap((item) => item.sourceIds ?? []),
    ...(entity.knowledge?.keyPoints ?? []).flatMap((item) => item.sourceIds ?? []),
    ...relations
      .filter((item) => item.fromId === entry.entityId || item.toId === entry.entityId)
      .flatMap((item) => item.sourceIds ?? []),
  ]);
  const officialSources = [...sourceIds].filter((id) => evidence.get(id)?.type === "official");
  const knowledge = entity.knowledge ?? {};
  return {
    name: entity.name.en,
    tier: entry.tier,
    versions: timelineItems.length,
    releases: releases.length,
    productLines: new Set(releases.map((item) => item.release?.productLine?.id).filter(Boolean))
      .size,
    capabilities: entity.capabilities?.length ?? 0,
    limitations: knowledge.limitations?.length ?? 0,
    pricing: releases.filter((item) => item.specs?.inputPrice || item.specs?.outputPrice).length,
    deployment: releases.filter((item) => item.release?.accessChannels?.length).length,
    relations: relations.filter(
      (item) => item.fromId === entry.entityId || item.toId === entry.entityId,
    ).length,
    officialSources: officialSources.length,
  };
});

const header = [
  "# Core Model Coverage",
  "",
  `Generated from \`product/core-models.v1.json\` and \`backend/data/demo_snapshot.json\` for manifest ${manifest.manifestVersion}.`,
  "Counts describe the baseline composed with catalog_extension.json and frontier_catalog_v1.json; zeroes are visible gaps, not invented content targets.",
  "A nonzero dimension does not mean every field is known. Missing prices, access channels and release dates remain explicit on each release; retired models and open weights may have no current API rate.",
  "",
  "| Model | Tier | Releases | Product lines | Timeline | Capabilities | Limitations | Releases with pricing | Releases with access | Relations | Official sources |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
const body = rows.map(
  (row) =>
    `| ${row.name} | ${row.tier} | ${row.releases} | ${row.productLines} | ${row.versions} | ${row.capabilities} | ${row.limitations} | ${row.pricing} | ${row.deployment} | ${row.relations} | ${row.officialSources} |`,
);
const gaps = rows.flatMap((row) =>
  [
    ["releases", row.releases],
    ["product lines", row.productLines],
    ["timeline", row.versions],
    ["capabilities", row.capabilities],
    ["limitations", row.limitations],
    ["pricing", row.pricing],
    ["deployment", row.deployment],
    ["relations", row.relations],
    ["official sources", row.officialSources],
  ]
    .filter(([, count]) => count === 0)
    .map(([dimension]) => `- ${row.name}: ${dimension}`),
);
const historyRows = manifest.models.flatMap((family) => {
  const releases = snapshot.entities.filter((entity) => entity.familyId === family.entityId);
  const lines = new Map();
  for (const release of releases) {
    const line = release.release?.productLine;
    if (!line) continue;
    const group = lines.get(line.id) ?? { name: line.name.en, releases: [] };
    group.releases.push(release);
    lines.set(line.id, group);
  }
  return [...lines.values()].map((line) => {
    const dated = line.releases.filter(
      (entity) => entity.release.releasedAt && entity.release.stage !== "pending",
    );
    const covered = dated.filter((entity) =>
      (timeline[family.entityId] ?? []).some(
        (event) =>
          event.releaseEntityId === entity.id &&
          event.date === entity.release.releasedAt &&
          event.confidence === "verified",
      ),
    );
    if (covered.length !== dated.length)
      throw new Error(`Confirmed releases missing from timeline: ${family.entityId}/${line.name}`);
    const dates = dated.map((entity) => entity.release.releasedAt).sort();
    return `| ${entities.get(family.entityId).name.en} | ${line.name} | ${line.releases.length} | ${dated.length} | ${covered.length} | ${dates[0] ?? "Unknown"} → ${dates.at(-1) ?? "Unknown"} |`;
  });
});
const rawOutput = [
  ...header,
  ...body,
  "",
  "## Zero-count dimensions",
  "",
  ...(gaps.length ? gaps : ["- None"]),
  "",
  "## Product-line iteration coverage",
  "",
  "Counts follow publicly documented releases and meaningful updates, not equal quotas. A current catalog review is excluded from the evolution timeline. Dated coverage checks every confirmed version against its linked family milestone; it does not claim an exhaustive vendor archive.",
  "",
  "| Family | Product line | Records | Confirmed dates | Linked milestones | Date range |",
  "| --- | --- | ---: | ---: | ---: | --- |",
  ...historyRows,
  "",
].join("\n");
const { format } = await import("prettier");
const output = await format(rawOutput, { parser: "markdown" });

if (process.argv.includes("--check")) {
  const existing = await readFile(reportPath, "utf8").catch(() => "");
  if (existing !== output)
    throw new Error("Core model coverage report is stale; run with --write.");
} else if (process.argv.includes("--write")) {
  await writeFile(reportPath, output, "utf8");
} else {
  process.stdout.write(output);
}
