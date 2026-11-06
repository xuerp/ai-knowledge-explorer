import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

const read = (path) => readFile(path, "utf8");
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
test.after(() => vite.close());

test("homepage payload is the dated public catalog projection, without private records", async () => {
  const { projectHomeOverview } = await vite.ssrLoadModule("/src/domain/home-overview.ts");
  const snapshot = JSON.parse(await read("src/data/generated/snapshot.json"));
  const home = JSON.parse(await read("src/data/generated/home-overview.json"));
  assert.deepEqual(home, JSON.parse(JSON.stringify(projectHomeOverview(snapshot))));
  assert.equal(home.meta.retrievedAt, snapshot.meta.retrievedAt);
  assert.ok(home.changes.length > 0);
  assert.ok(home.featuredRelations.length > 0);
  assert.ok(home.entities.length < snapshot.entities.length);
  assert.ok(!("researchAnswers" in home));
  assert.ok(!("following" in home));
});

test("showcase keeps its initial data while syncing; product API failures retain their error boundary", async () => {
  const home = await read("src/routes/index.tsx");
  const hook = await read("src/hooks/use-home-overview.ts");
  assert.match(hook, /@\/data\/generated\/home-overview\.json/);
  assert.match(hook, /homeOverviewQueryOptions/);
  assert.doesNotMatch(home, /if \(!overview|正在连接知识服务/);
  assert.match(home, /自动同步暂未成功，当前内容仍可浏览/);
  assert.match(home, /<TopNav variant="showcase"/);
  assert.equal((home.match(/体验决策助手/g) ?? []).length, 2);
  const { createKnowledgeRepository } = await vite.ssrLoadModule(
    "/src/services/knowledge-repository.ts",
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  try {
    await assert.rejects(
      createKnowledgeRepository("https://api.example.test").getHomeOverview(),
      /503/,
    );
    await assert.rejects(
      createKnowledgeRepository("https://api.example.test").getSnapshot(),
      /503/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
