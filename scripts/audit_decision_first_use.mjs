// Exercise the actual browser-side recognizer; no examples prefill hidden conditions.
import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const file = process.argv[2];
if (!file) throw new Error("Provide an output path");
const fixture = JSON.parse(await readFile("backend/data/decision_first_use_cases.v1.json", "utf8"));
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
try {
  const { interpretDecisionTask, decisionScenario } = await vite.ssrLoadModule(
    "/src/domain/decision-workflow.ts",
  );
  const cases = fixture.cases.map((row) => {
    const context = interpretDecisionTask({
      workflowVersion: 2,
      task: row.task,
      taskType: "unspecified",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
      candidateEntityIds: [],
    });
    const scenario = decisionScenario(context, "zh");
    return {
      ...row,
      context,
      frontendScenario: scenario.id,
      frontendFeatures: scenario.requiredFeatures,
    };
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ basis: fixture.basis, cases }, null, 2) + "\n");
  console.log(
    JSON.stringify({
      total: cases.length,
      recognized: cases.filter((row) => row.frontendScenario === row.scenario).length,
      output: file,
    }),
  );
} finally {
  await vite.close();
}
