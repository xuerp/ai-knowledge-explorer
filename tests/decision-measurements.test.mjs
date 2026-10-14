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
const { createValidationPlan, validationMarkdown } = await vite.ssrLoadModule(
  "/src/domain/decision-workflow.ts",
);
const { decisionReportHtml } = await vite.ssrLoadModule("/src/domain/decision-report-html.ts");
const { validationReviewReading } = await vite.ssrLoadModule(
  "/src/domain/decision-validation-review.ts",
);
const { groupValidationItems, fillCandidateConditions, patchValidationItem } =
  await vite.ssrLoadModule("/src/domain/decision-validation-view.ts");
test.after(() => vite.close());

test("consecutive field updates merge current state instead of overwriting earlier conditions and measurements", () => {
  let row = { id: "a-quality", title: "task", status: "pending", result: "" };
  for (const [key, value] of Object.entries({
    modelVersion: "v1",
    configuration: "fixture",
    sampleCount: 12,
    testedAt: "2026-10-12",
    scope: "same cases",
  }))
    row = patchValidationItem(row, { testConditions: { [key]: value } });
  row = patchValidationItem(row, { measurements: { successfulSamples: 10 } });
  row = patchValidationItem(row, { measurements: { minimumSuccessfulSamples: 8 } });
  assert.equal(row.testConditions.modelVersion, "v1");
  assert.equal(row.testConditions.sampleCount, 12);
  assert.equal(row.testConditions.scope, "same cases");
  assert.deepEqual(row.measurements, { successfulSamples: 10, minimumSuccessfulSamples: 8 });
});
test("reusing confirmed settings preserves evidence and cannot mark untested work passed", () => {
  const rows = [
    {
      id: "a-quality",
      candidateId: "a",
      status: "pending",
      result: "",
      testConditions: {
        modelVersion: "A",
        configuration: "shared",
        sampleCount: 12,
        testedAt: "2026-10-12",
        scope: "samples",
      },
    },
    {
      id: "a-cost",
      candidateId: "a",
      status: "pending",
      result: "cost not measured",
      measurements: { totalCost: 0 },
      testConditions: {
        modelVersion: "A-other",
        configuration: "",
        sampleCount: 50,
        testedAt: "",
        scope: "",
      },
    },
    {
      id: "b-terms",
      candidateId: "b",
      status: "pending",
      result: "",
      testConditions: {
        modelVersion: "",
        configuration: "",
        sampleCount: null,
        testedAt: "",
        scope: "",
      },
    },
  ];
  const before = structuredClone(rows);
  const filled = fillCandidateConditions(rows, "a-quality");
  assert.equal(filled[1].testConditions.modelVersion, "A-other");
  assert.equal(filled[1].testConditions.sampleCount, 50);
  assert.equal(filled[1].testConditions.configuration, "shared");
  assert.equal(filled[1].status, "pending");
  assert.equal(filled[1].result, "cost not measured");
  assert.deepEqual(filled[2], before[2]);
  assert.deepEqual(rows, before);
});
const protocol = {
  sample: "same approved samples",
  procedure: ["compare"],
  metrics: ["cost"],
  acceptance: ["task pass"],
  executed: false,
};
const research = {
  id: "isolated",
  question: "text generation",
  createdAt: "2026-10-12",
  citations: [],
  decisionContext: {
    task: "text generation",
    priority: "cost",
    deployment: "undecided",
    budget: { mode: "unknown" },
    exclusions: [],
    inputModalities: [],
    candidateEntityIds: [],
    taskType: "model-api",
    commercialUseRequired: false,
  },
  decision: {
    status: "insufficient-evidence",
    asOf: "2026-10-12",
    conditions: [],
    missingInputs: [],
    risks: [],
    nextChecks: [],
    tradeoffs: [],
    comparisons: [],
    recommendation: { summary: "fixture", reasons: [], alternativeEntityIds: [] },
    scenario: {
      id: "general-text",
      name: "text",
      requiredFeatures: ["text-generation"],
      clarificationChecks: [],
    },
    candidates: ["a", "b", "unknown"].map((entityId) => ({
      entityId,
      eligibility: "eligible",
      strengths: [],
      gaps: [],
      reasons: [],
      requiredDimensions: [],
      coveredDimensions: [],
    })),
    plan: {
      state: "ready-to-validate",
      canDecide: "trial",
      actions: [],
      trialCandidateIds: ["a", "b"],
      trial: protocol,
    },
  },
};
test("new business checklists use qualified and explicitly selected candidates and retain the full unexecuted protocol", () => {
  const before = structuredClone(research);
  const plan = createValidationPlan(research, ["b"]);
  assert.equal(plan.length, 4);
  assert.ok(
    plan.every((row) => row.candidateId === "b" && row.status === "pending" && row.result === ""),
  );
  assert.deepEqual(plan.find((row) => row.id.endsWith("quality")).suggestedProtocol, protocol);
  assert.deepEqual(research, before);
  assert.deepEqual(createValidationPlan(research, []), []);
  const blocked = structuredClone(research);
  blocked.decision.plan.state = "needs-evidence";
  blocked.decision.plan.trialCandidateIds = [];
  assert.ok(createValidationPlan(blocked).every((row) => row.id.endsWith("terms")));
  const qualification = createValidationPlan(blocked, ["unknown"]);
  assert.equal(qualification.length, 1);
  assert.equal(qualification[0].candidateId, "unknown");
  assert.ok(qualification[0].id.endsWith("terms"));
  for (const state of ["needs-input", "all-excluded", "no-candidates", "failed"]) {
    blocked.decision.plan.state = state;
    assert.deepEqual(createValidationPlan(blocked), []);
  }
});

