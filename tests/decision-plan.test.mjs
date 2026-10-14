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
const { decisionPlanSections, trialQualificationLabel } = await vite.ssrLoadModule(
  "/src/domain/decision-plan-reading.ts",
);
const { decisionReportHtml } = await vite.ssrLoadModule("/src/domain/decision-report-html.ts");
const { decisionMarkdown } = await vite.ssrLoadModule("/src/domain/decision-workflow.ts");
const { decisionPresentation } = await vite.ssrLoadModule("/src/domain/decision-presentation.ts");
test.after(() => vite.close());

const plan = {
  state: "needs-evidence",
  canDecide: "Known descriptions; verify terms first",
  trialCandidateIds: [],
  actions: [
    {
      id: "missing:deployment",
      kind: "source",
      title: "Verify deployment",
      instruction: "Inspect exact-version terms <script>alert(1)</script>",
      unlocks: "Reanalyze before a trial",
      candidateIds: ["a"],
      dimensions: ["deployment"],
      claimIds: [],
    },
  ],
  trial: {
    executed: false,
    sample: "Same documents",
    procedure: ["Fix configuration"],
    metrics: ["Error rate"],
    acceptance: ["Zero invented fields"],
  },
};
const research = {
  id: "local",
  question: "Text generation",
  summary: "Old summary",
  createdAt: "2026-10-11",
  citations: [],
  decision: {
    plan,
    status: "insufficient-evidence",
    asOf: "2026-10-11",
    candidates: [],
    conditions: [],
    tradeoffs: [],
    comparisons: [],
    risks: [],
    nextChecks: ["generic filler"],
    claimIds: [],
    recommendation: { summary: "Known descriptions", alternativeEntityIds: [] },
  },
};

test("exports preserve the same evidence-gated plan, unexecuted protocol and readable targets", () => {
  const sections = decisionPlanSections(plan, () => "Candidate A", "en");
  const text = sections.flatMap((section) => section.lines).join(" ");
  assert.match(text, /Candidate A/);
  assert.match(text, /Deployment/);
  assert.match(text, /Verify required eligibility and sources/);
  const md = decisionMarkdown(research, () => "Candidate A");
  const html = decisionReportHtml(research, [], () => "Candidate A", true, "en");
  for (const value of [md, html]) {
    assert.match(value, /Same documents/);
    assert.match(value, /Zero invented fields/);
    assert.doesNotMatch(value, /generic filler/);
    assert.ok(
      value.indexOf("Known descriptions; verify terms first") < value.indexOf("Same documents"),
    );
  }
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("the main action uses the actual next gate and legacy records still render", () => {
  assert.equal(decisionPresentation(research, "en").action, plan.canDecide);
  assert.match(decisionPresentation(research, "en").headline, /Verify required evidence/);
  const legacy = structuredClone(research);
  delete legacy.decision.plan;
  assert.equal(decisionPlanSections(undefined, () => "a", "en").length, 0);
  assert.match(
    decisionMarkdown(legacy, () => "a"),
    /generic filler/,
  );
});

test("constraints alone do not label missing business features as trial-qualified", () => {
  const value = structuredClone(research.decision);
  value.scenario = { requiredFeatures: ["file-editing", "test-execution"] };
  value.candidates = [
    { entityId: "partial", eligibility: "eligible", strengths: [{ dimension: "file-editing" }] },
    {
      entityId: "qualified",
      eligibility: "eligible",
      strengths: [{ dimension: "file-editing" }, { dimension: "test-execution" }],
    },
  ];
  value.plan.trialCandidateIds = ["qualified"];
  assert.equal(trialQualificationLabel(value, "partial", "en"), "Required features unverified");
  assert.equal(trialQualificationLabel(value, "qualified", "en"), "Ready for a business trial");
  assert.equal(trialQualificationLabel(value, "partial", "zh"), "必要功能待核验");
});
