import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { isAssetLoadError, recoverStaleAssets } = await vite.ssrLoadModule(
  "/src/lib/asset-recovery.ts",
);
test.after(() => vite.close());

test("识别线上 CSS 预加载故障及不同浏览器的模块加载故障", () => {
  for (const message of [
    "Unable to preload CSS for https://example.com/assets/DecisionBrief-old.css",
    "Failed to fetch dynamically imported module: https://example.com/assets/ask-old.js",
    "error loading dynamically imported module: https://example.com/assets/ask-old.js",
    "Importing a module script failed.",
    "Loading chunk 12 failed.",
  ]) {
    assert.equal(isAssetLoadError(new Error(message)), true, message);
  }
  assert.equal(isAssetLoadError({ message: "Unable to preload CSS for /assets/old.css" }), true);
  for (const error of [new Error("API request failed"), "invalid data", null, {}]) {
    assert.equal(isAssetLoadError(error), false);
  }
});

test("只自动刷新一次，保留登录、草稿及原始错误，并在冷却期阻止循环刷新", () => {
  const originalWindow = globalThis.window;
  const values = new Map([
    ["auth-fixture", "existing-session"],
    ["ai-radar-decision-draft-v1", "/ask?task=original-task"],
  ]);
  let reloads = 0;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    location: { reload: () => reloads++ },
  };
  const error = new Error("Unable to preload CSS for /assets/DecisionBrief-old.css");
  const message = error.message;
  try {
    assert.equal(recoverStaleAssets(error, 1000), true);
    assert.equal(recoverStaleAssets(error, 1001), false);
    assert.equal(recoverStaleAssets(new Error("Loading chunk 2 failed."), 2000), false);
    assert.equal(reloads, 1);
    assert.equal(values.get("auth-fixture"), "existing-session");
    assert.equal(values.get("ai-radar-decision-draft-v1"), "/ask?task=original-task");
    assert.equal(error.message, message);
    assert.equal(recoverStaleAssets(error, 301001), true);
    assert.equal(reloads, 2);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("存储不可用、SSR 和普通业务错误均不会触发自动刷新", () => {
  const originalWindow = globalThis.window;
  let reloads = 0;
  const error = new Error("Unable to preload CSS for /assets/old.css");
  try {
    delete globalThis.window;
    assert.equal(recoverStaleAssets(error), false);
    globalThis.window = {
      sessionStorage: {
        getItem: () => {
          throw new Error("Storage unavailable");
        },
      },
      location: { reload: () => reloads++ },
    };
    assert.equal(recoverStaleAssets(error), false);
    assert.equal(recoverStaleAssets(new Error("API request failed")), false);
    assert.equal(reloads, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});
