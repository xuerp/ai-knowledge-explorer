import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";
import { applyCatalogOverlays, publicCatalogSnapshot } from "../src/data/catalog-overlay.mjs";

const [baseline, extension, frontier, manifest] = await Promise.all(
  [
    "backend/data/demo_snapshot.json",
    "backend/data/catalog_extension.json",
    "backend/data/frontier_catalog_v1.json",
    "product/core-models.v1.json",
  ].map(async (file) => JSON.parse(await readFile(file, "utf8"))),
);
const snapshot = applyCatalogOverlays(baseline, extension, frontier);
const specLedger = JSON.parse(await readFile("docs/model-spec-enrichment-20261005.json", "utf8"));
const enrichedIds = new Set(specLedger.entries.map((entry) => entry.entityId));
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { groupModelProductLines, isCurrentProductLineVersion } = await vite.ssrLoadModule(
  "/src/domain/model-product-lines.ts",
);
test.after(() => vite.close());

test("family latest change includes concrete releases without taking another family's update", async () => {
  const { latestFamilyChange } = await vite.ssrLoadModule("/src/domain/family-evolution.ts");
  const changes = [...snapshot.changes].reverse();
  const before = structuredClone(changes);
  const latest = latestFamilyChange(changes, "e-gemini", snapshot.entities);
  assert.equal(latest.entityId, "e-gemini-4-pending");
  assert.equal(latest.date, "2026-10-13");
  assert.deepEqual(changes, before);
  assert.equal(latestFamilyChange(changes, "missing-family", snapshot.entities), undefined);
});

test("deprecated and retired GPT API versions stay browsable without a current badge", () => {
  const versions = snapshot.entities.filter((entity) => entity.familyId === "e-gpt");
  const line = groupModelProductLines(versions).find((item) => item.id === "gpt-5-1");
  assert.deepEqual(
    new Set(line.versions.map((entity) => entity.id)),
    new Set(["e-gpt-51", "e-gpt-51-instant"]),
  );
  assert.ok(line.versions.every((entity) => !isCurrentProductLineVersion(line, entity)));
  assert.equal(versions.find((entity) => entity.id === "e-gpt-4o").release.stage, "deprecated");
  assert.equal(
    versions.find((entity) => entity.id === "e-gpt-51-instant").release.stage,
    "retired",
  );
});

test("Mistral document links stay concise while all independently reviewed fragments remain intact", async () => {
  const { uniqueSourceLinks } = await vite.ssrLoadModule("/src/domain/source-links.ts");
  const modelIds = new Set(["e-mistral-large-3", "e-mistral-large-4"]);
  const claims = snapshot.claims.filter((claim) => modelIds.has(claim.entityId));
  const sourceIds = new Set(claims.flatMap((claim) => claim.sourceIds));
  const fragments = snapshot.evidence.filter((source) => sourceIds.has(source.id));
  const original = structuredClone(fragments);
  const links = uniqueSourceLinks(fragments);
  assert.equal(claims.length, 15);
  assert.equal(fragments.length, 15);
  assert.equal(links.length, 2);
  assert.deepEqual(fragments, original);
  assert.ok(fragments.every((source) => source.sourceExcerpt && source.supportsClaimIds.length));
});

test("source summaries preserve distinct pricing query URLs", async () => {
  const { uniqueSourceLinks } = await vite.ssrLoadModule("/src/domain/source-links.ts");
  const sources = [
    { id: "official-price", url: "https://example.com/pricing?channel=official" },
    { id: "official-second-fragment", url: "https://example.com/pricing?channel=official" },
    { id: "reseller-price", url: "https://example.com/pricing?channel=reseller" },
  ];
  assert.deepEqual(
    uniqueSourceLinks(sources).map((source) => source.id),
    ["official-price", "reseller-price"],
  );
  assert.equal(sources.length, 3);
});

