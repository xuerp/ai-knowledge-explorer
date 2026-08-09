import { pathToFileURL } from "node:url";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeDeploymentUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} 不是有效 URL。`);
  }
  if (!localHosts.has(url.hostname) && url.protocol !== "https:") {
    throw new Error(`${label} 的公网地址必须使用 HTTPS。`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`${label} 只支持 HTTP 或 HTTPS。`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function request(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${url} 返回 ${response.status}。`);
  }
  return response;
}

async function readJson(fetchImpl, url) {
  const response = await request(fetchImpl, url, {
    headers: { Accept: "application/json" },
  });
  return response.json();
}

export async function runStagingSmokeTest({ apiBaseUrl, frontendUrl, fetchImpl = fetch }) {
  const api = normalizeDeploymentUrl(apiBaseUrl, "API 地址");
  const frontend = normalizeDeploymentUrl(frontendUrl, "前端地址");
  const apiRoot = api.href.replace(/\/$/, "");

  const [health, ready, snapshot, frontendResponse] = await Promise.all([
    readJson(fetchImpl, `${apiRoot}/health`),
    readJson(fetchImpl, `${apiRoot}/ready`),
    readJson(fetchImpl, `${apiRoot}/api/v2/snapshot`),
    request(fetchImpl, frontend.href),
  ]);
  if (health.ok !== true || ready.ok !== true) {
    throw new Error("API 健康检查或就绪检查未返回 ok=true。");
  }
  if (!Array.isArray(snapshot.entities) || snapshot.entities.length === 0) {
    throw new Error("公开快照没有可读取的实体数据。");
  }

  const corsResponse = await request(fetchImpl, `${apiRoot}/ready`, {
    method: "OPTIONS",
    headers: {
      Origin: frontend.origin,
      "Access-Control-Request-Method": "GET",
    },
  });
  if (corsResponse.headers.get("access-control-allow-origin") !== frontend.origin) {
    throw new Error(`API 尚未允许前端来源 ${frontend.origin}。`);
  }

  return {
    api: api.origin,
    frontend: frontend.origin,
    environment: ready.environment,
    dataMode: ready.dataMode,
    entityCount: snapshot.entities.length,
    frontendStatus: frontendResponse.status,
  };
}

async function main() {
  const result = await runStagingSmokeTest({
    apiBaseUrl: process.env.AI_RADAR_SMOKE_API_URL ?? "http://127.0.0.1:8001",
    frontendUrl: process.env.AI_RADAR_SMOKE_FRONTEND_URL ?? "http://127.0.0.1:4183",
  });
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
