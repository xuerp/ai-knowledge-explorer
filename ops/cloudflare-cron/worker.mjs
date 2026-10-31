export function normalizeApiBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("AI_RADAR_API_BASE_URL must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);
const KEEPALIVE_CRON = "*/5 * * * *";
const AUTOMATION_CRON = "*/30 * * * *";

// This path only checks the process. It must not query Neon, run collection,
// call a model, or carry the automation credential.
export async function keepBackendAwake(env, fetchImpl = fetch) {
  const apiBaseUrl = normalizeApiBaseUrl(env.AI_RADAR_API_BASE_URL);
  const startedAt = Date.now();
  const response = await fetchImpl(`${apiBaseUrl}/health`, {
    method: "GET",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`Backend health returned ${response.status}.`);
  }
  // Render's startup HTML and a cached/proxied 200 are not proof of health.
  let health;
  try {
    health = await response.json();
  } catch {
    throw new Error("Backend health did not return valid JSON.");
  }
  if (health?.ok !== true) {
    throw new Error("Backend health response did not confirm readiness of the process.");
  }
  return { ok: true, elapsedMs: Date.now() - startedAt, buildCommit: health.buildCommit ?? null };
}

export function enqueueKeepAlive(
  controller,
  env,
  context,
  keepAlive = keepBackendAwake,
  logger = console,
) {
  logger.log(
    JSON.stringify({
      event: "backend-keepalive-started",
      cron: controller.cron,
      scheduledAt: new Date(controller.scheduledTime).toISOString(),
    }),
  );
  const task = keepAlive(env)
    .then((result) => {
      logger.log(JSON.stringify({ ...result, event: "backend-keepalive-succeeded" }));
      return result;
    })
    .catch((error) => {
      logger.error(
        JSON.stringify({
          event: "backend-keepalive-failed",
          error:
            error instanceof Error ? error.message.slice(0, 500) : "Backend health request failed.",
        }),
      );
      throw error;
    });
  context.waitUntil(task);
  return task;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runAutomationCycle(env, fetchImpl = fetch, options = {}) {
  if (!env.AI_RADAR_AUTOMATION_TOKEN || env.AI_RADAR_AUTOMATION_TOKEN.length < 32) {
    throw new Error("AI_RADAR_AUTOMATION_TOKEN is missing or too short.");
  }
  const apiBaseUrl = normalizeApiBaseUrl(env.AI_RADAR_API_BASE_URL);
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts ?? 3), 3));
  const delay = options.delay ?? wait;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}/api/v2/automation/run-cycle`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Automation-Token": env.AI_RADAR_AUTOMATION_TOKEN,
        },
      });
    } catch (error) {
      lastError = new Error(
        `Automation API request failed on attempt ${attempt}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (attempt >= maxAttempts) {
        throw lastError;
      }
      await delay(attempt === 1 ? 5_000 : 15_000);
      continue;
    }
    const body = await response.text();
    if (response.ok) {
      return JSON.parse(body);
    }
    lastError = new Error(`Automation API returned ${response.status}: ${body.slice(0, 300)}`);
    if (!TRANSIENT_STATUS_CODES.has(response.status) || attempt >= maxAttempts) {
      throw lastError;
    }
    await delay(attempt === 1 ? 5_000 : 15_000);
  }
  throw lastError ?? new Error("Automation API request failed.");
}

export function enqueueAutomationCycle(
  controller,
  env,
  context,
  runCycle = runAutomationCycle,
  logger = console,
) {
  const scheduledAt = controller?.scheduledTime
    ? new Date(controller.scheduledTime).toISOString()
    : new Date().toISOString();
  logger.log(
    JSON.stringify({
      event: "automation-cycle-started",
      cron: controller?.cron ?? null,
      scheduledAt,
    }),
  );
  const task = runCycle(env)
    .then((result) => {
      if (result?.status === "partial") {
        const warn =
          typeof logger.warn === "function" ? logger.warn.bind(logger) : logger.log.bind(logger);
        warn(JSON.stringify({ ...result, event: "automation-cycle-partial" }));
      } else {
        logger.log(JSON.stringify({ ...result, event: "automation-cycle-succeeded" }));
      }
      return result;
    })
    .catch((error) => {
      logger.error(
        JSON.stringify({
          event: "automation-cycle-failed",
          error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        }),
      );
      throw error;
    });
  context.waitUntil(task);
  return task;
}

export default {
  scheduled(controller, env, context) {
    if (controller.cron === KEEPALIVE_CRON) {
      enqueueKeepAlive(controller, env, context);
    } else if (controller.cron === AUTOMATION_CRON) {
      enqueueAutomationCycle(controller, env, context);
    } else {
      throw new Error(`Unsupported scheduler expression: ${controller.cron}`);
    }
  },

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, scheduler: "ai-radar-cron-staging" });
    }
    return new Response("Not found", { status: 404 });
  },
};
