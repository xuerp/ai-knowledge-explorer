import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type WorkerEnv = {
  AI_RADAR_API_UPSTREAM_URL?: string;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
const apiProxyPrefix = "/backend";
const apiUpstreamUrl = import.meta.env.VITE_API_UPSTREAM_URL?.trim()?.replace(/\/$/, "");
const legacySiteHosts = new Set([
  "ai-radar.xue-ai.workers.dev",
  "ai-radar-staging.1966761779.workers.dev",
]);

export function redirectLegacyPage(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (
    !legacySiteHosts.has(url.hostname) ||
    url.pathname === apiProxyPrefix ||
    url.pathname.startsWith(`${apiProxyPrefix}/`)
  ) {
    return null;
  }
  // Old clients can continue to request their assets and service worker.
  if (url.pathname.split("/").at(-1)?.includes(".")) return null;
  const target = new URL("https://airadar.rainza.cn");
  target.pathname = url.pathname;
  target.search = url.search;
  return Response.redirect(target, 308);
}

export function resolveApiUpstream(env?: WorkerEnv) {
  return env?.AI_RADAR_API_UPSTREAM_URL?.trim()?.replace(/\/$/, "") || apiUpstreamUrl;
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export function withNoStoreHtmlResponse(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withNoStoreAdminApiResponse(request: Request, response: Response): Response {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${apiProxyPrefix}/api/v2/admin/`)) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function proxyApiRequest(
  request: Request,
  upstreamUrl = apiUpstreamUrl,
  fetcher: typeof fetch = fetch,
  publicCache?: Cache,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== apiProxyPrefix && !url.pathname.startsWith(`${apiProxyPrefix}/`)) {
    return null;
  }
  if (!upstreamUrl) {
    return Response.json({ detail: "Cloudflare API proxy is not configured." }, { status: 503 });
  }
  const upstream = new URL(upstreamUrl);
  upstream.pathname = url.pathname.slice(apiProxyPrefix.length) || "/";
  upstream.search = url.search;
  // This allowlist is deliberately limited to the anonymous, public updates projection.
  // Never put account/admin responses or authenticated requests in the shared cache.
  const cacheable =
    publicCache &&
    request.method === "GET" &&
    url.pathname === `${apiProxyPrefix}/api/v2/updates` &&
    !url.search &&
    !request.headers.has("authorization") &&
    !request.headers.has("cookie");
  const cacheKey = new Request(upstream.toString());
  if (cacheable) {
    const cached = await publicCache.match(cacheKey).catch(() => undefined);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-AI-Radar-Cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
  }
  try {
    const response = await fetcher(new Request(upstream, request));
    if (cacheable && response.status === 200 && !response.headers.has("set-cookie")) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
      headers.set("X-AI-Radar-Cache", "MISS");
      const publicResponse = new Response(response.body, { status: 200, headers });
      // A cache failure must never hide a successful origin response.
      await publicCache.put(cacheKey, publicResponse.clone()).catch(() => {});
      return publicResponse;
    }
    return withNoStoreAdminApiResponse(request, response);
  } catch (error) {
    console.error(error);
    return Response.json(
      { detail: "后端 API 正在唤醒或网络暂时不可用，请稍后重试。" },
      { status: 502 },
    );
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const redirect = redirectLegacyPage(request);
      if (redirect) return redirect;
      const publicCache =
        typeof caches === "undefined"
          ? undefined
          : (caches as CacheStorage & { default?: Cache }).default;
      const proxied = await proxyApiRequest(
        request,
        resolveApiUpstream(env as WorkerEnv),
        fetch,
        publicCache,
      );
      if (proxied) return proxied;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withNoStoreHtmlResponse(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withNoStoreHtmlResponse(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
