import assert from "node:assert/strict";
import path from "node:path";
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

test("the demo adapter exposes a complete, explicitly labelled snapshot", () => {
  assert.equal(DEMO_KNOWLEDGE_SNAPSHOT.meta.mode, "demo");
  assert.ok(DEMO_KNOWLEDGE_SNAPSHOT.researchQuestions.length >= 3);
  assert.ok(DEMO_KNOWLEDGE_SNAPSHOT.interestProfile.length >= 3);
  assert.equal(DEMO_KNOWLEDGE_SNAPSHOT.graph.nodes.length, ENTITIES.length);
  assert.equal(DEMO_KNOWLEDGE_SNAPSHOT.graph.edges.length, RELATIONS.length);
});
