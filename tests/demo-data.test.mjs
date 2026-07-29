import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  server: { middlewareMode: true },
});

const { CLAIMS, ENTITIES, FOLLOWING, RECENT_CHANGES, RELATIONS, SOURCES, TIMELINE } =
  await vite.ssrLoadModule("/src/lib/demo-data.ts");
const { DEMO_KNOWLEDGE_SNAPSHOT } = await vite.ssrLoadModule("/src/data/demo-adapter.ts");
const { knowledgeRepository } = await vite.ssrLoadModule("/src/services/knowledge-repository.ts");
const { expandNeighborhood, filterGraphEdges, findShortestPath } =
  await vite.ssrLoadModule("/src/domain/graph.ts");

after(async () => {
  await vite.close();
});

function assertUniqueIds(items, label) {
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique`);
}

test("demo fixture IDs are unique", () => {
  assertUniqueIds(ENTITIES, "entity");
  assertUniqueIds(SOURCES, "source");
  assertUniqueIds(CLAIMS, "claim");
  assertUniqueIds(RELATIONS, "relation");
  assertUniqueIds(RECENT_CHANGES, "change");
});

test("all graph and preference references resolve", () => {
  const entityIds = new Set(ENTITIES.map((entity) => entity.id));
  const sourceIds = new Set(SOURCES.map((source) => source.id));

  for (const relation of RELATIONS) {
    assert.ok(entityIds.has(relation.fromId), `missing relation source ${relation.fromId}`);
    assert.ok(entityIds.has(relation.toId), `missing relation target ${relation.toId}`);
    relation.sourceIds.forEach((id) => assert.ok(sourceIds.has(id), `missing source ${id}`));
  }

  for (const claim of CLAIMS) {
    assert.ok(claim.sourceIds.length > 0, `claim ${claim.id} must have evidence`);
    claim.sourceIds.forEach((id) => assert.ok(sourceIds.has(id), `missing source ${id}`));
  }

  for (const change of RECENT_CHANGES) {
    assert.ok(entityIds.has(change.entityId), `missing changed entity ${change.entityId}`);
  }

  for (const follow of FOLLOWING) {
    assert.ok(entityIds.has(follow.entityId), `missing followed entity ${follow.entityId}`);
  }

  for (const entries of Object.values(TIMELINE)) {
    for (const entry of entries) {
      entry.sourceIds.forEach((id) => assert.ok(sourceIds.has(id), `missing source ${id}`));
    }
  }
});

test("concrete model versions are extensible and linked to a valid family", () => {
  const entityById = new Map(ENTITIES.map((entity) => [entity.id, entity]));
  const versions = ENTITIES.filter((entity) => entity.familyId);

  assert.ok(versions.length >= 12, "demo catalog should cover multiple model families");

  for (const version of versions) {
    const family = entityById.get(version.familyId);
    assert.ok(family, `${version.id} references missing family ${version.familyId}`);
    assert.equal(version.type, "model", `${version.id} must be a model`);
    assert.equal(family.type, "model", `${version.familyId} must be a model family`);
    assert.ok(version.specs, `${version.id} must include version-level specs`);
    assert.ok(version.firstReleasedAt, `${version.id} must include a release date`);
    assert.ok(
      RELATIONS.some(
        (relation) =>
          relation.kind === "part-of" &&
          relation.fromId === version.id &&
          relation.toId === version.familyId,
      ),
      `${version.id} must have a part-of relation to ${version.familyId}`,
    );
  }
});

test("repository exposes family, version, timeline, and comparison queries", async () => {
  const families = await knowledgeRepository.getModelFamilies();
  assert.ok(families.some((entity) => entity.id === "e-qwen"));

  const qwenVersions = await knowledgeRepository.getFamilyVersions("e-qwen");
  assert.deepEqual(
    qwenVersions.map((entity) => entity.id),
    ["e-qwen-25-max", "e-qwen-3-max"],
  );

  const detail = await knowledgeRepository.getEntityBySlug("qwen-3-max", "model");
  assert.equal(detail?.familyId, "e-qwen");
  assert.ok(detail?.specs?.contextWindow);

  const timeline = await knowledgeRepository.getEntityTimeline("e-qwen-3-max");
  assert.equal(timeline.length, 1);

  const comparison = await knowledgeRepository.compareModelVersions(["e-gpt-5", "e-qwen-3-max"]);
  assert.deepEqual(
    comparison.map((entity) => entity.id),
    ["e-gpt-5", "e-qwen-3-max"],
  );
});

test("evidence carries provenance timestamps and safe links", () => {
  for (const source of SOURCES) {
    assert.match(source.url, /^https:\/\//, `${source.id} must use HTTPS`);
    assert.match(source.publishedAt, /^\d{4}-\d{2}-\d{2}$/, `${source.id} publishedAt`);
    assert.match(source.collectedAt, /^\d{4}-\d{2}-\d{2}$/, `${source.id} collectedAt`);
    if (source.verifiedAt) {
      assert.match(source.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${source.id} verifiedAt`);
    }
  }
});

