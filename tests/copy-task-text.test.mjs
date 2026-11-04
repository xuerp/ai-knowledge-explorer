import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { copyTaskText } = await vite.ssrLoadModule("/src/lib/copy-task-text.ts");
test.after(() => vite.close());

test("task copying reports success only after the original text has been written", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const original = "中文任务\nOriginal constraints, sources, and next delivery requirements.";
  let written;
  let selected = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text) => {
          written = text;
        },
      },
    },
  });
  try {
    assert.equal(
      await copyTaskText(original, {
        focus() {},
        select() {
          selected = true;
        },
      }),
      true,
    );
    assert.equal(written, original);
    assert.equal(selected, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
});

test("denied or unavailable clipboard access selects the whole existing field for recovery", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    for (const navigator of [
      {
        clipboard: {
          writeText: async () => {
            throw new DOMException("Document is not focused", "NotAllowedError");
          },
        },
      },
      {},
    ]) {
      const actions = [];
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
      assert.equal(
        await copyTaskText("original task", {
          focus: () => actions.push("focus"),
          select: () => actions.push("select"),
        }),
        false,
      );
      assert.deepEqual(actions, ["focus", "select"]);
      assert.equal(await copyTaskText("original task", null), false);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
});
