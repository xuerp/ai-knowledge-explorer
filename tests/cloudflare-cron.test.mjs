import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeApiBaseUrl, runAutomationCycle } from "../ops/cloudflare-cron/worker.mjs";

test("Cloudflare Cron 只接受 HTTPS API 地址", () => {
  assert.equal(normalizeApiBaseUrl("https://api.example.com/"), "https://api.example.com");
  assert.throws(() => normalizeApiBaseUrl("http://api.example.com"), /HTTPS/);
});

test("Cloudflare Cron 使用独立自动化令牌调用单周期接口", async () => {
  let captured;
  const result = await runAutomationCycle(
    {
      AI_RADAR_API_BASE_URL: "https://api.example.com/",
      AI_RADAR_AUTOMATION_TOKEN: "a".repeat(32),
    },
    async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ cycleId: "cycle-1", status: "succeeded" }), {
        status: 200,
      });
    },
  );

  assert.equal(captured.url, "https://api.example.com/api/v2/automation/run-cycle");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["X-Automation-Token"], "a".repeat(32));
  assert.equal(result.cycleId, "cycle-1");
});

test("Cloudflare Cron 不会在令牌缺失时发起请求", async () => {
  await assert.rejects(
    runAutomationCycle({ AI_RADAR_API_BASE_URL: "https://api.example.com" }, async () =>
      assert.fail("不应发起请求"),
    ),
    /missing or too short/,
  );
});

test("Cloudflare Cron 先无触发器部署，再启用按小时计划", async () => {
  const setup = JSON.parse(await readFile("ops/cloudflare-cron/wrangler.setup.json", "utf8"));
  const scheduled = JSON.parse(await readFile("ops/cloudflare-cron/wrangler.json", "utf8"));
  assert.equal(setup.name, scheduled.name);
  assert.equal(setup.triggers, undefined);
  assert.deepEqual(scheduled.triggers.crons, ["17 * * * *"]);
});
