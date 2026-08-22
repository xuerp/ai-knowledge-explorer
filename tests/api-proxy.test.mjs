import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { proxyApiRequest, resolveApiUpstream, withNoStoreHtmlResponse } =
  await vite.ssrLoadModule("/src/server.ts");

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
