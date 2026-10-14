import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { catalogRelationships, familyEntityId, graphEntryEntities } = await vite.ssrLoadModule(
  "/src/domain/relationship-catalog.ts",
);
const { connectionPath, connectionPaths } = await vite.ssrLoadModule(
  "/src/domain/relationship-insights.ts",
);
const { DEMO_KNOWLEDGE_SNAPSHOT: snapshot } = await vite.ssrLoadModule("/src/data/demo-adapter.ts");
test.after(() => vite.close());
test("entry choices contain one entity per family and keep non-models discoverable", () => {
  const entries = graphEntryEntities(snapshot.entities);
  assert.equal(entries.filter((e) => e.type === "model").length, 13);
  assert.ok(entries.every((e) => !e.familyId));
  assert.equal(
    entries.filter((e) => e.type !== "model").length,
    snapshot.entities.filter((e) => e.type !== "model").length,
  );
  const version = snapshot.entities.find((e) => e.familyId === "e-claude");
  assert.equal(familyEntityId(snapshot.entities, version.id), "e-claude");
});
test("catalog removes rival and archive clutter without modifying authoritative records", () => {
  const original = structuredClone(snapshot);
  const edges = catalogRelationships(snapshot);
  assert.ok(edges.length > 0);
  assert.ok(
    edges.every((e) => e.fromId !== e.toId && !["competes-with", "successor-of"].includes(e.kind)),
  );
  assert.ok(edges.every((e) => e.records.length && e.sourceIds.length));
  assert.deepEqual(snapshot, original);
  assert.ok(edges.some((e) => e.kind === "uses" && e.toId === "e-gpt"));
});
test("version aggregation preserves exact scope, evidence and mixed verification states", () => {
  const copy = structuredClone(snapshot);
  const versions = copy.entities.filter((e) => e.familyId === "e-claude").slice(0, 2);
  const template = copy.graph.edges.find((e) => e.kind === "uses" && e.fromId === "e-claude-code");
  copy.graph.edges = [
    { ...template, id: "v1", toId: versions[0].id },
    { ...template, id: "v2", toId: versions[1].id },
    { ...template, id: "pending", toId: versions[0].id, confidence: "unverified" },
    { ...template, id: "invalid", toId: "missing" },
  ];
  const edges = catalogRelationships(copy);
  assert.equal(edges.length, 2);
  const verified = edges.find((e) => e.confidence === "verified");
  assert.equal(verified.toId, "e-claude");
  assert.deepEqual(
    verified.records.map((e) => e.toId),
    versions.map((e) => e.id),
  );
  assert.equal(verified.records.length, 2);
  assert.ok(edges.every((e) => !e.records.some((r) => r.id === "invalid")));
  assert.equal(catalogRelationships(copy, { confidence: "verified" }).length, 1);
});
test("paths need real non-rival evidence and handle sparse catalogs honestly", () => {
  const edges = catalogRelationships(snapshot);
  assert.deepEqual(
    connectionPaths(graphEntryEntities(snapshot.entities), edges, "e-claude", "e-claude"),
    [],
  );
  assert.equal(
    connectionPath(graphEntryEntities(snapshot.entities), edges, "e-gpt", "e-claude").path?.edgeIds
      .length > 1,
    true,
  );
  assert.equal(
    connectionPath(
      graphEntryEntities(snapshot.entities),
      edges.filter((e) => e.kind === "developed-by"),
      "e-gpt",
      "e-claude",
    ).path,
    null,
  );
  const copy = structuredClone(snapshot);
  copy.evidence = [];
  assert.deepEqual(catalogRelationships(copy), []);
  assert.ok(catalogRelationships(copy, { linkedOnly: false }).length > 0);
});
