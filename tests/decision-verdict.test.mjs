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
const { decisionVerdict } = await vite.ssrLoadModule("/src/domain/decision-verdict.ts");
const { candidateRecordMode } = await vite.ssrLoadModule("/src/domain/decision-choice.ts");
const { createValidationPlan } = await vite.ssrLoadModule("/src/domain/decision-workflow.ts");
test.after(() => vite.close());
const name = (id) => ({ a: "Alpha", b: "Beta" })[id] ?? id;
const research = {
  id: "r",
  question: "choose",
  summary: "facts",
  decisionContext: { task: "choose", priority: "quality" },
  decision: {
    status: "ready",
    conditions: [],
    risks: [],
    nextChecks: [],
    recommendation: {
      primaryEntityId: "a",
      basis: "validation-sequence",
      summary: "not performance",
      alternativeEntityIds: [],
    },
    plan: { state: "ready-to-validate", trialCandidateIds: ["a", "b"], actions: [] },
    candidates: ["a", "b"].map((entityId) => ({
      entityId,
      eligibility: "eligible",
      reasons: [],
      strengths: [],
      gaps: [],
    })),
  },
};
const measured = {
  candidateIds: ["a"],
  priority: "quality",
  metric: "successful-samples",
  values: { a: 10, b: 8 },
  sampleCount: 12,
  minimumSuccessfulSamples: 8,
  testDate: "2026-10-13",
  scope: "fictional same samples",
  configuration: "same fixture",
  unit: "passed / 12",
  itemIds: ["a-quality", "b-quality"],
};
const validation = (choices = [measured]) => ({
  researchId: "r",
  revision: 2,
  items: [{ id: "a-quality", status: "passed", result: "synthetic software test" }],
  review: {
    sourceRevision: 2,
    candidates: [],
    comparableGroups: [],
    conclusion: {
      status: "limited-fit",
      trialCandidateIds: ["a"],
      measuredChoices: structuredClone(choices),
      findings: [
        {
          candidateId: "a",
          outcome: "limited-fit",
          itemIds: ["a-quality"],
          scope: "fictional same samples",
          modelVersion: "v1",
        },
      ],
    },
  },
});

test("public trial eligibility names candidates without converting verification order into a performance choice", () => {
  const view = decisionVerdict(research, null, name, "zh");
  assert.equal(view.headline, "可先试用：Alpha、Beta");
  assert.equal(view.source, "public");
  assert.match(view.boundary, /尚未证明.*业务效果/);
  assert.doesNotMatch(view.headline, /最佳|本批建议/);
});

test("a sole qualified existing product retains the server's task-specific next decision", () => {
  const row = structuredClone(research);
  row.decision.plan.trialCandidateIds = ["a"];
  row.decision.recommendation.summary = "先用已有入口完成小修复，暂不急着换工具；没有跨产品实测。";
  const view = decisionVerdict(row, null, name, "zh");
  assert.equal(view.summary, row.decision.recommendation.summary);
  assert.equal(view.source, "public");
  assert.doesNotMatch(view.headline, /最佳|本批建议/);
});

