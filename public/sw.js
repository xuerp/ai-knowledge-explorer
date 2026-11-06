const CACHE_NAME = "ai-radar-shell-v7";
const APP_SHELL = [
  "/offline.html",
  "/brand/manifest.webmanifest",
  "/brand/radar.svg",
  "/brand/favicon.ico",
  "/favicon.ico",
  "/brand/apple-touch-icon.png",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ai-radar-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/backend/")
  )
    return;

  // 管理页依赖当前标签页中的短期 JWT，不应进入离线缓存或回退到旧页面。
  if (url.pathname.startsWith("/admin/")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Hashed assets and HTML must come from the same deployment. Old navigation
  // HTML cannot be an offline shell when its entry script is no longer hosted.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match("/offline.html");
      }),
    );
    return;
  }

  // Cache only the standalone offline page and install metadata, never private
  // reports, route data, version markers or other application HTML.
  if (!APP_SHELL.includes(url.pathname)) return;
  // Brand resources must reflect the current release online. Cache is only an
  // offline fallback; query-versioned URLs must not revive a stale template icon.
  if (url.pathname.startsWith("/brand/") || url.pathname === "/favicon.ico") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const response = await fetch(request, { cache: "no-cache" });
          if (response.ok && response.type === "basic") {
            event.waitUntil(cache.put(request.url, response.clone()));
          }
          return response;
        } catch {
          return (await cache.match(request.url)) ?? cache.match(url.pathname);
        }
      }),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok || response.type !== "basic") return response;
        const copy = response.clone();
        event.waitUntil(cache.put(url.pathname, copy));
        return response;
      });
    }),
  );
});
