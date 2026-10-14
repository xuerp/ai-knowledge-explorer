import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { decisionMarkdown, validationMarkdown } = await vite.ssrLoadModule(
  "/src/domain/decision-workflow.ts",
);
const { decisionReportHtml } = await vite.ssrLoadModule("/src/domain/decision-report-html.ts");
test.after(() => vite.close());

const gap = {
  dimension: "task-quality",
  reason: "requires-poc",
  detail: "需要同一仓库实测，不能以功能介绍判断质量。",
  claimIds: [],
};
const research = {
  id: "private",
  question: "选择编码工具",
  createdAt: "2026-10-11",
  citations: [
    {
      claim: { id: "internal-claim-one", text: { zh: "可编辑文件", en: "Edits files" } },
      evidence: [{ url: "https://example.com/docs", publishedAt: "2026-10-01" }],
    },
  ],
  decision: {
    asOf: "2026-10-11",
    conditions: [],
    risks: [],
    nextChecks: [],
    tradeoffs: [],
    recommendation: { summary: "功能可核验，效果仍待实测。", reasons: [] },
    scenario: {
      name: "编码",
      requiredFeatures: ["file-editing", "test-execution"],
      clarificationChecks: [],
    },
    comparisons: [],
    candidates: ["a", "b"].map((entityId) => ({
      entityId,
      eligibility: "eligible",
      reasons: [],
      requiredDimensions: ["task-quality"],
      coveredDimensions: [],
      strengths: [
        { dimension: "file-editing", finding: "可编辑文件", claimIds: ["internal-claim-one"] },
      ],
      gaps: [gap],
    })),
  },
};

test("export coverage separates described features from constraints and keeps shared gaps once", () => {
  const before = structuredClone(research);
  const md = decisionMarkdown(research, String);
  const html = decisionReportHtml(research, [], String, true, "zh");
  for (const output of [md, html]) {
    assert.equal(output.split(gap.detail).length - 1, 1);
    assert.match(output, /未设置硬条件/);
    assert.doesNotMatch(output, /internal-claim-one|requires-poc|evidence dimensions|关键维度依据/);
    assert.match(output, /1\/2/);
  }
  assert.match(md, /可编辑文件 \[1\]/);
  assert.match(html, /依据: 1/);
  assert.match(html, /<h3>依据 1<\/h3>/);
  assert.deepEqual(research, before);
});

test("distinct qualifications and absent citations remain traceable rather than merged away", () => {
  const changed = structuredClone(research);
  changed.decision.candidates[1].gaps = [
    { ...gap, detail: "不同地区须单独核验。", claimIds: ["not-in-report"] },
  ];
  for (const output of [
    decisionMarkdown(changed, String),
    decisionReportHtml(changed, [], String, true, "zh"),
  ]) {
    assert.match(output, /不同地区须单独核验/);
    assert.match(output, /not-in-report/);
    assert.match(output, /同一仓库实测/);
  }
});

test("private Markdown retains source numbers, paragraph boundaries and readable failed states", () => {
  const output = validationMarkdown(
    research,
    [
      {
        id: "a-quality",
        candidateId: "a",
        title: "检查样本 / Check samples",
        status: "failed",
        result: "首段\n\n第二段",
        testConditions: {
          modelVersion: "v1",
          configuration: "fixed",
          sampleCount: 0,
          testedAt: "2026-10-11",
          scope: "repo",
        },
      },
    ],
    String,
    true,
  );
  assert.match(
    output,
    /Status \/ 状态: 实测未通过 \/ Failed in testing\n\n首段\n\n第二段\n\n- Version/,
  );
  assert.match(output, /- Samples \/ 样本: 0/);
  assert.match(output, /- \[1\] 可编辑文件/);
  assert.doesNotMatch(output, /Status \/ 状态: failed|\[\]/);
});