test("document summaries show the latest captured fragment without replacing older claim evidence", async () => {
  const { uniqueSourceLinks } = await vite.ssrLoadModule("/src/domain/source-links.ts");
  const sources = [
    {
      id: "older",
      url: "https://example.com/models",
      collectedAt: "2026-10-03",
      publishedAt: "",
      sourceExcerpt: "older claim",
    },
    {
      id: "release",
      url: "https://example.com/release",
      collectedAt: "2026-10-07",
      publishedAt: "2026-03-18",
    },
    {
      id: "current",
      url: "https://example.com/models",
      collectedAt: "2026-10-07",
      publishedAt: "",
      sourceExcerpt: "current claim",
    },
  ];
  const original = structuredClone(sources);
  assert.deepEqual(
    uniqueSourceLinks(sources).map((source) => source.id),
    ["current", "release"],
  );
  assert.equal(uniqueSourceLinks(sources)[0].publishedAt, "");
  assert.deepEqual(sources, original);
});

test("billing translation preserves English word boundaries and monetary units", async () => {
  const { modelSpecChinese } = await vite.ssrLoadModule("/src/domain/model-spec.ts");
  assert.equal(
    modelSpecChinese("1,000,000 context · 131,072 max output tokens"),
    "1,000,000 上下文 · 131,072 最大输出 tokens",
  );
  assert.equal(
    modelSpecChinese("¥0.2–1.2 / 1M tokens · Beijing · tiered"),
    "¥0.2–1.2 / 1M tokens · 北京 · 阶梯计费",
  );
  assert.equal(modelSpecChinese("$0.05 / minute · session total"), "$0.05 / 分钟 · 会话总价");
});

test("timeline direction and numbered pagination remain correct at both boundaries", async () => {
  const { chronologicalChanges, visiblePageNumbers } = await vite.ssrLoadModule(
    "/src/domain/change-navigation.ts",
  );
  const input = [
    { id: "z", date: "2026-09-30" },
    { id: "a", date: "2026-09-22" },
    { id: "b", date: "2026-09-22" },
  ];
  assert.deepEqual(
    chronologicalChanges(input).map((item) => item.id),
    ["a", "b", "z"],
  );
  assert.equal(input[0].id, "z");
  assert.deepEqual(visiblePageNumbers(0, 32), [0, 1, 2, 3, 4]);
  assert.deepEqual(visiblePageNumbers(5, 32), [3, 4, 5, 6, 7]);
  assert.deepEqual(visiblePageNumbers(31, 32), [27, 28, 29, 30, 31]);
  assert.deepEqual(visiblePageNumbers(1, 2), [0, 1]);
  assert.deepEqual(visiblePageNumbers(0, 0), []);
});

