import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeDeploymentUrl,
  runStagingSmokeTest,
  verifyWorkerProxy,
} from "../scripts/smoke-staging.mjs";

const direct = {
  ready: { ok: true, buildCommit: "abc1234" },
  snapshot: { entities: [{ id: "entity-1" }, { id: "entity-2" }] },
};

function proxyFetch({
  healthStatus = 200,
  readyStatus = 200,
  snapshotStatus = 200,
  headStatus = 200,
  loginStatus = 422,
  buildCommit = "abc1234",
  entityCount = 2,
  loginDetail = [{ type: "missing", loc: ["body", "email"] }],
  contentType = "application/json",
  html = "<!doctype html><title>DNS points to prohibited IP</title>",
} = {}) {
  return async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (method === "HEAD" && url.endsWith("/ready")) {
      return new Response(null, { status: headStatus });
    }
    if (method === "POST" && url.endsWith("/api/v2/auth/login")) {
      if (loginStatus !== 422) return new Response(html, { status: loginStatus });
      return Response.json({ detail: loginDetail }, { status: loginStatus });
    }
    if (url.endsWith("/health")) {
      return healthStatus === 200
        ? Response.json({ ok: true })
        : new Response(html, { status: healthStatus });
    }
    if (url.endsWith("/ready")) {
      return readyStatus === 200
        ? Response.json({ ok: true, buildCommit })
        : new Response(html, { status: readyStatus });
    }
    if (url.endsWith("/api/v2/snapshot")) {
      if (snapshotStatus !== 200) return new Response(html, { status: snapshotStatus });
      if (contentType !== "application/json") {
        return new Response("not json", { status: 200, headers: { "Content-Type": contentType } });
      }
      return Response.json({
        entities: Array.from({ length: entityCount }, (_, i) => ({ id: i })),
      });
    }
    throw new Error(`unexpected proxy request: ${method} ${url}`);
  };
}

test("staging smoke test verifies health, snapshot, frontend, and CORS", async () => {
  const origin = "https://staging.example.com";
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: { "Access-Control-Allow-Origin": origin },
      });
    }
    if (url.endsWith("/health") || url.endsWith("/ready")) {
      return Response.json({ ok: true, environment: "production", dataMode: "demo" });
    }
    if (url.endsWith("/api/v2/snapshot")) {
      return Response.json({ entities: [{ id: "entity-1" }] });
    }
    return new Response("AI Radar", { status: 200 });
  };

  const result = await runStagingSmokeTest({
    apiBaseUrl: "https://api.example.com/",
    frontendUrl: origin,
    fetchImpl,
  });

  assert.equal(result.entityCount, 1);
  assert.equal(result.frontendStatus, 200);
  assert.equal(result.dataMode, "demo");
});

test("public deployment URLs must use HTTPS", () => {
  assert.throws(
    () => normalizeDeploymentUrl("http://api.example.com", "API 地址"),
    /必须使用 HTTPS/,
  );
  assert.equal(
    normalizeDeploymentUrl("http://127.0.0.1:8001", "API 地址").origin,
    "http://127.0.0.1:8001",
  );
});

test("Worker 代理检查默认不开启，不改变既有行为", async () => {
  const origin = "https://staging.example.com";
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: { "Access-Control-Allow-Origin": origin },
      });
    }
    if (url.endsWith("/health") || url.endsWith("/ready")) return Response.json({ ok: true });
    if (url.endsWith("/api/v2/snapshot")) return Response.json({ entities: [{ id: "e" }] });
    return new Response("AI Radar", { status: 200 });
  };
  const result = await runStagingSmokeTest({
    apiBaseUrl: "https://api.example.com",
    frontendUrl: origin,
    fetchImpl,
  });
  assert.equal(result.workerProxy, null);
});

test("Worker 代理的 GET、HEAD、POST 均通过时返回代理结果", async () => {
  const result = await verifyWorkerProxy({
    proxyRoot: "https://staging.example.com/backend",
    direct,
    fetchImpl: proxyFetch(),
  });
  assert.deepEqual(result.methods, ["GET", "HEAD", "POST"]);
  assert.equal(result.buildCommit, "abc1234");
});

