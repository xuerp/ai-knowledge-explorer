import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { authSessionExpiredEvent, authSessionKey, expireAuthSession } = await vite.ssrLoadModule(
  "/src/services/auth-session.ts",
);

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
