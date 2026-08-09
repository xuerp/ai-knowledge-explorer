import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeDeploymentUrl, runStagingSmokeTest } from "../scripts/smoke-staging.mjs";

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
