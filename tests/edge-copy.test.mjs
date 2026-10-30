import assert from "node:assert/strict";
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
const { snapshotFetchedAtHeader, staleSnapshotCopyAge, staleSnapshotCopyMs } =
  await vite.ssrLoadModule("/src/lib/edge-copy.ts");

test.after(async () => vite.close());

const body = {
  meta: { mode: "demo", freshness: "cached", retrievedAt: "2026-10-30T13:09:20Z", cachedAt: null },
  entities: [],
};

async function snapshotWith(headers) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(body, { headers });
  try {
    return await createKnowledgeRepository("https://frontend.example/backend").getSnapshot();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("边缘缓存副本的回源时间写入 meta.cachedAt，响应体时间保持不变", async () => {
  const snapshot = await snapshotWith({ [snapshotFetchedAtHeader]: "2026-10-30T10:00:00.000Z" });
  assert.equal(snapshot.meta.cachedAt, "2026-10-30T10:00:00.000Z");
  assert.equal(snapshot.meta.retrievedAt, "2026-10-30T13:09:20Z");
});

test("直连 API 或无效时间头不伪造缓存时间", async () => {
  assert.equal((await snapshotWith({})).meta.cachedAt, null);
  assert.equal((await snapshotWith({ [snapshotFetchedAtHeader]: "soon" })).meta.cachedAt, null);
});

test("缓存副本超过一小时才提示", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(staleSnapshotCopyAge(at(staleSnapshotCopyMs - 1), now), null);
  assert.equal(staleSnapshotCopyAge(at(staleSnapshotCopyMs), now), staleSnapshotCopyMs);
  assert.equal(staleSnapshotCopyAge(undefined, now), null);
  assert.equal(staleSnapshotCopyAge(null, now), null);
  assert.equal(staleSnapshotCopyAge("not a date", now), null);
});
