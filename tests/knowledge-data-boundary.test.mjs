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
const { projectHomeOverview } = await vite.ssrLoadModule("/src/domain/home-overview.ts");

test("homepage loads the small live endpoint without requesting a full snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const expected = { marker: "small public response" };
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return Response.json(expected);
  };
  try {
    const repository = createKnowledgeRepository("https://api.example.test");
    assert.deepEqual(await repository.getHomeOverview(), expected);
    assert.deepEqual(requested, ["https://api.example.test/api/v2/home"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("homepage API rejection never substitutes an offline catalog", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response("Forbidden", { status: 403 });
  };
  try {
    await assert.rejects(
      createKnowledgeRepository("https://api.example.test").getHomeOverview(),
      /403/,
    );
    assert.deepEqual(requested, ["https://api.example.test/api/v2/home"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("older API compatibility projects its real full response only after a 404", async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = JSON.parse(await readFile("src/data/generated/snapshot.json", "utf8"));
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return String(url).endsWith("/home")
      ? new Response("Not found", { status: 404 })
      : Response.json(snapshot);
  };
  try {
    const actual = await createKnowledgeRepository("https://api.example.test").getHomeOverview();
    assert.deepEqual(actual, projectHomeOverview(snapshot));
    assert.deepEqual(requested, [
      "https://api.example.test/api/v2/home",
      "https://api.example.test/api/v2/snapshot",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