test("all seven peer families have complete, sourced family and release profiles", () => {
  const sources = new Map(snapshot.evidence.map((source) => [source.id, source]));
  for (const family of manifest.models.filter((model) => model.entityId !== "e-gemini")) {
    const entity = snapshot.entities.find((item) => item.id === family.entityId);
    assert.equal(entity.lastUpdatedAt, "2026-10-01");
    assert.ok(entity.knowledge.introduction.length >= 2);
    assert.ok(entity.knowledge.keyPoints.length >= 3);
    assert.ok(entity.knowledge.useCases.length >= 3);
    assert.ok(entity.knowledge.limitations.length >= 3);
    const versions = snapshot.entities.filter((item) => item.familyId === entity.id);
    assert.ok(versions.length >= 4, entity.id);
    assert.ok(new Set(versions.map((item) => item.release?.productLine?.id)).size >= 2);
    for (const version of versions) {
      assert.ok(version.release.productLine.positioning.en, version.id);
      const refreshed = ["e-gpt-5", "e-gpt-5-mini", "e-gpt-5-nano"].includes(version.id);
      const lifecycleRefreshed = [
        "e-gpt-4o",
        "e-gpt-4o-mini",
        "e-gpt-41",
        "e-gpt-41-mini",
        "e-gpt-41-nano",
        "e-gpt-53-codex",
        "e-gpt-54-nano",
        "e-gpt-51",
        "e-gpt-51-instant",
        "e-gpt-52-instant",
        "e-gpt-53-instant",
        "e-gpt-4o-mini-tts",
        "e-gpt-4o-transcribe",
        "e-gpt-realtime-1",
        "e-gpt-image-15",
        "e-gpt-image-1",
        "e-gpt-image-2",
      ].includes(version.id);
      const verified = lifecycleRefreshed
        ? "2026-10-30"
        : refreshed
          ? "2026-10-29"
          : enrichedIds.has(version.id)
            ? "2026-10-05"
            : "2026-10-01";
      assert.equal(version.release.lastVerifiedAt, verified);
      // A source or chronology correction does not re-verify older billing facts.
      assert.ok(version.lastUpdatedAt >= verified, version.id);
      assert.ok(version.specs);
      assert.ok(version.knowledge.introduction.length);
      if (version.release.stage !== "pending") assert.ok(version.knowledge.useCases.length);
      assert.ok(version.knowledge.limitations.length);
      assert.deepEqual(version.metrics, []);
      for (const point of version.knowledge.keyPoints) {
        assert.ok(point.sourceIds.length);
        assert.ok(
          point.sourceIds.some((id) => sources.get(id)?.verifiedAt),
          version.id,
        );
        for (const id of point.sourceIds) {
          const source = sources.get(id);
          assert.equal(source?.type, "official", `${version.id}: ${id}`);
          if (source.verifiedAt) {
            assert.match(source.verifiedAt, /^\d{4}-\d{2}-\d{2}/, id);
            assert.ok(source.verifiedAt.slice(0, 10) <= version.lastUpdatedAt, id);
            assert.ok(source.sourceExcerpt);
          }
        }
      }
      assert.ok(snapshot.timeline[version.id]?.length, version.id);
      for (const event of snapshot.timeline[version.id]) {
        if (event.kind === "release") {
          assert.equal(event.date, version.release.releasedAt, version.id);
        }
      }
    }
  }
});

test("stable histories cover actual iterations and every dated release has a family milestone", async () => {
  const { familyEvolutionEvents } = await vite.ssrLoadModule("/src/domain/family-evolution.ts");
  const claude = groupModelProductLines(
    snapshot.entities.filter((entity) => entity.familyId === "e-claude"),
  );
  assert.equal(claude.find((line) => line.id === "claude-opus").versions.length, 9);
  assert.equal(claude.find((line) => line.id === "claude-sonnet").versions.length, 9);
  // Haiku has three public generations; it must not be padded to nine.
  assert.equal(claude.find((line) => line.id === "claude-haiku").versions.length, 3);
  const coreIds = new Set(manifest.models.map((family) => family.entityId));
  for (const version of snapshot.entities.filter((entity) => coreIds.has(entity.familyId))) {
    const date = version.release.releasedAt;
    if (!date || version.release.stage === "pending") continue;
    const milestones = familyEvolutionEvents(snapshot.timeline[version.familyId]);
    assert.ok(
      milestones.some((event) => event.releaseEntityId === version.id && event.date === date),
      `${version.id}: confirmed release missing from family evolution`,
    );
  }
  const timeline = familyEvolutionEvents(snapshot.timeline["e-claude"]);
  const recent = timeline.slice(0, 3);
  const archive = timeline.slice(3);
  assert.deepEqual([...recent, ...archive], timeline);
  assert.equal(recent[0].date, "2026-09-30");
  assert.ok(recent.at(-1).date >= archive[0].date);
  for (const familyId of coreIds) {
    const events = familyEvolutionEvents(snapshot.timeline[familyId]);
    assert.ok(events.every((event) => event.dateKind !== "catalog-review"));
    assert.ok(events.every((event) => !["conflict", "unverified"].includes(event.confidence)));
    assert.ok(events.every((event, index) => !index || events[index - 1].date >= event.date));
  }
  // Google's lifecycle table and dated changelog disagree for these previews.
  // Neither official date can silently become a confirmed first-release date.
  for (const id of ["e-gemini-31-flash-live", "e-gemini-31-flash-tts"]) {
    const version = snapshot.entities.find((entity) => entity.id === id);
    assert.equal(version.release.releasedAt, null);
    assert.equal(version.firstReleasedAt, null);
    assert.ok(snapshot.timeline[id].some((event) => event.confidence === "conflict"));
    assert.ok(version.knowledge.keyPoints.some((point) => point.sourceIds.length >= 2));
  }
  const kimi = groupModelProductLines(snapshot.entities.filter((e) => e.familyId === "e-kimi"));
  const flagship = kimi.find((line) => line.id === "kimi-flagship");
  assert.ok(flagship.versions.some((e) => e.id === "e-kimi-k2"));
  assert.ok(flagship.versions.some((e) => e.id === "e-kimi-k3"));
  const pro = groupModelProductLines(
    snapshot.entities.filter((entity) => entity.familyId === "e-gemini").reverse(),
  ).find((line) => line.id === "gemini-pro");
  assert.ok(
    pro.versions.findIndex((entity) => entity.id === "e-gemini-25-pro") <
      pro.versions.findIndex((entity) => entity.id === "e-gemini-25-pro-preview-0605"),
    "June GA release must follow later releases and precede its June preview",
  );
});

