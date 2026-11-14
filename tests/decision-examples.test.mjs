import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  configFile: false,
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { decisionExamples, decisionStarters, decisionExampleContext } = await vite.ssrLoadModule(
  "/src/domain/decision-examples.ts",
);
const { decisionInputConflicts, interpretDecisionTask, decisionScenario } =
  await vite.ssrLoadModule("/src/domain/decision-workflow.ts");
test.after(() => vite.close());

test("scenario templates carry matching conditions and stay consistent after interpretation in both languages", () => {
  for (const example of decisionExamples) {
    for (const lang of ["zh", "en"]) {
      const context = decisionExampleContext(example, lang);
      assert.deepEqual(decisionInputConflicts(context), [], example.id + lang);
      const interpreted = interpretDecisionTask(context);
      assert.equal(interpreted.taskType, context.taskType, example.id + lang);
      assert.equal(interpreted.deployment, context.deployment, example.id + lang);
      assert.notEqual(decisionScenario(context, lang).id, "unspecified", example.id + lang);
    }
  }
});

test("newcomer starters cover the seven supported tasks without inventing capacity, hosting or budgets", () => {
  const expectedScenarios = {
    coding: "coding-workspace",
    knowledge: "knowledge-workspace",
    career: "career-assistant",
    extraction: "document-extraction",
    agent: "agent-orchestration",
    writing: "general-text",
    "coding-api": "coding-model",
  };
  assert.deepEqual(
    decisionStarters.map(({ id }) => id).sort(),
    Object.keys(expectedScenarios).sort(),
  );
  for (const example of decisionStarters) {
    for (const lang of ["zh", "en"]) {
      const context = decisionExampleContext(example, lang);
      assert.equal(context.deployment, "undecided");
      assert.equal(context.minimumContextTokens, undefined);
      assert.deepEqual(context.inputModalities, []);
      assert.deepEqual(context.budget, { mode: "unknown" });
      assert.deepEqual(decisionInputConflicts(context), []);
      const interpreted = interpretDecisionTask(context);
      assert.equal(interpreted.taskType, context.taskType);
      assert.equal(interpreted.deployment, "undecided");
      const scene = decisionScenario(context, lang);
      assert.equal(scene.id, expectedScenarios[example.id], example.id + lang);
    }
  }
});

test("switching from long-context API to coding clears API and version constraints without mutating templates", () => {
  const api = decisionExampleContext(decisionExamples[1], "zh");
  assert.equal(api.minimumContextTokens, 100000);
  api.candidateEntityIds.push("old-version");
  api.budget.max = 500;
  api.exclusions.push("old exclusion");
  const coding = decisionExampleContext(decisionExamples[0], "zh");
  assert.equal(coding.minimumContextTokens, undefined);
  assert.equal(coding.deployment, "undecided");
  assert.deepEqual(coding.budget, { mode: "unknown" });
  assert.deepEqual(coding.candidateEntityIds, []);
  assert.deepEqual(coding.exclusions, []);
  assert.deepEqual(coding.inputModalities, []);
  const fresh = decisionExampleContext(decisionExamples[1], "zh");
  assert.deepEqual(fresh.budget, { mode: "unknown" });
  assert.deepEqual(fresh.exclusions, []);
  assert.deepEqual(fresh.candidateEntityIds, []);
});
