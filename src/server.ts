import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
const apiProxyPrefix = "/backend";
const apiUpstreamUrl = import.meta.env.VITE_API_UPSTREAM_URL?.trim()?.replace(/\/$/, "");

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
  try {
    const response = await fetcher(new Request(upstream, request));
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
      const proxied = await proxyApiRequest(request);
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
