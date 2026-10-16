import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { interpretDecisionTask, decisionScenario } = await vite.ssrLoadModule(
  "/src/domain/decision-workflow.ts",
);
test.after(() => vite.close());
const fixture = JSON.parse(await readFile("backend/data/decision_first_use_cases.v1.json", "utf8"));
const initial = (task) => ({
  task,
  taskType: "unspecified",
  priority: "quality",
  deployment: "undecided",
  budget: { mode: "unknown" },
  exclusions: [],
  candidateEntityIds: [],
});
for (const row of fixture.cases)
  test(`raw first-use request: ${row.id}`, () => {
    const context = interpretDecisionTask(initial(row.task));
    assert.equal(decisionScenario(context, "zh").id, row.scenario);
    for (const feature of row.features ?? [])
      assert.ok(decisionScenario(context, "zh").requiredFeatures.includes(feature));
    if (row.type) assert.equal(context.taskType, row.type);
    if (row.image) assert.ok(context.inputModalities.includes("image"));
    if (row.kind === "strict") {
      assert.equal(context.deployment, "on-device");
      assert.equal(context.minimumContextTokens, 2000000);
      assert.equal(context.commercialUseRequired, true);
    }
    assert.ok(!context.budget.channel);
  });

test("task actions outrank incidental topics and explicit scope remains authoritative", () => {
  assert.ok(
    decisionScenario(
      interpretDecisionTask(initial("选择文档问答模型，需要自带检索")),
      "zh",
    ).requiredFeatures.includes("retrieval"),
  );
  assert.ok(
    !decisionScenario(
      interpretDecisionTask(initial("选择文档问答模型，不需要自带检索")),
      "zh",
    ).requiredFeatures.includes("retrieval"),
  );
  assert.equal(
    decisionScenario(interpretDecisionTask(initial("RAG应用，检索已有，只选择底层模型")), "zh").id,
    "knowledge-assistant",
  );
  assert.ok(
    !decisionScenario(
      interpretDecisionTask(initial("Agent framework; human approval not required")),
      "en",
    ).requiredFeatures.includes("human-approval"),
  );
  for (const task of [
    "请起草一篇介绍 RAG 的文章，选择写作模型",
    "Draft an article about multi-agent orchestration using supplied facts",
  ])
    assert.equal(decisionScenario(interpretDecisionTask(initial(task)), "zh").id, "general-text");
  assert.equal(
    decisionScenario(
      interpretDecisionTask(initial("不要推荐编程工具，我只要能生成补丁的模型 API")),
      "zh",
    ).id,
    "coding-model",
  );
  assert.equal(
    decisionScenario({ ...initial("选择代码模型"), taskType: "coding-product" }, "zh").id,
    "coding-workspace",
  );
  assert.ok(
    !decisionScenario(
      interpretDecisionTask(initial("把合同字段转成 JSON，输入已经转成纯文本")),
      "zh",
    ).requiredFeatures.includes("document-input"),
  );
});
