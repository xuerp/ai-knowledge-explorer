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
const { decisionPresentation, describedPriority, validationTitle } = await vite.ssrLoadModule(
  "/src/domain/decision-presentation.ts",
);
const { decisionReportHtml } = await vite.ssrLoadModule("/src/domain/decision-report-html.ts");
const { compactFindings, decisionReading } = await vite.ssrLoadModule(
  "/src/domain/decision-reading.ts",
);
test.after(() => vite.close());
test("overlapping workflow descriptions retain distinct caveats and every citation once", () => {
  const items = [
    { finding: "编辑文件。须用户批准。", claimIds: ["c1"] },
    { finding: "编辑文件。运行测试。", claimIds: ["c1", "c2"] },
    { finding: "运行测试。不是效果测评。", claimIds: ["c2"] },
    { finding: "Gemini 3.1 Pro. CLI only.", claimIds: ["c3"] },
  ];
  const original = JSON.stringify(items);
  const result = compactFindings(items);
  assert.deepEqual(result[0], {
    finding: "编辑文件。 须用户批准。 运行测试。 不是效果测评。",
    claimIds: ["c1", "c2"],
  });
  assert.equal(result[1].finding, "Gemini 3.1 Pro. CLI only.");
  assert.equal(JSON.stringify(items), original);
});
test("reading groups repeated unknowns without hiding excluded candidates or unique caveats", () => {
  const fact = { finding: "Edits files", claimIds: ["c1"], dimension: "file-editing" };
  const decision = {
    candidates: [
      {
        entityId: "a",
        eligibility: "unknown",
        reasons: ["Deployment unverified"],
        strengths: [fact],
      },
      {
        entityId: "b",
        eligibility: "excluded",
        reasons: ["Deployment unverified", "Context too small"],
        strengths: [],
      },
    ],
    comparisons: [
      {
        id: "context",
        dimension: "Context",
        cells: [{ entityId: "a", state: "unknown", facts: [] }],
      },
      {
        id: "feature-files",
        dimension: "File editing",
        cells: [
          { entityId: "a", state: "supported", facts: [fact] },
          { entityId: "b", state: "unknown", facts: [] },
        ],
      },
    ],
    tradeoffs: [
      { ...fact, finding: "A: Edits files" },
      { ...fact, finding: "A: Requires repository approval" },
    ],
    nextChecks: ["A: Deployment unverified", "Check test results"],
  };
  const original = JSON.stringify(decision);
  const reading = decisionReading(decision, (id) => id.toUpperCase());
  assert.deepEqual(reading.commonReasons, [["Deployment unverified", ["a", "b"]]]);
  assert.deepEqual(reading.individualReasons("b"), ["Context too small"]);
  assert.deepEqual(reading.missingDimensions, ["Context"]);
  assert.equal(reading.knownComparisons[0].cells.length, 2);
  assert.deepEqual(
    reading.extraEvidence.map((item) => item.finding),
    ["A: Requires repository approval"],
  );
  assert.deepEqual(reading.nextChecks, ["Check test results"]);
  assert.equal(JSON.stringify(decision), original);
});
const record = {
  id: "private-id",
  question: "100k input",
  createdAt: "2026-10-10T07:21:14Z",
  summary: "Legacy generic summary",
  decisionContext: {
    task: "Compare <script>alert(1)</script>",
    priority: "quality",
    taskType: "model-api",
    deployment: "cloud-api",
    budget: {
      mode: "range",
      min: 1,
      max: 100,
      currency: "USD",
      period: "month",
      channel: "official",
      monthlyInputTokens: 10000,
      monthlyOutputTokens: 500,
    },
    candidateEntityIds: ["one", "two"],
    exclusions: ["no hosting abroad"],
    minimumContextTokens: 2000000,
    inputModalities: ["text"],
    notes: "<img src=x onerror=alert(1)>",
  },
  decision: {
    status: "insufficient-evidence",
    asOf: "2026-10-10T07:21:14Z",
    recommendation: { summary: "Found cited candidates; fit unverified", alternativeEntityIds: [] },
    conditions: ["Context >= 2000000"],
    candidates: ["one", "two"].map((entityId) => ({
      entityId,
      eligibility: "excluded",
      reasons: ["Context below requirement"],
      coveredDimensions: ["deployment", "context"],
      requiredDimensions: ["deployment", "context", "quality"],
    })),
    risks: [],
    nextChecks: ["Keep requirement or change candidates"],
    tradeoffs: [],
    comparisons: [],
  },
  citations: [
    {
      claim: { id: "claim-context", text: { zh: "来源事实", en: "Cited fact" } },
      evidence: [{ url: "javascript:alert(1)", publishedAt: "2026-10-01" }],
    },
  ],
};
test("all excluded is a concrete negative result, separate from missing evidence or untested quality", () => {
  const result = decisionPresentation(record, "zh");
  assert.equal(result.allExcluded, true);
  assert.match(result.headline, /没有符合/);
  assert.match(result.summary, /均被硬条件排除/);
  assert.deepEqual(result.counts, { eligible: 0, excluded: 2, unknown: 0, conflict: 0 });
  const mixed = structuredClone(record);
  mixed.decision.candidates[0].eligibility = "unknown";
  assert.equal(decisionPresentation(mixed, "zh").allExcluded, false);
  assert.match(decisionPresentation(mixed, "zh").headline, /资料不足/);
  mixed.decision.candidates[0].eligibility = "eligible";
  assert.match(decisionPresentation(mixed, "en").headline, /untested/);
  assert.match(decisionPresentation(mixed, "zh").headline, /可继续验证/);
  assert.doesNotMatch(decisionPresentation(mixed, "zh").headline, /硬条件通过/);
});
test("priority proposal uses explicit unambiguous wording and leaves contradictory or negated intent unresolved", () => {
  assert.equal(describedPriority("云 API，效果优先。"), "quality");
  assert.equal(describedPriority("cost first"), "cost");
  assert.equal(describedPriority("效果优先，速度优先"), undefined);
  assert.equal(describedPriority("不要效果优先"), undefined);
});
test("formatted export escapes user input, has no executable content, preserves full conditions and does not mutate private records", () => {
  const before = JSON.stringify(record);
  const html = decisionReportHtml(
    record,
    [
      {
        title: "记录配置 / Record settings",
        status: "pending",
        result: "<script>run()</script>",
        testConditions: {
          modelVersion: "version-1",
          configuration: "temp=0",
          sampleCount: 12,
          testedAt: "2026-10-10",
          scope: "same set",
        },
      },
    ],
    (id) => `Model ${id}`,
    false,
    "zh",
  );
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /2000000/);
  assert.match(html, /official/);
  assert.match(html, /10000 \/ 500/);
  assert.match(html, /2026-10-10/);
  assert.match(html, /font-size:24px/);
  assert.match(html, /尚未保存/);
  assert.equal(JSON.stringify(record), before);
});
test("controlled validation labels use the selected language without changing stored notes", () => {
  assert.equal(validationTitle("记录配置 / Record settings", "en"), "Record settings");
  assert.equal(
    validationTitle("用相同业务样本核对 / Test identical business samples: job matching", "zh"),
    "用相同业务样本核对：job matching",
  );
  assert.equal(validationTitle("arbitrary note", "en"), "arbitrary note");
});
