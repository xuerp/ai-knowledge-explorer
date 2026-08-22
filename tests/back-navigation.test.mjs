import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { backNavigationFor } = await vite.ssrLoadModule("/src/domain/back-navigation.ts");

test.after(async () => vite.close());

test("首页隐藏返回按钮，其他页面按浏览历史决定返回方式", () => {
  assert.deepEqual(backNavigationFor("/", 4), {
    visible: false,
    action: "history",
  });
  assert.deepEqual(backNavigationFor("/knowledge/company/anthropic", 4), {
    visible: true,
    action: "history",
  });
  assert.deepEqual(backNavigationFor("/settings", 1), {
    visible: true,
    action: "home",
  });
});