test("composition is idempotent, preserves inputs and replaces stale arrays", () => {
  const before = structuredClone(baseline);
  assert.deepEqual(applyCatalogOverlays(snapshot, extension, frontier), snapshot);
  assert.deepEqual(baseline, before);
  assert.equal(
    snapshot.entities.find((entity) => entity.id === "e-gpt-5").specs.contextWindow,
    "400,000 context · 128,000 max output tokens",
  );
  assert.equal(
    snapshot.timeline["e-claude"].find((entry) => entry.id === "t-c-2").date,
    "2025-09-29",
  );
  for (const key of ["entities", "evidence", "claims"])
    assert.equal(new Set(snapshot[key].map((item) => item.id)).size, snapshot[key].length);
  assert.equal(
    new Set(snapshot.entities.map((item) => `${item.type}/${item.slug}`)).size,
    snapshot.entities.length,
  );
  const sourceIds = new Set(snapshot.evidence.map((item) => item.id));
  for (const entries of Object.values(snapshot.timeline)) {
    assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
    for (const entry of entries) for (const id of entry.sourceIds) assert.ok(sourceIds.has(id), id);
  }
  const familyEdges = snapshot.graph.edges.filter((edge) => edge.kind === "part-of");
  assert.equal(
    new Set(familyEdges.map((edge) => `${edge.fromId}|${edge.toId}`)).size,
    familyEdges.length,
  );
});

test("actual demo adapter composes overlays while its exportable baseline stays independent", async () => {
  const { DEMO_KNOWLEDGE_SNAPSHOT, BASE_DEMO_KNOWLEDGE_SNAPSHOT } = await vite.ssrLoadModule(
    "/src/data/demo-adapter.ts",
  );
  assert.deepEqual(BASE_DEMO_KNOWLEDGE_SNAPSHOT, baseline);
  assert.deepEqual(DEMO_KNOWLEDGE_SNAPSHOT, publicCatalogSnapshot(snapshot));
});

test("current representatives use reviewed identity even when release dates are unknown", () => {
  for (const [familyId, lineId, currentId] of [
    ["e-deepseek", "deepseek-flash", "e-deepseek-v41-flash"],
    ["e-doubao", "doubao-pro", "e-doubao-seed21-pro"],
    ["e-ernie", "ernie-open", "e-ernie-45-vl-28b-a3b"],
    ["e-gpt", "gpt-6-1", "e-gpt-61-sol"],
  ]) {
    const versions = snapshot.entities
      .filter((entity) => entity.familyId === familyId)
      .sort((a, b) => (b.firstReleasedAt ?? "").localeCompare(a.firstReleasedAt ?? ""));
    assert.equal(
      groupModelProductLines(versions).find((line) => line.id === lineId).latest.id,
      currentId,
    );
  }
  assert.equal(
    groupModelProductLines(snapshot.entities.filter((e) => e.familyId === "e-gpt"))[0].id,
    "gpt-6-1",
  );
});

