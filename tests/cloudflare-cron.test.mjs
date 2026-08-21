import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  enqueueAutomationCycle,
  normalizeApiBaseUrl,
  runAutomationCycle,
} from "../ops/cloudflare-cron/worker.mjs";

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

test("Cloudflare Cron 先无触发器部署，再启用每半小时计划", async () => {
  const setup = JSON.parse(await readFile("ops/cloudflare-cron/wrangler.setup.json", "utf8"));
  const scheduled = JSON.parse(await readFile("ops/cloudflare-cron/wrangler.json", "utf8"));
  assert.equal(setup.name, scheduled.name);
  assert.equal(setup.triggers, undefined);
  assert.deepEqual(scheduled.triggers.crons, ["*/30 * * * *"]);
});

test("Cloudflare Cron 为开始和成功结果写入结构化日志", async () => {
  const logs = [];
  let pending;
  const result = await enqueueAutomationCycle(
    { cron: "*/30 * * * *", scheduledTime: Date.UTC(2026, 7, 14, 2, 30) },
    {},
    { waitUntil: (task) => (pending = task) },
    async () => ({ cycleId: "cycle-1", status: "succeeded" }),
    { log: (message) => logs.push(JSON.parse(message)), error: assert.fail },
  );

  assert.equal(pending instanceof Promise, true);
  assert.equal(result.cycleId, "cycle-1");
  assert.deepEqual(
    logs.map((entry) => entry.event),
    ["automation-cycle-started", "automation-cycle-succeeded"],
  );
  assert.equal(logs[0].scheduledAt, "2026-08-14T02:30:00.000Z");
});

test("Cloudflare Cron 记录失败并保持任务失败状态", async () => {
  const errors = [];
  await assert.rejects(
    enqueueAutomationCycle(
      { cron: "*/30 * * * *", scheduledTime: Date.UTC(2026, 7, 14, 3, 30) },
      {},
      { waitUntil: () => undefined },
      async () => {
        throw new Error("Render request failed");
      },
      { log: () => undefined, error: (message) => errors.push(JSON.parse(message)) },
    ),
    /Render request failed/,
  );
  assert.equal(errors[0].event, "automation-cycle-failed");
  assert.equal(errors[0].error, "Render request failed");
});

test("Cloudflare Cron 将部分成功周期写入独立告警事件", async () => {
  const warnings = [];
  const result = await enqueueAutomationCycle(
    { cron: "*/30 * * * *", scheduledTime: Date.UTC(2026, 7, 14, 3, 30) },
    {},
    { waitUntil: () => undefined },
    async () => ({ cycleId: "cycle-partial", status: "partial" }),
    {
      log: () => undefined,
      warn: (message) => warnings.push(JSON.parse(message)),
      error: assert.fail,
    },
  );

  assert.equal(result.status, "partial");
  assert.equal(warnings[0].event, "automation-cycle-partial");
  assert.equal(warnings[0].cycleId, "cycle-partial");
});

test("Cloudflare Cron 对供应商瞬时错误执行有限退避重试", async () => {
  const delays = [];
  let attempts = 0;
  const result = await runAutomationCycle(
    {
      AI_RADAR_API_BASE_URL: "https://api.example.com",
      AI_RADAR_AUTOMATION_TOKEN: "a".repeat(32),
    },
    async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("Render is waking", { status: 503 });
      }
      return new Response(JSON.stringify({ cycleId: "cycle-recovered", status: "succeeded" }));
    },
    { delay: async (milliseconds) => delays.push(milliseconds) },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5_000, 15_000]);
  assert.equal(result.cycleId, "cycle-recovered");
});

test("Cloudflare Cron 不会重试鉴权错误", async () => {
  let attempts = 0;
  await assert.rejects(
    runAutomationCycle(
      {
        AI_RADAR_API_BASE_URL: "https://api.example.com",
        AI_RADAR_AUTOMATION_TOKEN: "a".repeat(32),
      },
      async () => {
        attempts += 1;
        return new Response("Unauthorized", { status: 401 });
      },
      { delay: async () => assert.fail("鉴权错误不应进入退避等待") },
    ),
    /returned 401/,
  );
  assert.equal(attempts, 1);
});
