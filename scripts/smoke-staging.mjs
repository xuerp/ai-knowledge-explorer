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

// The browser never calls the API directly: it goes through the frontend Worker's
// same-origin /backend proxy. A Worker change can break that path while the API and
// the frontend page stay healthy, so GET, HEAD and POST are checked through it.
const proxyTimeoutMs = 30_000;

async function proxyRequest(fetchImpl, label, url, init = {}) {
  const method = init.method ?? "GET";
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(proxyTimeoutMs) });
  } catch (error) {
    throw new Error(`经 Worker 代理 ${label} ${method} ${url} 失败：${error?.message ?? error}。`);
  }
  return response;
}

// Cloudflare and Render error pages are HTML; the <title> names the cause
// (for example "DNS points to prohibited IP"), which a bare status code would hide.
async function describeFailure(response) {
  const text = await response.text().catch(() => "");
  const title = /<title>([^<]{1,120})<\/title>/i.exec(text)?.[1]?.trim();
  return title ? `（${title}）` : "";
}

async function expectProxyJson(fetchImpl, label, url, init, expectedStatus) {
  const response = await proxyRequest(fetchImpl, label, url, init);
  const method = init?.method ?? "GET";
  if (response.status !== expectedStatus) {
    throw new Error(
      `经 Worker 代理 ${method} ${url} 返回 ${response.status}，预期 ${expectedStatus}${await describeFailure(response)}。` +
        "API 本身可达，问题在 Worker 的 /backend 代理路径。",
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `经 Worker 代理 ${method} ${url} 返回了非 JSON 内容（${contentType || "无 content-type"}），请求没有到达 API。`,
    );
  }
  return response.json();
}

export async function verifyWorkerProxy({ proxyRoot, direct, fetchImpl = fetch }) {
  const proxy = proxyRoot.replace(/\/$/, "");

  const [health, ready, snapshot] = await Promise.all([
    expectProxyJson(
      fetchImpl,
      "GET",
      `${proxy}/health`,
      { headers: { Accept: "application/json" } },
      200,
    ),
    expectProxyJson(
      fetchImpl,
      "GET",
      `${proxy}/ready`,
      { headers: { Accept: "application/json" } },
      200,
    ),
    expectProxyJson(
      fetchImpl,
      "GET",
      `${proxy}/api/v2/snapshot`,
      { headers: { Accept: "application/json" } },
      200,
    ),
  ]);
  if (health.ok !== true || ready.ok !== true) {
    throw new Error("经 Worker 代理的健康检查或就绪检查未返回 ok=true。");
  }
  // The proxy must reach the same deployment the direct checks reached.
  if (String(ready.buildCommit ?? "") !== String(direct.ready.buildCommit ?? "")) {
    throw new Error(
      `Worker 代理指向的 API 版本 ${String(ready.buildCommit).slice(0, 7)} 与直连的 ${String(direct.ready.buildCommit).slice(0, 7)} 不一致。`,
    );
  }
  if (snapshot.entities?.length !== direct.snapshot.entities.length) {
    throw new Error(
      `经 Worker 代理读到 ${snapshot.entities?.length ?? 0} 个实体，直连为 ${direct.snapshot.entities.length} 个。`,
    );
  }

  // HEAD and POST take different Worker/cache paths than GET.
  const head = await proxyRequest(fetchImpl, "HEAD", `${proxy}/ready`, { method: "HEAD" });
  if (head.status !== 200) {
    throw new Error(
      `经 Worker 代理 HEAD ${proxy}/ready 返回 ${head.status}，预期 200${await describeFailure(head)}。`,
    );
  }

  // An empty login body is rejected by validation (422) before any account lookup,
  // so this reaches the API without credentials, writes or side effects.
  const post = await expectProxyJson(
    fetchImpl,
    "POST",
    `${proxy}/api/v2/auth/login`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    },
    422,
  );
  if (!Array.isArray(post.detail)) {
    throw new Error("经 Worker 代理的 POST 返回了 422，但不是 API 的字段校验结果。");
  }

  return { proxy, methods: ["GET", "HEAD", "POST"], buildCommit: ready.buildCommit };
}

export async function runStagingSmokeTest({
  apiBaseUrl,
  frontendUrl,
  fetchImpl = fetch,
  proxyBaseUrl,
}) {
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

  // Optional: the browser never calls the API directly, it goes through the
  // frontend Worker's same-origin /backend proxy. That path has its own
  // failure modes (for example a Worker config change breaking GET/HEAD while
  // the API and the frontend page both stay healthy), so when a proxy base is
  // given, GET, HEAD and POST are checked through it, not just the API directly.
  const workerProxy = proxyBaseUrl
    ? await verifyWorkerProxy({
        proxyRoot: normalizeDeploymentUrl(proxyBaseUrl, "Worker 代理地址").href,
        direct: { ready, snapshot },
        fetchImpl,
      })
    : null;

  return {
    api: api.origin,
    frontend: frontend.origin,
    environment: ready.environment,
    dataMode: ready.dataMode,
    entityCount: snapshot.entities.length,
    frontendStatus: frontendResponse.status,
    workerProxy,
  };
}

async function main() {
  const result = await runStagingSmokeTest({
    apiBaseUrl: process.env.AI_RADAR_SMOKE_API_URL ?? "http://127.0.0.1:8001",
    frontendUrl: process.env.AI_RADAR_SMOKE_FRONTEND_URL ?? "http://127.0.0.1:4183",
    proxyBaseUrl: process.env.AI_RADAR_SMOKE_PROXY_URL,
  });
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
