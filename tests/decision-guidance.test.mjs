import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
test.after(() => vite.close());
const { decisionPresentation } = await vite.ssrLoadModule("/src/domain/decision-presentation.ts");
const { decisionVerdict } = await vite.ssrLoadModule("/src/domain/decision-verdict.ts");
const { decisionReportHtml } = await vite.ssrLoadModule("/src/domain/decision-report-html.ts");
const { refreshDecision } = await vite.ssrLoadModule("/src/domain/decision-choice.ts");
const { decisionResumePath, decisionMarkdown } = await vite.ssrLoadModule(
  "/src/domain/decision-workflow.ts",
);
const context = {
  workflowVersion: 2,
  task: "想提高工作效率",
  priority: "balanced",
  deployment: "private",
  budget: { mode: "unknown" },
  exclusions: [],
  candidateEntityIds: [],
  intentAnswers: [{ questionId: "work-direction", optionId: "knowledge-workspace" }],
};
const guidance = {
  schemaVersion: 1,
  outcome: "conditional",
  intent: [],
  tasks: [context.task],
  answered: context.intentAnswers,
  recommendation: {
    headline: "服务端限定建议",
    summary: "功能可参考，部署仍未知",
    entityIds: [],
    primaryEntityId: null,
    reasons: [{ dimension: "test", finding: "功能依据不证明账户已开通", claimIds: [] }],
    tradeoff: "部署仍需单独核验",
    premises: ["这是未实测的路线"],
  },
  unknowns: [],
  nextAction: {
    kind: "routes",
    label: "看已知功能",
    targetIds: [],
    location: "this-page",
    instruction: "保留私有部署要求",
  },
};
const research = {
  id: "saved-parent",
  question: context.task,
  summary: "legacy summary",
  createdAt: "2026-10-16T00:00:00Z",
  status: "ready",
  claimIds: [],
  citations: [],
  decisionContext: context,
  decision: {
    guidance,
    asOf: "2026-10-16T00:00:00Z",
    status: "ready",
    candidates: [],
    recommendation: {
      primaryEntityId: "legacy-winner",
      summary: "legacy summary",
      alternativeEntityIds: [],
    },
    conditions: [],
    tradeoffs: [],
    risks: [],
    nextChecks: [],
    claimIds: [],
  },
};

test("v1 presentation and verdict consume server advice without selecting a different winner", () => {
  const presentation = decisionPresentation(research, "zh");
  const verdict = decisionVerdict(research, null, (id) => id, "zh");
  assert.equal(presentation.headline, guidance.recommendation.headline);
  assert.equal(verdict.headline, presentation.headline);
  assert.equal(verdict.summary, guidance.recommendation.summary);
  assert.equal(verdict.next, guidance.nextAction.instruction);
  assert.equal(decisionPresentation(research, "en").summary, presentation.summary);
});

test("refresh and edit retain revision identity and clarification history", async () => {
  let sent;
  await refreshDecision(research, "zh", "test-token", async (_, request) => {
    sent = request;
    return research;
  });
  assert.equal(sent.parentResearchId, research.id);
  assert.deepEqual(sent.decisionContext.intentAnswers, context.intentAnswers);
  assert.equal(sent.decisionContext.deployment, "private");
  const url = new URL(
    decisionResumePath({ ...context, parentResearchId: research.id }),
    "http://local",
  );
  assert.equal(url.searchParams.get("parentResearchId"), research.id);
});

test("Markdown keeps the same qualified advice and next step", () => {
  const markdown = decisionMarkdown(research, (id) => id);
  assert.ok(markdown.includes(guidance.recommendation.headline));
  assert.ok(markdown.includes(guidance.recommendation.summary));
  assert.ok(markdown.includes(guidance.nextAction.instruction));
  assert.ok(!markdown.includes("legacy summary"));
});

test("HTML preserves authoritative reasons, tradeoff and premises", () => {
  const html = decisionReportHtml(research, [], (id) => id, false, "zh");
  for (const value of [
    guidance.recommendation.headline,
    guidance.recommendation.summary,
    guidance.recommendation.reasons[0].finding,
    guidance.recommendation.tradeoff,
    guidance.recommendation.premises[0],
    guidance.nextAction.instruction,
  ]) {
    assert.ok(html.includes(value));
  }
  assert.ok(!html.includes("legacy summary"));
});
