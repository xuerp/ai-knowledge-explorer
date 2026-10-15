import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const {
  authSessionExpiredEvent,
  authSessionKey,
  rememberedAuthKey,
  readAuthToken,
  writeAuthToken,
  clearAuthToken,
  expireAuthSession,
} = await vite.ssrLoadModule("/src/services/auth-session.ts");

test.after(async () => vite.close());

test("审核令牌过期会清除旧会话并通知界面返回登录状态", () => {
  const events = new EventTarget();
  const values = new Map([[authSessionKey, "expired-token"]]);
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    dispatchEvent: (event) => events.dispatchEvent(event),
  };
  let notified = false;
  events.addEventListener(authSessionExpiredEvent, () => {
    notified = true;
  });

  try {
    expireAuthSession();
    assert.equal(values.has(authSessionKey), false);
    assert.equal(notified, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

function storage(values = new Map()) {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("记住登录仅保存有到期时间的凭证，新标签可恢复，退出清理两种存储", () => {
  const previous = globalThis.window;
  const local = new Map();
  const tab = new Map();
  globalThis.window = { sessionStorage: storage(tab), localStorage: storage(local) };
  try {
    writeAuthToken("remembered-fixture-token", true, 60);
    assert.equal(tab.size, 0);
    assert.equal(readAuthToken(), "remembered-fixture-token");
    globalThis.window.sessionStorage = storage();
    assert.equal(readAuthToken(), "remembered-fixture-token");
    const saved = JSON.parse(local.get(rememberedAuthKey));
    assert.deepEqual(Object.keys(saved).sort(), ["expiresAt", "token"]);
    assert.ok(saved.expiresAt > Date.now());
    clearAuthToken();
    assert.equal(local.size, 0);
    assert.equal(readAuthToken(), "");
  } finally {
    globalThis.window = previous;
  }
});

test("普通登录不持久保存，过期和损坏的记住状态不能恢复", () => {
  const previous = globalThis.window;
  const local = new Map();
  const tab = new Map();
  globalThis.window = { sessionStorage: storage(tab), localStorage: storage(local) };
  try {
    writeAuthToken("tab-fixture-token");
    assert.equal(local.size, 0);
    assert.equal(tab.get(authSessionKey), "tab-fixture-token");
    tab.clear();
    for (const invalid of [
      "bad json",
      JSON.stringify({ token: "old", expiresAt: Date.now() - 1 }),
      JSON.stringify({ token: "no expiry" }),
    ]) {
      local.set(rememberedAuthKey, invalid);
      assert.equal(readAuthToken(), "");
    }
  } finally {
    globalThis.window = previous;
  }
});

test("持久存储被禁用时仍可使用当前标签登录并退出", () => {
  const previous = globalThis.window;
  const tab = new Map();
  globalThis.window = {
    sessionStorage: storage(tab),
    get localStorage() {
      throw new Error("Storage blocked");
    },
  };
  try {
    writeAuthToken("tab-fallback-fixture", true, 60);
    assert.equal(readAuthToken(), "tab-fallback-fixture");
    clearAuthToken();
    assert.equal(tab.size, 0);
  } finally {
    globalThis.window = previous;
  }
});
