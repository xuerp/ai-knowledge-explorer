import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { decisionTrialKit, requestableEvidenceCandidates } = await vite.ssrLoadModule(
  "/src/domain/decision-trial-kit.ts",
);
test.after(() => vite.close());
const fixture = () => ({
  id: "isolated-fixture",
  question: "提取真实提供的字段",
  citations: [],
  decisionContext: { task: "提取真实提供的字段", candidateEntityIds: [] },
  decision: {
    conditions: ["云 API", "上下文至少 100000 token"],
    scenario: { requiredFeatures: ["structured-output"] },
    candidates: [
      {
        entityId: "a",
        eligibility: "eligible",
        strengths: [{ dimension: "structured-output", finding: "Fixture", claimIds: [] }],
        gaps: [],
      },
    ],
    plan: {
      state: "ready-to-validate",
      trialCandidateIds: ["a"],
      trial: {
        sample: "提供实际样本，先标注必需字段",
        procedure: ["按实际文件逐字段核对"],
        metrics: ["真实合格样本数"],
        acceptance: ["不得虚构字段"],
        executed: false,
      },
    },
  },
});

test("trial kit retains actual requirements and protocol without populating measured results", () => {
  const research = fixture();
  const kit = decisionTrialKit(research, ["a"], () => "Candidate A", "zh");
  assert.match(kit.markdown, /云 API/);
  assert.match(kit.prompt, /上下文至少 100000 token/);
  assert.match(kit.prompt, /不要回答选哪个产品/);
  assert.match(kit.prompt, /按实际文件逐字段核对/);
  assert.match(kit.markdown, /提供实际样本/);
  assert.match(kit.markdown, /不得虚构字段/);
  assert.match(kit.markdown, /待执行方案，不包含实测成绩/);
  assert.equal(research.decision.plan.trial.executed, false);
  assert.equal("measurements" in research, false);
  assert.match(decisionTrialKit(research, ["a"], () => "A", "en").markdown, /Unexecuted protocol/);
});

test("unknown, excluded, conflicting, stale and out-of-scope candidates cannot obtain a business kit", () => {
  for (const eligibility of ["unknown", "excluded", "conflict"]) {
    const research = fixture();
    research.decision.candidates[0].eligibility = eligibility;
    assert.equal(decisionTrialKit(research, ["a"], String, "zh"), null);
  }
  const research = fixture();
  assert.equal(decisionTrialKit(research, ["outside"], String, "zh"), null);
  assert.equal(decisionTrialKit(research, [], String, "zh"), null);
  research.citationStates = { source: "withdrawn" };
  assert.equal(decisionTrialKit(research, ["a"], String, "zh"), null);
});

test("source requests separate missing facts from actual business tests and input clarifications", () => {
  const research = fixture();
  research.decision.candidates = [
    {
      entityId: "missing",
      eligibility: "unknown",
      gaps: [{ reason: "not-recorded", dimension: "context" }],
    },
    {
      entityId: "conflict",
      eligibility: "conflict",
      gaps: [{ reason: "conflicting", dimension: "deployment" }],
    },
    {
      entityId: "poc",
      eligibility: "eligible",
      gaps: [{ reason: "requires-poc", dimension: "task-quality" }],
    },
    {
      entityId: "input",
      eligibility: "unknown",
      gaps: [{ reason: "needs-input", dimension: "budget" }],
    },
    {
      entityId: "excluded",
      eligibility: "excluded",
      gaps: [{ reason: "not-recorded", dimension: "context" }],
    },
  ];
  assert.deepEqual(
    requestableEvidenceCandidates(research).map((row) => row.entityId),
    ["missing", "conflict"],
  );
});

test("cost assumptions survive reanalysis/login links without silently changing total-cost requirements", async () => {
  const { decisionResumePath, decisionFingerprint } = await vite.ssrLoadModule(
    "/src/domain/decision-workflow.ts",
  );
  const context = {
    task: "文档信息抽取选择模型",
    taskType: "model-api",
    priority: "cost",
    deployment: "cloud-api",
    exclusions: [],
    candidateEntityIds: ["a"],
    budget: {
      mode: "range",
      max: 18,
      currency: "USD",
      channel: "fixture-official",
      period: "month",
      monthlyInputTokens: 1000000,
      monthlyOutputTokens: 1000000,
      costScope: "standard-token-only",
      maximumInputTokensPerRequest: 200000,
    },
  };
  const path = new URL(decisionResumePath(context), "http://localhost");
  assert.equal(path.searchParams.get("costScope"), "standard-token-only");
  assert.equal(path.searchParams.get("maximumInputPerRequest"), "200000");
  assert.notEqual(
    decisionFingerprint(context),
    decisionFingerprint({ ...context, budget: { ...context.budget, costScope: "all-costs" } }),
  );
});