test("GPT generations show iteration and keep Terra beside same-generation tiers", () => {
  const lines = groupModelProductLines(
    snapshot.entities.filter((entity) => entity.familyId === "e-gpt"),
  );
  assert.deepEqual(
    lines.slice(0, 12).map((line) => line.name.en),
    [
      "GPT-6.1",
      "GPT-6",
      "GPT-5.6",
      "GPT-5.5",
      "GPT-5.4",
      "GPT-5.3",
      "GPT-5.2",
      "GPT-5.1",
      "GPT-5",
      "GPT-4.5",
      "GPT-4.1",
      "GPT-4o",
    ],
  );
  const generation = lines.find((line) => line.id === "gpt-5-6");
  assert.deepEqual(
    generation.versions.map((version) => version.release.variant),
    ["Sol", "Terra", "Luna"],
  );
  assert.ok(
    generation.versions.every((version) => isCurrentProductLineVersion(generation, version)),
  );
  const terra = generation.versions.find((version) => version.release.variant === "Terra");
  assert.equal(terra.release.generation, "GPT-5.6");
  assert.equal(terra.release.releasedAt, "2026-07-09");
  assert.ok(terra.specs.inputPrice.startsWith("$2 / 1M"));
  assert.ok(lines.some((line) => line.id === "gpt-image"));
  assert.ok(lines.some((line) => line.id === "gpt-realtime"));
});

test("retired and pending records never invent a production channel or release date", () => {
  const byId = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  for (const id of [
    "e-gpt-45",
    "e-claude-4",
    "e-claude-35",
    "e-kimi-k25",
    "e-kimi-k2-thinking",
    "e-deepseek-v4-flash",
  ]) {
    assert.equal(byId.get(id).release.stage, "retired");
    assert.deepEqual(byId.get(id).release.accessChannels, []);
    assert.notEqual(byId.get(id).release.catalogCurrent, true);
  }
  const pending = byId.get("e-deepseek-r2");
  assert.equal(pending.release.stage, "pending");
  assert.equal(pending.release.releasedAt, null);
  assert.equal(pending.firstReleasedAt, null);
  assert.deepEqual(pending.release.apiModelIds, []);
  assert.deepEqual(pending.knowledge.useCases, []);
  assert.equal(pending.specs.contextWindow, null);
  const timeline = snapshot.timeline["e-deepseek"].find((event) => event.id === "t-deepseek-r2");
  assert.equal(timeline.kind, "update");
  assert.equal(timeline.confidence, "unverified");
  assert.equal(byId.get("e-ernie-51").specs.inputPrice, "¥4–6 / 1M tokens · documented API");
  assert.deepEqual(byId.get("e-ernie-51").release.apiModelIds, ["ernie-5.1"]);
  assert.ok(
    byId
      .get("e-ernie-51")
      .knowledge.keyPoints.some((point) => point.sourceIds.includes("s-specs-ernie-api-models")),
  );
  assert.ok(snapshot.changes.every((change) => !frontier.supersededChangeIds.includes(change.id)));
});

test("comparison chooses reviewed general representatives and excludes pending records", async () => {
  const { defaultComparableVersionIds, isComparableModelRelease, resolveComparisonSelection } =
    await vite.ssrLoadModule("/src/lib/comparison-selection.ts");
  const ids = defaultComparableVersionIds(snapshot.entities);
  assert.deepEqual(ids.slice(0, 2), ["e-gpt-61-sol", "e-claude-fable-5-1"]);
  assert.ok(
    snapshot.entities
      .find((entity) => entity.id === ids[2])
      .release.productLine.id.endsWith("-pro"),
  );
  const pending = snapshot.entities.find((entity) => entity.id === "e-deepseek-r2");
  assert.equal(isComparableModelRelease(pending), false);
  assert.deepEqual(resolveComparisonSelection("e-deepseek-r2,e-gpt-56-terra", snapshot.entities), {
    scope: "versions",
    selected: ["e-gpt-56-terra"],
  });
});