test("quality counts and predeclared thresholds survive both private exports and use their own hierarchy", () => {
  const item = {
    id: "a-quality",
    candidateId: "a",
    title: "quality",
    status: "passed",
    result: "synthetic only",
    measurements: { successfulSamples: 10, minimumSuccessfulSamples: 8 },
  };
  for (const content of [
    validationMarkdown(research, [item], String, true),
    decisionReportHtml(research, [item], String, true, "zh"),
  ]) {
    assert.match(content, /本批合格样本数/);
    assert.match(content, /最低合格样本数/);
  }
});
test("zero measurements are recorded, unknown values stay blank, and unsafe source prose is escaped in HTML", () => {
  const item = {
    id: "a-cost",
    candidateId: "a",
    title: "cost",
    status: "pending",
    result: "",
    measurements: {
      totalCost: 0,
      currency: "USD",
      costBasis: "actual-charge",
      sourceNote: "<script>alert(1)</script>",
    },
  };
  assert.equal(groupValidationItems([item])[0].recorded, true);
  const html = decisionReportHtml(research, [item], String, false, "zh");
  const md = validationMarkdown(research, [item], String, false);
  assert.match(html, /0 USD/);
  assert.match(md, /0 USD/);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("single numeric records qualify a scoped trial without claiming a comparison winner", () => {
  const review = {
    sourceRevision: 1,
    basis: "user-records",
    candidates: [],
    comparableGroups: [],
    conclusion: {
      status: "limited-fit",
      trialCandidateIds: ["a"],
      findings: [],
      measuredChoices: [
        {
          priority: "cost",
          metric: "total-cost",
          unit: "USD",
          values: { a: 0 },
          candidateIds: ["a"],
          itemIds: ["a-cost"],
          configuration: "same fixture",
          scope: "approved samples",
          sampleCount: 12,
          testDate: "2026-10-12",
          basis: "user-declared-actual-measurements",
        },
      ],
    },
  };
  const reading = validationReviewReading(review, String, "zh");
  assert.match(reading.conclusion.action, /不能判断比其他候选更好/);
  assert.match(reading.conclusion.action, /USD/);
  assert.match(validationMarkdown(research, [], String, true, review), /approved samples/);
  assert.match(decisionReportHtml(research, [], String, true, "zh", review), /approved samples/);
  assert.match(
    decisionReportHtml(research, [], String, true, "zh", review),
    /class="numeric-table"/,
  );
  assert.match(
    decisionReportHtml(research, [], String, true, "zh", review),
    /<td><strong>a<\/strong><\/td><td><strong>0<\/strong>/,
  );
});
