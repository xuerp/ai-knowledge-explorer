import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { graphNeighborhoodPage } = await vite.ssrLoadModule("/src/domain/graph-neighborhood.ts");
const { referenceSectionsForMode } = await vite.ssrLoadModule("/src/domain/reference-reading.ts");
const { knowledgePurpose } = await vite.ssrLoadModule("/src/domain/knowledge-browse.ts");
const { DEMO_KNOWLEDGE_SNAPSHOT: snapshot } = await vite.ssrLoadModule("/src/data/demo-adapter.ts");
const ENTITIES = snapshot.entities;
test.after(async () => vite.close());

test("large graph neighborhoods preserve all neighbors without overflowing any group", () => {
  const ids = ["center", ...Array.from({ length: 51 }, (_, index) => `n${index}`), "n0"];
  for (const capacity of [6, 12]) {
    const first = graphNeighborhoodPage(ids, "center", 0, capacity);
    const seen = [];
    for (let page = 0; page < first.pages; page++) {
      const group = graphNeighborhoodPage(ids, "center", page, capacity);
      assert.equal(group.ids[0], "center");
      assert.ok(group.ids.length <= capacity);
      seen.push(...group.ids.slice(1));
    }
    assert.equal(seen.length, 51);
    assert.equal(new Set(seen).size, 51);
    assert.equal(graphNeighborhoodPage(ids, "center", 999, capacity).page, first.pages - 1);
    assert.deepEqual(graphNeighborhoodPage(["center"], "center", 1, capacity).ids, ["center"]);
  }
});

test("IDE and terminal coding apps share a purpose; office apps and protocols remain distinct", () => {
  for (const id of ["e-cursor", "e-traecode", "e-claude-code", "e-codex", "e-grok-build"]) {
    assert.equal(knowledgePurpose(ENTITIES.find((entity) => entity.id === id)), "coding", id);
  }
  for (const id of ["e-workbuddy", "e-traework", "e-grok-chat"]) {
    assert.equal(knowledgePurpose(ENTITIES.find((entity) => entity.id === id)), "work", id);
  }
  assert.equal(
    knowledgePurpose(ENTITIES.find((entity) => entity.id === "e-mcp")),
    "infrastructure",
  );
});

test("two-hop pages retain the bridge so indirect nodes keep their evidence path", () => {
  const ids = ["center", "bridge", ...Array.from({ length: 23 }, (_, index) => `indirect${index}`)];
  const bridges = new Map(ids.slice(2).map((id) => [id, "bridge"]));
  const first = graphNeighborhoodPage(ids, "center", 0, 6, bridges);
  const seen = new Set();
  for (let page = 0; page < first.pages; page++) {
    const group = graphNeighborhoodPage(ids, "center", page, 6, bridges);
    assert.ok(group.ids.includes("bridge"));
    assert.ok(group.ids.length <= 6);
    group.ids.forEach((id) => seen.add(id));
  }
  assert.deepEqual(seen, new Set(ids));
});

test("reference reading modes retain sources and prioritize adoption versus integration", () => {
  const entity = ENTITIES.find((item) => item.id === "e-grok-build");
  const original = entity.knowledge.sections;
  const general = referenceSectionsForMode(entity, "general");
  const product = referenceSectionsForMode(entity, "product");
  const technical = referenceSectionsForMode(entity, "technical");
  assert.equal(general[0].id, "workflow");
  assert.equal(product[0].id, "adoption");
  assert.equal(technical[0].id, "implementation");
  for (const sections of [general, product, technical])
    assert.deepEqual(new Set(sections), new Set(original));
  assert.equal(original[0].id, "workflow");
});
