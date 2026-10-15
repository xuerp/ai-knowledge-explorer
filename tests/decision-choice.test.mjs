import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const vite = await createServer({
  configFile: false,
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const {
  decisionChoices,
  decisionVisibleChoices,
  decisionComparisonRows,
  refreshDecision,
  candidateEvidenceStatus,
} = await vite.ssrLoadModule("/src/domain/decision-choice.ts");
test.after(() => vite.close());

test("candidate states distinguish knowledge-base gaps, stale evidence and user input without implying online absence", () => {
  const labels = {
    "not-recorded": "知识库缺少相关依据",
    "not-structured": "已有资料尚未整理为选型依据",
    "not-current": "知识库依据需重新核验",
    "needs-input": "需要你补充条件",
    conflicting: "知识库资料有冲突",
  };
  for (const [reason, label] of Object.entries(labels)) {
    const row = { eligibility: "unknown", gaps: [{ dimension: "deployment", reason }] };
    assert.equal(candidateEvidenceStatus(row, "zh"), label);
    assert.ok(candidateEvidenceStatus(row, "en").length > 0);
    assert.equal(row.eligibility, "unknown");
  }
  assert.equal(
    candidateEvidenceStatus(
      {
        eligibility: "unknown",
        gaps: [
          { dimension: "deployment", reason: "not-recorded" },
          { dimension: "region", reason: "needs-input" },
        ],
      },
      "zh",
    ),
    "需要你补充条件",
  );
  assert.equal(
    candidateEvidenceStatus(
      { eligibility: "eligible", gaps: [{ dimension: "task-quality", reason: "requires-poc" }] },
      "zh",
    ),
    "当前依据不足以确认",
  );
  assert.equal(
    candidateEvidenceStatus(
      {
        eligibility: "unknown",
        gaps: [
          { dimension: "evidence", reason: "not-current" },
          { dimension: "deployment", reason: "not-recorded" },
        ],
      },
      "zh",
    ),
    "知识库依据需重新核验",
  );
});

test("different price tiers are distinguished from genuinely missing quote evidence", () => {
  const input = {
    decision: {
      comparisons: [
        {
          id: "api-price-flat",
          dimension: "Flat",
          cells: [
            { entityId: "a", facts: [{ finding: "Flat quote", claimIds: ["source-a"] }] },
            { entityId: "b", facts: [] },
            { entityId: "c", facts: [] },
          ],
        },
        {
          id: "api-price-tiered",
          dimension: "Tiered",
          cells: [
            { entityId: "a", facts: [] },
            { entityId: "b", facts: [{ finding: "Tiered quote", claimIds: ["source-b"] }] },
            { entityId: "c", facts: [] },
          ],
        },
      ],
    },
  };
  const rows = decisionComparisonRows(input, ["a", "b", "c"]);
  assert.equal(rows[0].cells[1].otherPriceBasis, true);
  assert.equal(rows[0].cells[2].otherPriceBasis, false);
  assert.deepEqual(rows[1].cells[1].facts[0].claimIds, ["source-b"]);
});
test("initial options avoid incomplete filler while retaining named candidates and all remaining options", () => {
  const named = decisionVisibleChoices(research);
  assert.deepEqual(
    named.shown.map((row) => row.entityId),
    ["qualified", "named"],
  );
  assert.deepEqual(
    named.more.map((row) => row.entityId),
    ["described", "unknown"],
  );
  const automatic = structuredClone(research);
  automatic.decisionContext.candidateEntityIds = [];
  const readyOnly = decisionVisibleChoices(automatic);
  assert.deepEqual(
    readyOnly.shown.map((row) => row.entityId),
    ["qualified"],
  );
  assert.equal(readyOnly.shown.length + readyOnly.more.length, 4);
  automatic.decision.plan.trialCandidateIds = [];
  automatic.decision.plan.state = "needs-evidence";
  const unconfirmed = decisionVisibleChoices(automatic);
  assert.equal(unconfirmed.shown.length, 3);
  assert.equal(unconfirmed.more.length, 1);
  assert.ok(unconfirmed.shown.every((row) => !row.ready));
});
test("comparison projects actual finding objects and retains source ids; shared unknown rows are consolidated", () => {
  const input = {
    decision: {
      comparisons: [
        {
          id: "deployment",
          dimension: "Deployment",
          cells: [
            {
              entityId: "a",
              facts: [
                {
                  dimension: "deployment",
                  finding: "Cloud API; region restrictions still apply",
                  claimIds: ["source-a"],
                },
              ],
            },
            { entityId: "b", facts: [] },
          ],
        },
        {
          id: "cost",
          dimension: "Cost",
          cells: [
            { entityId: "a", facts: [] },
            { entityId: "b", facts: [] },
          ],
        },
      ],
    },
  };
  const rows = decisionComparisonRows(input, ["a", "b"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells[0].facts[0].finding, "Cloud API; region restrictions still apply");
  assert.deepEqual(rows[0].cells[0].facts[0].claimIds, ["source-a"]);
  assert.deepEqual(rows[0].cells[1].facts, []);
});
const research = {
  id: "old",
  question: "old question",
  decisionContext: {
    task: "resume extraction",
    priority: "quality",
    deployment: "cloud-api",
    budget: { mode: "unknown" },
    candidateEntityIds: ["named"],
  },
  decision: {
    scenario: { requiredFeatures: ["extract", "match"] },
    plan: { state: "ready-to-validate", trialCandidateIds: ["qualified"] },
    candidates: [
      {
        entityId: "unknown",
        eligibility: "unknown",
        strengths: [],
        gaps: [{ dimension: "deployment" }, { dimension: "task-quality" }],
      },
      { entityId: "excluded", eligibility: "excluded", strengths: [] },
      { entityId: "named", eligibility: "unknown", strengths: [], gaps: [] },
      {
        entityId: "qualified",
        eligibility: "eligible",
        strengths: [{ dimension: "extract" }, { dimension: "match" }],
        gaps: [],
      },
      {
        entityId: "described",
        eligibility: "unknown",
        strengths: [{ dimension: "extract" }, { dimension: "match" }],
        gaps: [],
      },
    ],
  },
};
test("shortlist preserves hard exclusions and trial gates while showing declared candidates and documented purpose", () => {
  const before = structuredClone(research);
  const rows = decisionChoices(research);
  assert.deepEqual(
    rows.map((row) => row.entityId),
    ["qualified", "named", "described", "unknown"],
  );
  assert.equal(rows.find((row) => row.entityId === "described").ready, false);
  assert.equal(rows[0].ready, true);
  assert.deepEqual(rows.at(-1).missing, ["deployment"]);
  assert.deepEqual(research, before);
});
test("legacy candidates with absent optional evidence stay unconfirmed", () => {
  const old = {
    ...research,
    decision: { candidates: [{ entityId: "a", eligibility: "eligible" }] },
  };
  assert.equal(decisionChoices(old)[0].ready, false);
  assert.deepEqual(decisionChoices(old)[0].known, []);
});
test("cached trial ids cannot promote an unknown candidate or a blocked plan", () => {
  const stale = structuredClone(research);
  stale.decision.candidates.find((row) => row.entityId === "qualified").eligibility = "unknown";
  assert.equal(decisionChoices(stale).find((row) => row.entityId === "qualified").ready, false);
  stale.decision.candidates.find((row) => row.entityId === "qualified").eligibility = "eligible";
  stale.decision.plan.state = "conflict";
  assert.equal(decisionChoices(stale).find((row) => row.entityId === "qualified").ready, false);
});
test("refresh uses the full original conditions and creates a new research without updating old notes", async () => {
  const before = structuredClone(research);
  let calls = 0;
  const next = await refreshDecision(research, "en", "isolated-token", async (token, payload) => {
    calls++;
    assert.equal(token, "isolated-token");
    assert.deepEqual(payload.decisionContext, { ...research.decisionContext, workflowVersion: 2 });
    assert.equal(payload.question, research.decisionContext.task);
    payload.decisionContext.budget.mode = "cost-priority";
    return { id: "new" };
  });
  assert.equal(calls, 1);
  assert.equal(next.id, "new");
  assert.deepEqual(research, before);
});
test("anonymous and unstructured reports cannot silently run research", async () => {
  let calls = 0;
  const submit = async () => {
    calls++;
  };
  await assert.rejects(refreshDecision(research, "zh", "", submit), /登录/);
  await assert.rejects(refreshDecision({ id: "old" }, "zh", "token", submit), /条件/);
  assert.equal(calls, 0);
});
