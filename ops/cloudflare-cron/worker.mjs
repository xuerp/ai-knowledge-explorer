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

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(
      runAutomationCycle(env).then((result) => {
        console.log(JSON.stringify({ event: "automation-cycle", ...result }));
      }),
    );
  },

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, scheduler: "ai-radar-cron-staging" });
    }
    return new Response("Not found", { status: 404 });
  },
};
