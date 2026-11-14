import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { proxyApiRequest, redirectLegacyPage, resolveApiUpstream, withNoStoreHtmlResponse } =
  await vite.ssrLoadModule("/src/server.ts");

test.after(async () => vite.close());

test("old page links keep their path and query on the public domain", () => {
  for (const hostname of [
    "ai-radar.xue-ai.workers.dev",
    "ai-radar-staging.1966761779.workers.dev",
  ]) {
    const request = new Request(`https://${hostname}/share/example?lang=zh`, { method: "HEAD" });
    const response = redirectLegacyPage(request);
    assert.equal(response.status, 308);
    assert.equal(
      response.headers.get("location"),
      "https://airadar.rainza.cn/share/example?lang=zh",
    );
  }
});

test("the old origin keeps serving existing API clients, assets and version checks", () => {
  for (const path of ["/backend", "/backend/ready", "/sw.js", "/version.txt"]) {
    assert.equal(
      redirectLegacyPage(new Request(`https://ai-radar.xue-ai.workers.dev${path}`)),
      null,
    );
  }
  assert.equal(redirectLegacyPage(new Request("https://airadar.rainza.cn/updates")), null);
  const post = new Request("https://ai-radar.xue-ai.workers.dev/updates", { method: "POST" });
  assert.equal(redirectLegacyPage(post), null);
});

test("only successful anonymous updates feeds share the 60-second edge cache", async () => {
  const stored = new Map();
  let originCalls = 0;
  const cache = {
    match: async (key) => stored.get(key.url)?.clone(),
    put: async (key, value) => {
      stored.set(key.url, value);
    },
  };
  const read = (headers = {}, path = "/api/v2/updates", status = 200) =>
    proxyApiRequest(
      new Request(`https://frontend.example/backend${path}`, { headers }),
      "https://api.example",
      async () => {
        originCalls++;
        return Response.json({ version: originCalls }, { status });
      },
      cache,
    );
  assert.deepEqual(await (await read()).json(), { version: 1 });
  assert.deepEqual(await (await read()).json(), { version: 1 });
  assert.equal(originCalls, 1);
  assert.equal(
    stored.values().next().value.headers.get("cache-control"),
    "public, max-age=60, s-maxage=60",
  );
  await read({ Authorization: "Bearer test" });
  await read({ Cookie: "session=test" });
  await read({}, "/api/v2/admin/review-queue");
  await read({}, "/api/v2/updates?private=1");
  assert.equal(originCalls, 5);
  assert.equal(stored.size, 1);
  stored.clear();
  await read({}, "/api/v2/updates", 503);
  assert.equal(stored.size, 0);
  await read();
  assert.equal(originCalls, 7);
});

test("cache outages cannot hide a healthy public feed", async () => {
  const response = await proxyApiRequest(
    new Request("https://frontend.example/backend/api/v2/updates"),
    "https://api.example",
    async () => Response.json({ ok: true }),
    {
      match: async () => {
        throw new Error("unavailable");
      },
      put: async () => {
        throw new Error("unavailable");
      },
    },
  );
  assert.deepEqual(await response.json(), { ok: true });
});

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

  assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
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
  const response = withNoStoreHtmlResponse(
    new Response("<html></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  );
  assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(response.headers.get("pragma"), "no-cache");
});
