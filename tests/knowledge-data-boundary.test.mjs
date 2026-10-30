import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { createKnowledgeRepository } = await vite.ssrLoadModule(
  "/src/services/knowledge-repository.ts",
);

test("API failure stays an error and never substitutes offline claims", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response("Forbidden", { status: 403 });
  };
  try {
    const repository = createKnowledgeRepository("https://api.example.test/");
    assert.equal(repository.mode, "live");
    await assert.rejects(repository.getSnapshot(), /status 403/);
    assert.deepEqual(requested, ["https://api.example.test/api/v2/snapshot"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit offline mode loads the full public projection without a network API", async () => {
  const expected = JSON.parse(await readFile("src/data/generated/snapshot.json", "utf8"));
  const repository = createKnowledgeRepository();
  assert.equal(repository.mode, "demo");
  const actual = await repository.getSnapshot();
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.researchAnswers, []);
  assert.deepEqual(actual.following, []);
  const entities = await repository.getEntities({ type: "model" });
  assert.deepEqual(
    entities,
    actual.entities.filter((entity) => entity.type === "model"),
  );
});

test.after(() => vite.close());
