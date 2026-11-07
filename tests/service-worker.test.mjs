import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

async function worker() {
  const listeners = new Map();
  const stores = new Map();
  const precached = [];
  const origin = "https://radar.example";
  const key = (request) =>
    new URL(typeof request === "string" ? request : request.url, origin).href;
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      addAll: async (paths) => {
        precached.push(...paths);
        for (const path of paths) store.set(key(path), new Response(`cached:${path}`));
      },
      put: async (request, response) => store.set(key(request), response.clone()),
      match: async (request) => store.get(key(request))?.clone(),
    };
  };
  let network = async () =>
    new Response("current HTML", { headers: { "Cache-Control": "no-store" } });
  vm.runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self: {
      location: { origin },
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async (request) => {
        for (const store of stores.values()) {
          if (store.has(key(request))) return store.get(key(request)).clone();
        }
      },
    },
    fetch: (...args) => network(...args),
    URL,
    Response,
  });
  const lifecycle = async (name) => {
    let pending;
    listeners.get(name)({ waitUntil: (promise) => (pending = promise) });
    await pending;
  };
  return {
    stores,
    precached,
    open,
    key,
    lifecycle,
    network: (implementation) => (network = implementation),
    fetch: async (path, mode = "navigate") => {
      let response;
      const pending = [];
      listeners.get("fetch")({
        request: { url: new URL(path, origin).href, method: "GET", mode },
        respondWith: (promise) => (response = promise),
        waitUntil: (promise) => pending.push(promise),
      });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
  };
}

test("navigation failure never revives cached HTML with removed deployment assets", async () => {
  const sw = await worker();
  await sw.lifecycle("install");
  for (const name of sw.stores.keys()) {
    const cache = await sw.open(name);
    await cache.put("/", new Response('<script src="/assets/index-old.js"></script>'));
    await cache.put("/updates", new Response("stale updates HTML"));
  }
  sw.network(async () => {
    throw new TypeError("Network unavailable");
  });
  for (const path of ["/updates", "/updates?release=new", "/research/private-record"]) {
    assert.equal(await (await sw.fetch(path)).text(), "cached:/offline.html", path);
  }
});

test("no-store navigation responses and account pages never enter the shell cache", async () => {
  const sw = await worker();
  await sw.lifecycle("install");
  for (const path of ["/", "/updates", "/ask", "/research/private-record"]) {
    assert.equal(await (await sw.fetch(path)).text(), "current HTML");
    for (const store of sw.stores.values()) assert.equal(store.has(sw.key(path)), false, path);
  }
  assert.deepEqual(
    [...sw.precached].sort(),
    [
      "/favicon.ico",
      "/brand/favicon.ico",
      "/brand/radar.svg",
      "/brand/manifest.webmanifest",
      "/offline.html",
      "/brand/apple-touch-icon.png",
      "/brand/icon-192.png",
      "/brand/icon-512.png",
    ].sort(),
  );
});

test("activation discards legacy HTML caches without touching other application storage", async () => {
  const sw = await worker();
  await sw.open("ai-radar-shell-v4");
  await sw.open("ai-radar-shell-v5");
  await sw.open("ai-radar-shell-v6");
  await sw.open("other-application-data");
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  assert.equal(sw.stores.has("ai-radar-shell-v4"), false);
  assert.equal(sw.stores.has("ai-radar-shell-v5"), false);
  assert.equal(sw.stores.has("ai-radar-shell-v6"), false);
  assert.equal(sw.stores.has("other-application-data"), true);
});

test("online brand requests replace stale icons and only use cache when offline", async () => {
  const sw = await worker();
  await sw.lifecycle("install");
  sw.network(async () => {
    const response = new Response("current blue radar");
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  });
  const paths = ["/brand/radar.svg?v=new", "/brand/favicon.ico?v=new", "/favicon.ico"];
  for (const path of paths) {
    assert.equal(await (await sw.fetch(path, "cors")).text(), "current blue radar", path);
  }
  sw.network(async () => {
    throw new TypeError("offline");
  });
  for (const path of paths) {
    assert.equal(await (await sw.fetch(path, "cors")).text(), "current blue radar", path);
  }
  sw.network(async () => new Response("removed", { status: 404 }));
  for (const path of paths) assert.equal((await sw.fetch(path, "cors")).status, 404, path);
});

test("API requests bypass the worker cache and failed hashed assets remain failures", async () => {
  const sw = await worker();
  assert.equal(await sw.fetch("/backend/api/v2/snapshot", "cors"), undefined);
  assert.equal(await sw.fetch("/api/v2/auth/me", "cors"), undefined);
  const calls = [];
  sw.network(async (request, init) => {
    calls.push({ path: new URL(request.url).pathname, cache: init?.cache });
    return new Response("missing", { status: 404 });
  });
  assert.equal((await sw.fetch("/assets/index-old.js", "cors")).status, 404);
  assert.equal((await sw.fetch("/admin/review")).status, 404);
  assert.deepEqual(calls, [
    { path: "/assets/index-old.js", cache: undefined },
    { path: "/admin/review", cache: "no-store" },
  ]);
});
