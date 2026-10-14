import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { comparisonVersionGroups, filterComparisonGroups, toggleComparisonModel } =
  await vite.ssrLoadModule("/src/lib/comparison-picker.ts");
const { DEMO_KNOWLEDGE_SNAPSHOT } = await vite.ssrLoadModule("/src/data/demo-adapter.ts");
test.after(async () => vite.close());
const release = (id, familyId, line, extra = {}) => ({
  id,
  type: "model",
  familyId,
  name: { zh: `模型 ${id}`, en: `Model ${id}` },
  release: {
    stage: "stable",
    productLine: { id: line, name: { zh: line, en: line } },
    apiModelIds: [id],
    releasedAt: "2026-01-01",
    ...extra,
  },
});
const models = [
  release("new", "a", "main", { catalogCurrent: true }),
  release("old", "a", "main", { catalogCurrent: false }),
  release("preview", "a", "fast", { stage: "preview", catalogCurrent: true }),
  release("pending", "a", "fast", { stage: "pending" }),
  release("rumor", "a", "fast"),
  release("other-family", "b", "main"),
  release("ungrouped", "a", "main", { productLine: undefined }),
];
models.find((model) => model.id === "rumor").status = "rumor";
test("family scope excludes other families and unverified releases without dropping ungrouped models", () => {
  const groups = comparisonVersionGroups(models, "a");
  assert.deepEqual(groups.flatMap((line) => line.versions.map(({ model }) => model.id)).sort(), [
    "new",
    "old",
    "preview",
    "ungrouped",
  ]);
});
test("history is opt-in; active preview and current models remain selectable", () => {
  const groups = comparisonVersionGroups(models, "a");
  assert.deepEqual(
    filterComparisonGroups(groups, {})
      .flatMap((line) => line.versions.map(({ model }) => model.id))
      .sort(),
    ["new", "preview", "ungrouped"],
  );
  assert.equal(
    filterComparisonGroups(groups, { includeHistory: true }).flatMap((line) => line.versions)
      .length,
    4,
  );
});
test("line and multilingual/API search intersect; unmatched results remain empty", () => {
  const groups = comparisonVersionGroups(models, "a");
  assert.equal(
    filterComparisonGroups(groups, { lineId: "fast", query: "PREVIEW" })[0].versions[0].model.id,
    "preview",
  );
  assert.equal(
    filterComparisonGroups(groups, { query: "模型 new" })[0].versions[0].model.id,
    "new",
  );
  assert.deepEqual(filterComparisonGroups(groups, { query: "does-not-exist" }), []);
  assert.equal(
    filterComparisonGroups(groups, { query: "old", includeHistory: true })[0].versions[0].model.id,
    "old",
  );
});
test("cross-family selections preserve order and limit; a selected model can always be removed", () => {
  let selected = ["a", "b", "c"];
  selected = toggleComparisonModel(selected, "d");
  assert.deepEqual(selected, ["a", "b", "c", "d"]);
  assert.deepEqual(toggleComparisonModel(selected, "e"), selected);
  assert.deepEqual(toggleComparisonModel(selected, "b"), ["a", "c", "d"]);
});
test("every reviewed catalog release belongs to a selectable family group, including historical records", () => {
  const catalog = DEMO_KNOWLEDGE_SNAPSHOT.entities;
  for (const family of catalog.filter((model) => model.type === "model" && !model.familyId)) {
    const expected = catalog
      .filter(
        (model) =>
          model.familyId === family.id &&
          model.release?.stage !== "pending" &&
          model.status !== "rumor",
      )
      .map((model) => model.id)
      .sort();
    const actual = filterComparisonGroups(comparisonVersionGroups(catalog, family.id), {
      includeHistory: true,
    })
      .flatMap((line) => line.versions.map(({ model }) => model.id))
      .sort();
    assert.deepEqual(actual, expected, family.id);
  }
});
