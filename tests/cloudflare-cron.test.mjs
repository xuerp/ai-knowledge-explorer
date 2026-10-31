import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, {
  enqueueAutomationCycle,
  enqueueKeepAlive,
  keepBackendAwake,
  normalizeApiBaseUrl,
  runAutomationCycle,
} from "../ops/cloudflare-cron/worker.mjs";

const KEEPALIVE_CRON = "*/5 * * * *";
const AUTOMATION_CRON = "*/30 * * * *";

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

test("Cloudflare Cron 分开配置五分钟保活与半小时自动化，初次设置不启用计划", async () => {
  const setup = JSON.parse(await readFile("ops/cloudflare-cron/wrangler.setup.json", "utf8"));
  const scheduled = JSON.parse(await readFile("ops/cloudflare-cron/wrangler.json", "utf8"));
  assert.equal(setup.name, scheduled.name);
  assert.equal(setup.triggers, undefined);
  assert.deepEqual(scheduled.triggers.crons, [KEEPALIVE_CRON, AUTOMATION_CRON]);
  assert.equal(KEEPALIVE_CRON, "*/5 * * * *");
  assert.equal(AUTOMATION_CRON, "*/30 * * * *");
});

test("保活只直连轻量 health，不携带凭据、不缓存且限制等待时间", async () => {
  let captured;
  const result = await keepBackendAwake(
    {
      AI_RADAR_API_BASE_URL: "https://api.example.com/",
      AI_RADAR_AUTOMATION_TOKEN: "must-not-be-sent",
    },
    async (url, init) => {
      captured = { url, init };
      return Response.json({ ok: true, buildCommit: "release-1" });
    },
  );
  assert.equal(captured.url, "https://api.example.com/health");
  assert.equal(captured.init.method, "GET");
  assert.equal(captured.init.headers["X-Automation-Token"], undefined);
  assert.equal(captured.init.headers.Authorization, undefined);
  assert.equal(captured.init.cache, "no-store");
  assert.equal(captured.init.redirect, "manual");
  assert.equal(captured.init.signal instanceof AbortSignal, true);
  assert.equal(result.ok, true);
  assert.equal(result.buildCommit, "release-1");
  assert.ok(result.elapsedMs >= 0);
});

test("保活不会把 Render 启动页、异常健康状态或 HTTP 错误记为成功", async () => {
  const env = { AI_RADAR_API_BASE_URL: "https://api.example.com" };
  for (const response of [
    new Response("<html>Starting your service</html>"),
    Response.json({ ok: false }),
    new Response(null, { status: 301, headers: { Location: "https://other.example.com" } }),
    new Response("unavailable", { status: 503 }),
  ]) {
    await assert.rejects(keepBackendAwake(env, async () => response));
  }
});

test("保活失败保留失败状态并输出独立日志，不泄露上游错误正文", async () => {
  const errors = [];
  let pending;
  const task = enqueueKeepAlive(
    { cron: KEEPALIVE_CRON, scheduledTime: Date.UTC(2026, 10, 1) },
    { AI_RADAR_API_BASE_URL: "https://api.example.com" },
    { waitUntil: (promise) => (pending = promise) },
    (env) => keepBackendAwake(env, async () => new Response("private-body", { status: 503 })),
    { log: () => {}, error: (message) => errors.push(JSON.parse(message)) },
  );
  assert.equal(task, pending);
  await assert.rejects(task, /503/);
  assert.equal(errors[0].event, "backend-keepalive-failed");
  assert.doesNotMatch(JSON.stringify(errors), /private-body/);
});

test("五分钟事件只保活，半小时事件才执行自动化，未知表达式拒绝运行", async (t) => {
  const requests = [];
  const pending = [];
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    return Response.json(
      url.endsWith("/health") ? { ok: true } : { cycleId: "cycle-1", status: "succeeded" },
    );
  });
  const env = {
    AI_RADAR_API_BASE_URL: "https://api.example.com",
    AI_RADAR_AUTOMATION_TOKEN: "a".repeat(32),
  };
  const context = { waitUntil: (task) => pending.push(task) };
  worker.scheduled({ cron: KEEPALIVE_CRON, scheduledTime: Date.UTC(2026, 10, 1) }, env, context);
  await pending[0];
  assert.deepEqual(
    requests.map((request) => request.url),
    ["https://api.example.com/health"],
  );
  worker.scheduled({ cron: AUTOMATION_CRON, scheduledTime: Date.UTC(2026, 10, 1) }, env, context);
  await pending[1];
  assert.equal(requests[1].url, "https://api.example.com/api/v2/automation/run-cycle");
  assert.equal(requests[1].init.method, "POST");
  assert.throws(() => worker.scheduled({ cron: "* * * * *" }, env, context), /Unsupported/);
  assert.equal(requests.length, 2);
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
