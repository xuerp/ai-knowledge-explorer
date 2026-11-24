import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
test.after(() => vite.close());
const { modelLedSections, screeningReason } = await vite.ssrLoadModule(
  "/src/domain/model-led-reading.ts",
);
const { decisionReportHtml } = await vite.ssrLoadModule("/src/domain/decision-report-html.ts");
const { researchOutcomeLabel } = await vite.ssrLoadModule("/src/domain/decision-presentation.ts");

const line = (text, basis = "model-knowledge", claimIds = []) => ({ basis, text, claimIds });
const analysis = {
  understoodTask: "在单卡 A100 上微调开源小模型",
  headline: "优先核实 GLM 的小尺寸开源版本",
  summary: line("先做一轮 LoRA 验证。"),
  candidates: [
    {
      entityId: "e-glm",
      role: "primary",
      points: [line("中文能力较好。"), line("已核验事实。", "verified", ["c-1"])],
    },
  ],
  tradeoffs: [line("小模型更易微调。")],
  gaps: [],
  firstSteps: [line("整理 200 张工单。")],
  pruned: [
    { section: "candidates", entityId: "e-old", reason: "hard-requirement:unavailable-version" },
  ],
};
const research = {
  id: "r1",
  question: "q",
  summary: "s",
  claimIds: ["c-1"],
  steps: [],
  status: "ready",
  citations: [],
  retrievalMode: "lexical",
  answerMode: "generated",
  retrievalDiagnostics: {
    candidateCount: 0,
    returnedCount: 0,
    filteredCount: 0,
    elapsedMs: 0,
    matchedEntityIds: [],
  },
  decisionContext: {
    workflowVersion: 2,
    task: "微调开源模型",
    priority: "balanced",
    deployment: "undecided",
    budget: { mode: "unknown" },
    exclusions: [],
    candidateEntityIds: [],
  },
  decision: {
    status: "ready",
    asOf: "2026-11-23T00:00:00Z",
    recommendation: { alternativeEntityIds: [], summary: "规则摘要" },
    conditions: [],
    tradeoffs: [],
    risks: [],
    nextChecks: [],
    claimIds: [],
    candidates: [],
    modelLed: analysis,
    guidance: {
      schemaVersion: 2,
      outcome: "clarify",
      intent: [],
      tasks: [],
      answered: [],
      clarification: {
        id: "task-focus",
        question: "你想先把哪类工作交给 AI？",
        reason: "目前还不能确定你要完成的工作。",
        options: [],
      },
      recommendation: {
        headline: "规则标题",
        summary: "规则摘要",
        entityIds: [],
        reasons: [],
        premises: [],
      },
      unknowns: [],
      nextAction: {
        kind: "answer",
        label: "",
        targetIds: [],
        location: "this-page",
        instruction: "",
      },
    },
  },
  createdAt: "2026-11-23T00:00:00Z",
};

test("model knowledge is labelled in every exported line; verified lines keep citations", () => {
  const sections = modelLedSections(analysis, (id) => id, "zh");
  const lines = sections.flatMap((section) => section.lines);
  assert.ok(
    lines.some((row) => row.text === "中文能力较好。（模型常识，未核验）" && !row.claimIds.length),
  );
  assert.ok(lines.some((row) => row.text === "已核验事实。" && row.claimIds[0] === "c-1"));
  assert.ok(
    !sections.some((section) => section.title === "还需要确认"),
    "empty sections are omitted",
  );
});

test("HTML export shows the model analysis, not the contradictory rule clarification", () => {
  const html = decisionReportHtml(research, [], (id) => id, true, "zh");
  assert.match(html, /优先核实 GLM 的小尺寸开源版本/);
  assert.match(html, /模型常识，未核验/);
  assert.doesNotMatch(html, /你想先把哪类工作交给 AI/);
  assert.doesNotMatch(html, /目前还不能确定你要完成的工作/);
});

test("status label prefers the validated model analysis", () => {
  assert.equal(researchOutcomeLabel(research, "zh"), "模型分析已生成");
});

test("only real hard-requirement removals produce a readable exclusion reason", () => {
  assert.equal(
    screeningReason("hard-requirement:unavailable-version", "zh"),
    "版本已退役或尚未发布",
  );
  assert.equal(
    screeningReason("hard-requirement:excluded,over-budget", "zh"),
    "符合你的排除条件；已核验价格超出你的预算",
  );
  // Statement-level pruning is not a candidate exclusion and shows nothing.
  assert.equal(screeningReason("model-knowledge-specific-value", "zh"), null);
  assert.equal(screeningReason("hard-requirement:unknown-code", "zh"), null);
});
