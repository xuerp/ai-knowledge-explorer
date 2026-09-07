import { readFile, writeFile } from "node:fs/promises";

const manifestPath = new URL("../product/core-models.v1.json", import.meta.url);
const snapshotPath = new URL("../backend/data/demo_snapshot.json", import.meta.url);
const reportPath = new URL("../docs/CORE_MODEL_COVERAGE.md", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
const timeline = snapshot.timeline ?? {};
const relations = snapshot.graph?.edges ?? [];

const rows = manifest.models.map((entry) => {
  const entity = entities.get(entry.entityId);
  if (!entity || entity.slug !== entry.slug) {
    throw new Error(`Manifest entry does not resolve: ${entry.entityId}/${entry.slug}`);
  }
  const timelineItems = timeline[entry.entityId] ?? [];
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
    capabilities: entity.capabilities?.length ?? 0,
    limitations: knowledge.limitations?.length ?? 0,
    pricing: timelineItems.filter((item) => /price|pricing|价格|成本/i.test(item.summary.en))
      .length,
    deployment: (knowledge.keyPoints ?? []).filter((item) =>
      /deploy|host|api|部署|托管/i.test(`${item.title.en} ${item.description.en}`),
    ).length,
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
  "Counts describe the bundled demo snapshot; zeroes are visible gaps, not invented content targets.",
  "",
  "| Model | Tier | Timeline | Capabilities | Limitations | Pricing mentions | Deployment mentions | Relations | Official sources |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
const body = rows.map(
  (row) =>
    `| ${row.name} | ${row.tier} | ${row.versions} | ${row.capabilities} | ${row.limitations} | ${row.pricing} | ${row.deployment} | ${row.relations} | ${row.officialSources} |`,
);
const gaps = rows.flatMap((row) =>
  [
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
const rawOutput = [
  ...header,
  ...body,
  "",
  "## Evidence-changing gaps",
  "",
  ...(gaps.length ? gaps : ["- None"]),
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
