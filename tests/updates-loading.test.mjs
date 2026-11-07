import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { createKnowledgeRepository } = await vite.ssrLoadModule(
  "/src/services/knowledge-repository.ts",
);
const { projectUpdatesOverview } = await vite.ssrLoadModule("/src/domain/updates-overview.ts");
const { updatesQueryOptions } = await vite.ssrLoadModule("/src/domain/updates-sync.ts");
const snapshot = JSON.parse(await readFile("src/data/generated/snapshot.json", "utf8"));
const feed = projectUpdatesOverview(snapshot);
test.after(() => vite.close());

test("updates transfers no unrelated graph/claims and preserves every filter, event and linked source", () => {
  assert.deepEqual(feed.changes, snapshot.changes);
  assert.deepEqual(
    feed.entities.map((e) => e.id),
    snapshot.entities.map((e) => e.id),
  );
  assert.ok(feed.entities.every((e) => !e.knowledge && !e.specs));
  const expectedIds = new Set(snapshot.changes.flatMap((c) => c.sourceIds ?? []));
  assert.deepEqual(
    feed.evidence.map((e) => e.id),
    snapshot.evidence.filter((e) => expectedIds.has(e.id)).map((e) => e.id),
  );
  assert.ok(!("claims" in feed) && !("graph" in feed) && !("notifications" in feed));
  assert.ok(
    Buffer.byteLength(JSON.stringify(feed)) < Buffer.byteLength(JSON.stringify(snapshot)) * 0.25,
  );
  assert.ok(
    snapshot.entities.some((e) => e.specs),
    "projection must not mutate the original catalog",
  );
});

test("live updates uses the lean endpoint and only a 404 permits same-API compatibility", async () => {
  const savedFetch = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return Response.json(feed);
    };
    const repository = createKnowledgeRepository("https://api.example");
    assert.deepEqual(await repository.getUpdatesOverview(), feed);
    assert.deepEqual(urls.splice(0), ["https://api.example/api/v2/updates"]);
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return String(url).endsWith("/updates")
        ? new Response(null, { status: 404 })
        : Response.json(snapshot);
    };
    assert.deepEqual(await repository.getUpdatesOverview(), feed);
    assert.deepEqual(urls.splice(0), [
      "https://api.example/api/v2/updates",
      "https://api.example/api/v2/snapshot",
    ]);
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(null, { status: 403 });
    };
    await assert.rejects(repository.getUpdatesOverview(), /403/);
    assert.deepEqual(urls, ["https://api.example/api/v2/updates"]);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("navigation reuses a successful feed immediately and a failed refresh retains it", async () => {
  const client = new QueryClient();
  let calls = 0;
  const options = updatesQueryOptions({
    getUpdatesOverview: async () => {
      calls++;
      return feed;
    },
  });
  await client.fetchQuery(options);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  assert.deepEqual(observer.getCurrentResult().data, feed);
  assert.equal(observer.getCurrentResult().isPending, false);
  assert.equal(calls, 1);
  assert.equal(options.gcTime, 1_800_000);
  assert.equal(options.refetchInterval, 300_000);
  try {
    await assert.rejects(
      client.fetchQuery({
        ...options,
        staleTime: 0,
        retry: false,
        queryFn: async () => {
          throw new Error("offline");
        },
      }),
      /offline/,
    );
    assert.deepEqual(client.getQueryData(options.queryKey), feed);
  } finally {
    unsubscribe();
    client.clear();
  }
});
