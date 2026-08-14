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

export async function runAutomationCycle(env, fetchImpl = fetch) {
  if (!env.AI_RADAR_AUTOMATION_TOKEN || env.AI_RADAR_AUTOMATION_TOKEN.length < 32) {
    throw new Error("AI_RADAR_AUTOMATION_TOKEN is missing or too short.");
  }
  const apiBaseUrl = normalizeApiBaseUrl(env.AI_RADAR_API_BASE_URL);
  const response = await fetchImpl(`${apiBaseUrl}/api/v2/automation/run-cycle`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Automation-Token": env.AI_RADAR_AUTOMATION_TOKEN,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Automation API returned ${response.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
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
      logger.log(JSON.stringify({ event: "automation-cycle-succeeded", ...result }));
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
