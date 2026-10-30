import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { snapshotFetchedAtHeader } from "./lib/edge-copy";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type WorkerEnv = {
  AI_RADAR_API_UPSTREAM_URL?: string;
};

// Subset of the Workers execution context used here; absent outside Cloudflare.
type WorkerContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
  cache?: { purge?: (options: { tags: string[] }) => Promise<unknown> };
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
const apiProxyPrefix = "/backend";
const apiUpstreamUrl = import.meta.env.VITE_API_UPSTREAM_URL?.trim()?.replace(/\/$/, "");

// Workers Cache stores this Worker's responses, so caching is opt-in per response.
// Only the anonymous public snapshot is shared: the API builds it without user
// activity. It is fresh for 5 minutes; for a week afterwards visitors get the
// previous copy at once while the API, which can take about a minute to wake,
// refreshes it in the background.
const publicSnapshotPath = `${apiProxyPrefix}/api/v2/snapshot`;
export const publicSnapshotCacheTag = "public-snapshot";
export const publicSnapshotCacheControl = "public, max-age=300, stale-while-revalidate=604800";
// `private` is the documented Workers Cache bypass; the rest stops browser reuse.
export const privateNoStoreCacheControl = "private, no-store, no-cache, must-revalidate";
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

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

function withHeaders(response: Response, update: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  update(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withPrivateNoStore(response: Response): Response {
  return withHeaders(response, (headers) => {
    headers.set("Cache-Control", privateNoStoreCacheControl);
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
  });
}

export function withSsrCachePolicy(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) return withPrivateNoStore(response);
  // Workers Cache may apply heuristic freshness to responses without Cache-Control.
  return response.headers.has("cache-control") ? response : withPrivateNoStore(response);
}

export function isPublicSnapshotRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname === publicSnapshotPath &&
    !url.search &&
    !request.headers.has("authorization")
  );
}

export function withApiCachePolicy(
  request: Request,
  response: Response,
  fetchedAt = new Date(),
): Response {
  if (!isPublicSnapshotRequest(request) || response.status !== 200) {
    return withPrivateNoStore(response);
  }
  return withHeaders(response, (headers) => {
    headers.set("Cache-Control", publicSnapshotCacheControl);
    headers.set("Cache-Tag", publicSnapshotCacheTag);
    // When this copy was fetched; the body's own retrievedAt is left untouched.
    headers.set(snapshotFetchedAtHeader, fetchedAt.toISOString());
    headers.delete("Pragma");
    headers.delete("Expires");
    headers.delete("Set-Cookie");
  });
}

// Every catalog write goes through /api/v2/admin/, so a successful one makes the
// cached snapshot outdated. Without purge support the 5-minute freshness bounds the lag.
export function purgePublicSnapshotAfterAdminWrite(
  request: Request,
  response: Response,
  ctx?: WorkerContext,
): boolean {
  const url = new URL(request.url);
  if (
    safeMethods.has(request.method) ||
    !url.pathname.startsWith(`${apiProxyPrefix}/api/v2/admin/`) ||
    !response.ok ||
    !ctx?.cache?.purge
  ) {
    return false;
  }
  const pending = ctx.cache.purge({ tags: [publicSnapshotCacheTag] }).catch((error) => {
    console.error("Public snapshot cache purge failed", error);
  });
  ctx.waitUntil?.(pending);
  return true;
}

export async function proxyApiRequest(
  request: Request,
  upstreamUrl = apiUpstreamUrl,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== apiProxyPrefix && !url.pathname.startsWith(`${apiProxyPrefix}/`)) {
    return null;
  }
  if (!upstreamUrl) {
    return withPrivateNoStore(
      Response.json({ detail: "Cloudflare API proxy is not configured." }, { status: 503 }),
    );
  }
  const upstream = new URL(upstreamUrl);
  upstream.pathname = url.pathname.slice(apiProxyPrefix.length) || "/";
  upstream.search = url.search;
  try {
    const response = await fetcher(new Request(upstream, request));
    return withApiCachePolicy(request, response);
  } catch (error) {
    console.error(error);
    return withPrivateNoStore(
      Response.json({ detail: "后端 API 正在唤醒或网络暂时不可用，请稍后重试。" }, { status: 502 }),
    );
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const proxied = await proxyApiRequest(request, resolveApiUpstream(env as WorkerEnv));
      if (proxied) {
        purgePublicSnapshotAfterAdminWrite(request, proxied, ctx as WorkerContext);
        return proxied;
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSsrCachePolicy(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSsrCachePolicy(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
