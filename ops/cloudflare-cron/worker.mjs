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
    enqueueAutomationCycle(controller, env, context);
  },

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, scheduler: "ai-radar-cron-staging" });
    }
    return new Response("Not found", { status: 404 });
  },
};
