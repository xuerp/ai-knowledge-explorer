import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { fetchWithNetworkRetry } = await vite.ssrLoadModule("/src/services/fetch-with-retry.ts");

test.after(async () => vite.close());

test("只读请求在瞬时网络失败后有限重试", async () => {
  let calls = 0;
  const response = await fetchWithNetworkRetry(
    "https://api.example/health",
    {},
    {
      attempts: 3,
      baseDelayMs: 0,
      fetcher: async () => {
        calls += 1;
        if (calls < 3) throw new TypeError("Failed to fetch");
        return new Response('{"ok":true}', { status: 200 });
      },
    },
  );

  assert.equal(calls, 3);
  assert.equal(response.status, 200);
});

test("只读请求在 Render 瞬时 HTTP 错误后有限重试", async () => {
  let calls = 0;
  const response = await fetchWithNetworkRetry(
    "https://api.example/snapshot",
    {},
    {
      attempts: 3,
      baseDelayMs: 0,
      fetcher: async () => {
        calls += 1;
        return new Response(null, { status: calls < 3 ? 502 : 200 });
      },
    },
  );

  assert.equal(calls, 3);
  assert.equal(response.status, 200);
});

test("写请求发生网络错误时不会自动重放", async () => {
  let calls = 0;

  await assert.rejects(
    fetchWithNetworkRetry(
      "https://api.example/review",
      { method: "POST" },
      {
        attempts: 3,
        baseDelayMs: 0,
        fetcher: async () => {
          calls += 1;
          throw new TypeError("Failed to fetch");
        },
      },
    ),
    /服务可能正在唤醒/,
  );

  assert.equal(calls, 1);
});

test("写请求收到 HTTP 503 时不会自动重放", async () => {
  let calls = 0;
  const response = await fetchWithNetworkRetry(
    "https://api.example/review",
    { method: "POST" },
    {
      attempts: 3,
      baseDelayMs: 0,
      fetcher: async () => {
        calls += 1;
        return new Response(null, { status: 503 });
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(response.status, 503);
});