test("every non-model knowledge entry has useful editorial content and evidence", () => {
  const sourceIds = new Set(SOURCES.map((source) => source.id));
  const nonModels = ENTITIES.filter((entity) => entity.type !== "model");

  assert.ok(nonModels.length >= 8);
  for (const entity of nonModels) {
    assert.ok(entity.knowledge, `${entity.id} must include a knowledge article`);
    assert.ok(entity.knowledge.introduction.length >= 2, `${entity.id} needs a real introduction`);
    assert.ok(entity.knowledge.keyPoints.length >= 3, `${entity.id} needs key facts`);
    assert.ok(entity.knowledge.useCases.length >= 3, `${entity.id} needs practical uses`);
    assert.ok(entity.knowledge.limitations.length >= 2, `${entity.id} needs limitations`);
    assert.match(entity.knowledge.officialUrl, /^https:\/\//, `${entity.id} needs an official URL`);
    for (const point of entity.knowledge.keyPoints) {
      assert.ok(point.sourceIds?.length, `${entity.id} key points must cite evidence`);
      point.sourceIds.forEach((id) =>
        assert.ok(sourceIds.has(id), `${entity.id} references missing source ${id}`),
      );
    }
  }
});

test("every top-level model family has a useful guide with direct evidence", () => {
  const sourceIds = new Set(SOURCES.map((source) => source.id));
  const families = ENTITIES.filter((entity) => entity.type === "model" && !entity.familyId);

  assert.equal(families.length, 8);
  for (const entity of families) {
    assert.ok(entity.knowledge, `${entity.id} must include a model-family guide`);
    assert.ok(entity.knowledge.introduction.length >= 2, `${entity.id} needs an introduction`);
    assert.ok(entity.knowledge.keyPoints.length >= 3, `${entity.id} needs key facts`);
    assert.ok(entity.knowledge.useCases.length >= 3, `${entity.id} needs use cases`);
    assert.ok(entity.knowledge.limitations.length >= 3, `${entity.id} needs decision limits`);
    assert.match(entity.knowledge.officialUrl, /^https:\/\//, `${entity.id} needs an official URL`);
    const citedPoints = entity.knowledge.keyPoints.filter((point) => point.sourceIds?.length);
    assert.ok(citedPoints.length >= 1, `${entity.id} needs directly cited key facts`);
    citedPoints
      .flatMap((point) => point.sourceIds)
      .forEach((id) => {
        assert.ok(sourceIds.has(id), `${entity.id} references missing source ${id}`);
      });
  }
});

test("the demo adapter exposes a complete, explicitly labelled snapshot", () => {
  assert.equal(DEMO_KNOWLEDGE_SNAPSHOT.meta.mode, "demo");
  assert.ok(DEMO_KNOWLEDGE_SNAPSHOT.researchQuestions.length >= 3);
  assert.ok(DEMO_KNOWLEDGE_SNAPSHOT.interestProfile.length >= 3);
  assert.equal(DEMO_KNOWLEDGE_SNAPSHOT.graph.nodes.length, ENTITIES.length);
  assert.equal(DEMO_KNOWLEDGE_SNAPSHOT.graph.edges.length, RELATIONS.length);
});

test("graph filters support explicit empty and combined selections", () => {
  assert.deepEqual(
    filterGraphEdges(RELATIONS, { relationKinds: new Set() }),
    [],
    "an empty selected relation set must hide every edge",
  );

  const verifiedDevelopers = filterGraphEdges(RELATIONS, {
    relationKinds: new Set(["developed-by"]),
    confidences: new Set(["verified"]),
  });
  assert.ok(verifiedDevelopers.length > 0);
  assert.ok(
    verifiedDevelopers.every(
      (edge) => edge.kind === "developed-by" && edge.confidence === "verified",
    ),
  );
});

test("graph neighborhoods expand one layer at a time", () => {
  const edges = [
    {
      id: "a-b",
      fromId: "a",
      toId: "b",
      kind: "uses",
      confidence: "verified",
      sourceIds: [],
    },
    {
      id: "b-c",
      fromId: "b",
      toId: "c",
      kind: "uses",
      confidence: "verified",
      sourceIds: [],
    },
    {
      id: "c-d",
      fromId: "c",
      toId: "d",
      kind: "uses",
      confidence: "verified",
      sourceIds: [],
    },
  ];

  assert.deepEqual([...expandNeighborhood(edges, "a", 1)].sort(), ["a", "b"]);
  assert.deepEqual([...expandNeighborhood(edges, "a", 2)].sort(), ["a", "b", "c"]);
});

test("shortest path returns ordered nodes and edges, or null when disconnected", () => {
  const edges = [
    {
      id: "a-b",
      fromId: "a",
      toId: "b",
      kind: "uses",
      confidence: "verified",
      sourceIds: [],
    },
    {
      id: "b-c",
      fromId: "b",
      toId: "c",
      kind: "uses",
      confidence: "verified",
      sourceIds: [],
    },
    {
      id: "a-d",
      fromId: "a",
      toId: "d",
      kind: "uses",
      confidence: "verified",
      sourceIds: [],
    },
  ];

  assert.deepEqual(findShortestPath(edges, "a", "c"), {
    nodeIds: ["a", "b", "c"],
    edgeIds: ["a-b", "b-c"],
  });
  assert.equal(findShortestPath(edges, "a", "missing"), null);
});

test("PWA manifest and service worker expose an offline application shell", async () => {
  const manifest = JSON.parse(
    await readFile(path.resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
  );
  const serviceWorker = await readFile(path.resolve(process.cwd(), "public/sw.js"), "utf8");
  const offlinePage = await readFile(path.resolve(process.cwd(), "public/offline.html"), "utf8");

  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.length > 0);
  assert.match(serviceWorker, /offline\.html/);
  assert.match(serviceWorker, /caches\.open/);
  assert.match(offlinePage, /最后在线缓存/);
});

test("notification preferences stay local and do not imply delivery", async () => {
  const source = await readFile(path.resolve(process.cwd(), "src/lib/personalization.ts"), "utf8");
  const followingRoute = await readFile(
    path.resolve(process.cwd(), "src/routes/following.tsx"),
    "utf8",
  );

  assert.match(source, /ai-radar\.notification-preferences\.v1/);
  assert.match(source, /readNotificationIds/);
  assert.match(followingRoute, /邮件投递服务尚未接入/);
  assert.match(followingRoute, /markAllNotificationsRead/);
});
