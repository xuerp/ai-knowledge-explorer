import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { resolveComparisonSelection } = await vite.ssrLoadModule("/src/lib/comparison-selection.ts");

test.after(async () => vite.close());

const models = [
  { id: "e-gpt", type: "model" },
  { id: "e-gpt-5", type: "model", familyId: "e-gpt" },
  { id: "e-claude", type: "model" },
  { id: "e-claude-45", type: "model", familyId: "e-claude" },
];

test("mixed research candidates normalize to comparable model families", () => {
  assert.deepEqual(resolveComparisonSelection("e-gpt-5,e-claude", models), {
    scope: "families",
    selected: ["e-gpt", "e-claude"],
  });
});

test("an all-version deep link keeps concrete version comparison", () => {
  assert.deepEqual(resolveComparisonSelection("e-gpt-5,e-claude-45", models), {
    scope: "versions",
    selected: ["e-gpt-5", "e-claude-45"],
  });
});