test("GET 经代理失败时报告状态码和 Worker 错误页标题", async () => {
  await assert.rejects(
    verifyWorkerProxy({
      proxyRoot: "https://staging.example.com/backend",
      direct,
      fetchImpl: proxyFetch({ healthStatus: 403 }),
    }),
    /经 Worker 代理 GET .*返回 403.*DNS points to prohibited IP.*Worker 的 \/backend 代理路径/s,
  );
});

test("HEAD 经代理失败单独报告，不与 GET 混淆", async () => {
  await assert.rejects(
    verifyWorkerProxy({
      proxyRoot: "https://staging.example.com/backend",
      direct,
      fetchImpl: proxyFetch({ headStatus: 403 }),
    }),
    /经 Worker 代理 HEAD .*\/ready 返回 403/,
  );
});

test("POST 经代理失败（非 422）单独报告", async () => {
  await assert.rejects(
    verifyWorkerProxy({
      proxyRoot: "https://staging.example.com/backend",
      direct,
      fetchImpl: proxyFetch({ loginStatus: 403 }),
    }),
    /经 Worker 代理 POST .*auth\/login 返回 403，预期 422/,
  );
});

test("POST 返回 422 但不是字段校验结果时报错，不当作通过", async () => {
  await assert.rejects(
    verifyWorkerProxy({
      proxyRoot: "https://staging.example.com/backend",
      direct,
      fetchImpl: proxyFetch({ loginDetail: "not-an-array" }),
    }),
    /不是 API 的字段校验结果/,
  );
});

test("代理返回非 JSON 内容时判定为未到达 API，而不是直接反序列化失败", async () => {
  await assert.rejects(
    verifyWorkerProxy({
      proxyRoot: "https://staging.example.com/backend",
      direct,
      fetchImpl: proxyFetch({ contentType: "text/html; charset=UTF-8" }),
    }),
    /返回了非 JSON 内容.*请求没有到达 API/s,
  );
});

test("代理指向的 API 版本与直连不一致时报错", async () => {
  await assert.rejects(
    verifyWorkerProxy({
      proxyRoot: "https://staging.example.com/backend",
      direct,
      fetchImpl: proxyFetch({ buildCommit: "deadbee" }),
    }),
    /Worker 代理指向的 API 版本 deadbee 与直连的 abc1234 不一致/,
  );
});

test("代理读到的实体数量与直连不一致时报错", async () => {
  await assert.rejects(
    verifyWorkerProxy({
      proxyRoot: "https://staging.example.com/backend",
      direct,
      fetchImpl: proxyFetch({ entityCount: 1 }),
    }),
    /经 Worker 代理读到 1 个实体，直连为 2 个/,
  );
});

test("传入 proxyBaseUrl 时，runStagingSmokeTest 会一并检查 Worker 代理", async () => {
  const origin = "https://staging.example.com";
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (init.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: { "Access-Control-Allow-Origin": origin },
      });
    }
    if (url === "https://api.example.com/health" || url === "https://api.example.com/ready") {
      return Response.json({ ok: true, buildCommit: "abc1234" });
    }
    if (url === "https://api.example.com/api/v2/snapshot") {
      return Response.json({ entities: [{ id: "e1" }, { id: "e2" }] });
    }
    if (url.startsWith(`${origin}/backend`)) {
      return proxyFetch()(
        url.replace(`${origin}/backend`, "https://staging.example.com/backend"),
        init,
      );
    }
    if (method === "GET" && url === origin + "/") return new Response("AI Radar", { status: 200 });
    throw new Error(`unexpected request: ${method} ${url}`);
  };

  const result = await runStagingSmokeTest({
    apiBaseUrl: "https://api.example.com",
    frontendUrl: origin,
    proxyBaseUrl: `${origin}/backend`,
    fetchImpl,
  });

  assert.deepEqual(result.workerProxy.methods, ["GET", "HEAD", "POST"]);
  assert.equal(result.workerProxy.buildCommit, "abc1234");
});
