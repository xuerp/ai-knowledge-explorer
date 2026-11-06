import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { backNavigationFor } = await vite.ssrLoadModule("/src/domain/back-navigation.ts");

test.after(async () => vite.close());

test("首页与顶层产品入口不显示返回按钮", () => {
  for (const path of [
    "/",
    "/updates",
    "/knowledge",
    "/ask",
    "/graph",
    "/case-study",
    "/updates/",
  ]) {
    for (const length of [1, 4]) {
      assert.equal(backNavigationFor(path, length).visible, false, path);
    }
  }
});

test("详情页保留返回按钮及浏览历史回退方式", () => {
  assert.deepEqual(backNavigationFor("/knowledge/company/anthropic", 4), {
    visible: true,
    action: "history",
  });
  assert.deepEqual(backNavigationFor("/settings", 1), {
    visible: true,
    action: "home",
  });
});
