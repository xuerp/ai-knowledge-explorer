import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const {
  proxyApiRequest,
  publicSnapshotCacheControl,
  publicSnapshotCacheTag,
  privateNoStoreCacheControl,
  purgePublicSnapshotAfterAdminWrite,
  resolveApiUpstream,
  withSsrCachePolicy,
} = await vite.ssrLoadModule("/src/server.ts");
const { snapshotFetchedAtHeader } = await vite.ssrLoadModule("/src/lib/snapshot-cache.ts");

const snapshotUrl = "https://frontend.example/backend/api/v2/snapshot";
const proxy = (request, response) =>
  proxyApiRequest(request, "https://api.example", async () =>
    typeof response === "function" ? response() : response,
  );

test.after(async () => vite.close());

test("Cloudflare Worker 优先使用运行时 API 上游变量", () => {
  assert.equal(
    resolveApiUpstream({ AI_RADAR_API_UPSTREAM_URL: "https://runtime.example/" }),
    "https://runtime.example",
  );
});

test("Cloudflare 同域代理保留 API 路径、查询、鉴权与请求体", async () => {
  let forwarded;
  const response = await proxyApiRequest(
    new Request("https://frontend.example/backend/api/v2/review?limit=5", {
      method: "POST",
      headers: { Authorization: "Bearer safe-token", "Content-Type": "application/json" },
      body: '{"action":"approve"}',
    }),
    "https://api.example",
    async (request) => {
      forwarded = request;
      return Response.json({ ok: true });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "https://api.example/api/v2/review?limit=5");
  assert.equal(forwarded.method, "POST");
  assert.equal(forwarded.headers.get("authorization"), "Bearer safe-token");
  assert.equal(await forwarded.text(), '{"action":"approve"}');
});

test("Cloudflare 管理接口响应禁止缓存", async () => {
  const response = await proxyApiRequest(
    new Request("https://frontend.example/backend/api/v2/admin/review-queue"),
    "https://api.example",
    async () => Response.json([{ id: "review-1" }]),
  );

  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, no-cache, must-revalidate",
  );
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("Cloudflare 同域代理不会接管普通页面路由", async () => {
  const response = await proxyApiRequest(
    new Request("https://frontend.example/admin/review"),
    "https://api.example",
  );
  assert.equal(response, null);
});

test("Cloudflare 页面响应禁止复用旧部署的 HTML", async () => {
  const response = withSsrCachePolicy(
    new Response("<html></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  );
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, no-cache, must-revalidate",
  );
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("匿名公开快照可在边缘共享缓存，并标注回源时间", async () => {
  const before = Date.now();
  const response = await proxy(
    new Request(snapshotUrl),
    Response.json({ meta: {} }, { headers: { "Set-Cookie": "a=b", Pragma: "no-cache" } }),
  );

  assert.equal(response.headers.get("cache-control"), publicSnapshotCacheControl);
  assert.match(publicSnapshotCacheControl, /^public, max-age=300, stale-while-revalidate=604800$/);
  assert.equal(response.headers.get("cache-tag"), publicSnapshotCacheTag);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("pragma"), null);
  const fetchedAt = Date.parse(response.headers.get(snapshotFetchedAtHeader));
  assert.ok(fetchedAt >= before && fetchedAt <= Date.now());
});

test("带身份、带查询或失败的快照响应不进入共享缓存", async () => {
  const cases = [
    [new Request(snapshotUrl, { headers: { Authorization: "Bearer t" } }), Response.json({})],
    [new Request(`${snapshotUrl}?lang=en`), Response.json({})],
    [new Request(snapshotUrl), new Response("busy", { status: 503 })],
    [new Request(snapshotUrl, { method: "POST" }), Response.json({})],
  ];
  for (const [request, upstream] of cases) {
    const response = await proxy(request, upstream);
    assert.equal(response.headers.get("cache-control"), privateNoStoreCacheControl);
    assert.equal(response.headers.get("cache-tag"), null);
    assert.equal(response.headers.get(snapshotFetchedAtHeader), null);
  }
});

test("其他 API、代理错误与未配置上游一律禁止缓存", async () => {
  const entities = await proxy(
    new Request("https://frontend.example/backend/api/v2/entities?type=model"),
    Response.json([]),
  );
  assert.equal(entities.headers.get("cache-control"), privateNoStoreCacheControl);

  const unreachable = await proxy(new Request(snapshotUrl), () => {
    throw new Error("cold start");
  });
  assert.equal(unreachable.status, 502);
  assert.equal(unreachable.headers.get("cache-control"), privateNoStoreCacheControl);

  const unconfigured = await proxyApiRequest(new Request(snapshotUrl), "");
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.headers.get("cache-control"), privateNoStoreCacheControl);
});

test("没有缓存头的非 HTML 页面响应默认私有，已声明的缓存头保持不变", () => {
  const json = withSsrCachePolicy(Response.json({ ok: true }));
  assert.equal(json.headers.get("cache-control"), privateNoStoreCacheControl);

  const declared = withSsrCachePolicy(
    new Response("x", { headers: { "Cache-Control": "public, max-age=31536000, immutable" } }),
  );
  assert.equal(declared.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("管理端写入成功后清除快照缓存，其余请求不清除", async () => {
  const purged = [];
  const waited = [];
  const ctx = {
    waitUntil: (promise) => waited.push(promise),
    cache: { purge: async (options) => purged.push(options) },
  };
  const admin = "https://frontend.example/backend/api/v2/admin/review-queue/r1/approve";
  const ok = new Response(null, { status: 200 });

  assert.equal(
    purgePublicSnapshotAfterAdminWrite(new Request(admin, { method: "POST" }), ok, ctx),
    true,
  );
  await Promise.all(waited);
  assert.deepEqual(purged, [{ tags: [publicSnapshotCacheTag] }]);

  const skipped = [
    [new Request(admin), ok],
    [new Request(admin, { method: "POST" }), new Response(null, { status: 409 })],
    [new Request("https://frontend.example/backend/api/v2/research", { method: "POST" }), ok],
  ];
  for (const [request, response] of skipped) {
    assert.equal(purgePublicSnapshotAfterAdminWrite(request, response, ctx), false);
  }
  assert.equal(purged.length, 1);

  // Outside Cloudflare, or where purge is unavailable, the 5-minute freshness applies.
  assert.equal(
    purgePublicSnapshotAfterAdminWrite(new Request(admin, { method: "POST" }), ok),
    false,
  );
  assert.equal(
    purgePublicSnapshotAfterAdminWrite(new Request(admin, { method: "POST" }), ok, { cache: {} }),
    false,
  );
});

test("清除缓存失败只记录日志，不影响已完成的管理操作", async () => {
  const waited = [];
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const started = purgePublicSnapshotAfterAdminWrite(
      new Request("https://frontend.example/backend/api/v2/admin/relations", { method: "POST" }),
      new Response(null, { status: 201 }),
      {
        waitUntil: (promise) => waited.push(promise),
        cache: { purge: async () => Promise.reject(new Error("unavailable")) },
      },
    );
    assert.equal(started, true);
    await Promise.all(waited);
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalError;
  }
});