test("task clarification is not described as missing market evidence or repeated as the next step", () => {
  const row = structuredClone(research);
  row.decision.scenario = { id: "unspecified", requiredFeatures: [] };
  row.decision.plan = {
    state: "needs-input",
    trialCandidateIds: [],
    actions: [{ kind: "clarify", instruction: "先选一件事" }],
  };
  row.decision.candidates = [];
  row.decision.recommendation.summary = "先从 Excel、资料和周报中选一件。";
  const view = decisionVerdict(row, null, name, "zh");
  assert.equal(view.headline, "先选一件具体工作");
  assert.notEqual(view.summary, view.next);
  assert.match(view.next, /在任务描述里补一句/);
  assert.match(view.boundary, /尚未进行候选筛选/);
});
test("saved matching measurements produce a scoped primary verdict, with real values and source boundary", () => {
  const record = validation();
  const before = structuredClone(record);
  const view = decisionVerdict(research, record, name, "zh");
  assert.equal(view.headline, "本批建议：Alpha");
  assert.match(view.summary, /Alpha 10\/12.*Beta 8\/12/);
  assert.match(view.boundary, /私人记录.*fictional same samples/);
  assert.match(view.next, /已测范围/);
  assert.deepEqual(record, before);
});
test("ties remain ties; a single measured candidate never becomes a comparative winner", () => {
  const tie = decisionVerdict(
    research,
    validation([{ ...measured, candidateIds: ["a", "b"], values: { a: 10, b: 10 } }]),
    name,
    "en",
  );
  assert.equal(tie.headline, "Tie for this batch: Alpha, Beta");
  const single = decisionVerdict(
    research,
    validation([{ ...measured, values: { a: 10 } }]),
    name,
    "zh",
  );
  assert.equal(single.headline, "已测范围可试用：Alpha");
  assert.match(single.summary, /本批记录的合格样本数.*Alpha 10\/12.*最低合格 8/);
  assert.doesNotMatch(single.summary, /比较/);
  assert.match(single.boundary, /不能判断优于/);
});
test("incompatible groups cannot be collapsed into a globally ranked primary", () => {
  const view = decisionVerdict(
    research,
    validation([measured, { ...measured, candidateIds: ["b"], scope: "other samples" }]),
    name,
    "zh",
  );
  assert.equal(view.headline, "不同测试口径分别选，暂不合并主选");
  assert.doesNotMatch(view.headline, /本批建议/);
});
test("stale revisions, another research and empty pending plans cannot drive the private verdict", () => {
  for (const record of [
    { ...validation(), researchId: "other" },
    { ...validation(), revision: 3 },
    { ...validation(), items: [{ id: "a-quality", status: "pending", result: "" }] },
  ])
    assert.equal(decisionVerdict(research, record, name, "en").source, "public");
});
test("entry failure, failed task and priority gaps retain actionable blocks instead of trial advice", () => {
  for (const [outcome, status, expected] of [
    ["entry-unverified", "insufficient-tests", /入口.*模型版本.*数据条款/],
    ["tested-fail", "no-tested-fit", /未通过/],
    ["limited-fit", "priority-unverified", /首要优先项/],
  ]) {
    const record = validation([]);
    record.review.conclusion.status = status;
    record.review.conclusion.trialCandidateIds = [];
    record.review.conclusion.findings[0].outcome = outcome;
    const view = decisionVerdict(research, record, name, "zh");
    assert.doesNotMatch(view.headline, /本批建议|已测范围可试用/);
    assert.match(view.next + view.headline, expected);
    assert.equal(view.action, "records");
  }
});
test("unknown and excluded candidates never appear in the trial headline; the next source action stays concrete", () => {
  const row = structuredClone(research);
  row.decision.plan.state = "needs-evidence";
  row.decision.plan.actions = [{ instruction: "核对该版本的部署入口", kind: "source" }];
  row.decision.candidates[0].eligibility = "excluded";
  row.decision.candidates[1].eligibility = "unknown";
  const view = decisionVerdict(row, null, name, "zh");
  assert.equal(view.headline, "还不能确定哪款符合你的全部要求");
  assert.match(view.next, /缺项资料/);
  assert.match(view.next, /保留原要求重新分析/);
  assert.doesNotMatch(view.next, /审核|收录/);
});

test("unknown candidates get only qualification notes, and cannot silently receive business checks", () => {
  const row = structuredClone(research);
  row.decision.plan.state = "needs-evidence";
  row.decision.plan.trialCandidateIds = [];
  row.decision.candidates.forEach((candidate) => (candidate.eligibility = "unknown"));
  assert.equal(candidateRecordMode(row, ["a", "b"]), "qualification");
  const notes = createValidationPlan(row, ["a", "b"]);
  assert.deepEqual(
    notes.map((item) => item.id),
    ["a-terms", "b-terms"],
  );
  assert.ok(notes.every((item) => item.status === "pending" && item.result === ""));
  for (const state of ["needs-input", "all-excluded", "conflict", "failed"])
    assert.equal(
      candidateRecordMode(
        { ...row, decision: { ...row.decision, plan: { ...row.decision.plan, state } } },
        ["a"],
      ),
      null,
    );
});
test("trial selection rejects missing, conflicting, overfull or mixed unqualified IDs", () => {
  assert.equal(candidateRecordMode(research, ["a", "b"]), "business");
  assert.equal(candidateRecordMode(research, ["a", "a"]), null);
  assert.equal(candidateRecordMode(research, ["missing"]), null);
  assert.equal(candidateRecordMode(research, ["a", "b", "c", "d"]), null);
  const row = structuredClone(research);
  row.decision.candidates[1].eligibility = "unknown";
  assert.equal(candidateRecordMode(row, ["a", "b"]), null);
});

test("qualification-only records never become task advice, but recorded entry blockers stay prominent", () => {
  const record = validation([]);
  record.review.conclusion.status = "insufficient-tests";
  record.review.conclusion.trialCandidateIds = [];
  record.review.conclusion.findings[0].outcome = "unverified";
  record.items = [
    { id: "a-terms", candidateId: "a", status: "passed", result: "qualification only" },
  ];
  assert.equal(decisionVerdict(research, record, name, "zh").source, "public");
  record.items[0].status = "blocked";
  const view = decisionVerdict(research, record, name, "zh");
  assert.equal(view.headline, "先解决实际入口与使用条件");
  assert.match(view.summary, /Alpha.*qualification only/);
  assert.match(view.boundary, /不是业务效果成绩/);
  assert.equal(view.action, "records");
});
