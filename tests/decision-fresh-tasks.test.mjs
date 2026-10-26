import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  configFile: false,
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { scenarioDefinition } = await vite.ssrLoadModule("/src/domain/decision-intent.ts");
test.after(() => vite.close());
const cases = JSON.parse(
  fs.readFileSync("backend/data/decision_holdout_20261019.json", "utf8"),
).cases;
for (const row of cases.filter((row) => row.scenario)) {
  test(`shared browser task routing ${row.id}`, () => {
    assert.equal(scenarioDefinition({ task: row.task, taskType: "unspecified" })?.id, row.scenario);
  });
}
