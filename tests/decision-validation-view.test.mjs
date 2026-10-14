import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { groupValidationItems, mergeValidationPlan, retainValidationDraft } =
  await vite.ssrLoadModule("/src/domain/decision-validation-view.ts");
test.after(() => vite.close());
const { decisionReportHtml } = await vite.ssrLoadModule("/src/domain/decision-report-html.ts");
const { validationMarkdown } = await vite.ssrLoadModule("/src/domain/decision-workflow.ts");
const { validationReviewReading } = await vite.ssrLoadModule(
  "/src/domain/decision-validation-review.ts",
);

test("private selection judgment uses the server outcome, groups untested candidates and disappears from draft exports", () => {
  const research = { id: "r", question: "choose", createdAt: "2026-10-11", citations: [] };
  const review = {
    sourceRevision: 8,
    candidates: [],
    comparableGroups: [],
    conclusion: {
      status: "validation-blocked",
      trialCandidateIds: [],
      findings: [
        {
          candidateId: "a",
          outcome: "testing-blocked",
          itemIds: ["a-quality"],
          scope: "",
          modelVersion: "",
        },
        { candidateId: "b", outcome: "unverified", itemIds: [], scope: "", modelVersion: "" },
      ],
    },
  };
  const reading = validationReviewReading(review, (id) => id, "zh");
  assert.match(reading.conclusion.headline, /实测未完成/);
  assert.equal(reading.conclusion.findings.length, 1);
  assert.match(reading.conclusion.untested, /b/);
  const html = decisionReportHtml(research, [], (id) => id, true, "zh", review);
  const md = validationMarkdown(research, [], (id) => id, true, review);
  assert.match(html, /本轮实测未完成/);
  assert.match(md, /本轮实测未完成/);
  assert.doesNotMatch(
    decisionReportHtml(research, [], (id) => id, false, "zh", review),
    /本轮实测未完成/,
  );
  assert.doesNotMatch(
    validationMarkdown(research, [], (id) => id, false, review),
    /本轮实测未完成/,
  );
});

test("scoped private trial states its limits and escapes names and test scope in exports", () => {
  const research = { id: "r", question: "choose", createdAt: "2026-10-11", citations: [] };
  const review = {
    sourceRevision: 1,
    candidates: [],
    comparableGroups: [],
    conclusion: {
      status: "limited-fit",
      trialCandidateIds: ["a"],
      findings: [
        {
          candidateId: "a",
          outcome: "limited-fit",
          itemIds: ["a-quality", "a-terms"],
          scope: "<script>samples</script>",
          modelVersion: "v1",
        },
      ],
    },
  };
  const reading = validationReviewReading(review, (id) => id, "en");
  assert.match(reading.conclusion.action, /does not establish superiority/);
  const html = decisionReportHtml(research, [], () => "<script>name</script>", true, "zh", review);
  assert.match(html, /可在已测范围内试用/);
  assert.match(html, /&lt;script&gt;samples/);
  assert.doesNotMatch(html, /<script>/);
});

test("passed samples with open adoption conditions remain prominent without inventing a trial pass", () => {
  const review = {
    sourceRevision: 9,
    candidates: [],
    comparableGroups: [],
    conclusion: {
      status: "insufficient-tests",
      trialCandidateIds: [],
      findings: [
        {
          candidateId: "a",
          outcome: "entry-unverified",
          itemIds: ["a-quality", "a-terms"],
          scope: "three isolated CLI samples",
          modelVersion: "declared v1",
        },
      ],
    },
  };
  const reading = validationReviewReading(review, () => "Claude Code", "zh");
  assert.match(reading.conclusion.headline, /任务样本已通过/);
  assert.match(reading.conclusion.action, /先核对使用入口/);
  assert.match(reading.conclusion.action, /当前不作优劣排名/);
  assert.deepEqual(review.conclusion.trialCandidateIds, []);
  const research = { id: "r", question: "choose", createdAt: "2026-10-11", citations: [] };
  assert.match(
    decisionReportHtml(research, [], () => "Claude Code", true, "zh", review),
    /任务样本已通过/,
  );
  assert.match(
    validationMarkdown(research, [], () => "Claude Code", true, review),
    /任务样本已通过/,
  );
  const draft = decisionReportHtml(research, [], () => "Claude Code", false, "zh", review);
  assert.doesNotMatch(draft, /任务样本已通过/);
  const html = decisionReportHtml(research, [], () => "Claude Code", true, "zh", review);
  const markdown = validationMarkdown(research, [], () => "Claude Code", true, review);
  assert.ok(html.indexOf("任务样本已通过") < html.indexOf("公开资料分析与任务条件"));
  assert.ok(markdown.indexOf("任务样本已通过") < markdown.indexOf("## Public evidence"));
  const notes = [
    {
      id: "a-quality",
      status: "passed",
      result: "Three actual task samples passed.\n\nEarlier interruptions retained.",
    },
  ];
  assert.equal(
    validationReviewReading(review, () => "Claude Code", "en", notes).conclusion.findings[0].result,
    "Three actual task samples passed.",
  );
  assert.equal(
    validationReviewReading(review, () => "Claude Code", "en", [{ ...notes[0], status: "pending" }])
      .conclusion.findings[0].result,
    "",
  );
});

test("view filtering retains all original notes and does not promote notes to passed tests", () => {
  const items = [
    { id: "a-quality", candidateId: "a", status: "pending", result: "" },
    { id: "b-quality", candidateId: "b", status: "pending", result: "费用未知" },
    { id: "a-cost", candidateId: "a", status: "pending", result: "  " },
    { id: "c-quality", candidateId: "c", status: "blocked", result: "" },
    { id: "decision", candidateId: null, status: "pending", result: "" },
  ];
  const before = structuredClone(items);
  const groups = groupValidationItems(items);
  assert.deepEqual(
    groups.map((g) => [g.candidateId, g.recorded]),
    [
      ["a", false],
      ["b", true],
      ["c", true],
      [null, false],
    ],
  );
  assert.deepEqual(
    groups.filter((g) => g.recorded).map((g) => g.candidateId),
    ["b", "c"],
  );
  assert.equal(groups[0].items[0], items[0]);
  assert.equal(groups[0].items[1], items[2]);
  assert.deepEqual(items, before);
  assert.equal(groups.flatMap((g) => g.items).length, items.length);
  assert.equal(groups[1].items[0].status, "pending");
});

test("missing plan checks are added without overwriting legacy notes or shrinking candidates", () => {
  const original = [
    { id: "quality", candidateId: "a", status: "failed", result: "keep actual failure" },
  ];
  const before = structuredClone(original);
  const plan = [
    { id: "a-quality", candidateId: "a", status: "pending", result: "" },
    { id: "a-cost", candidateId: "a", status: "pending", result: "" },
    { id: "b-quality", candidateId: "b", status: "pending", result: "" },
  ];
  const merged = mergeValidationPlan(original, plan);
  assert.equal(merged.length, 3);
  assert.equal(merged[0], original[0]);
  assert.equal(merged[0].status, "failed");
  assert.equal(mergeValidationPlan(merged, plan).length, 3);
  assert.deepEqual(original, before);
  assert.equal(
    mergeValidationPlan(
      [{ id: "custom-one", candidateId: "a" }],
      [{ id: "custom-two", candidateId: "a" }],
    ).length,
    2,
  );
  assert.throws(
    () => mergeValidationPlan(original, [{ id: "quality", candidateId: "b" }]),
    /conflicting/,
  );
  assert.throws(
    () =>
      mergeValidationPlan(
        Array.from({ length: 100 }, (_, i) => ({ id: `${i}-quality`, candidateId: String(i) })),
        [{ id: "extra-cost", candidateId: "extra" }],
      ),
    /100/,
  );
});

test("save responses preserve later draft edits and only replace the submitted version", () => {
  const submitted = [
    { id: "a-quality", candidateId: "a", status: "pending", result: "submitted note" },
  ];
  const persisted = structuredClone(submitted);
  assert.equal(retainValidationDraft(structuredClone(submitted), submitted, persisted), persisted);
  const edited = [{ ...submitted[0], result: "later unsaved correction" }];
  assert.equal(retainValidationDraft(edited, submitted, persisted), edited);
  assert.equal(edited[0].result, "later unsaved correction");
  assert.equal(persisted[0].result, "submitted note");
});

test("exports use the saved API review, escape its inputs and discard it for drafts", () => {
  const research = { id: "r", question: "choose", createdAt: "2026-10-11", citations: [] };
  const review = {
    sourceRevision: 2,
    basis: "user-records",
    candidates: [
      { candidateId: "a", completedChecks: 1, requiredChecks: 4 },
      { candidateId: "b", completedChecks: 1, requiredChecks: 4 },
    ],
    comparableGroups: [
      {
        dimension: "quality",
        candidateIds: ["a", "b"],
        itemIds: ["a-quality", "b-quality"],
        sampleCount: 12,
        testDate: "2026-10-10",
        configuration: "<script>fixture</script>",
        scope: "same samples",
      },
    ],
  };
  const html = decisionReportHtml(research, [], String, true, "zh", review);
  assert.match(html, /记录口径齐备 2\/8 项/);
  assert.match(html, /&lt;script&gt;fixture/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /不是产品得分/);
  const md = validationMarkdown(research, [], String, true, review);
  assert.match(md, /记录口径齐备 2\/8 项/);
  assert.match(md, /12 个样本/);
  for (const draft of [
    decisionReportHtml(research, [], String, false, "en", review),
    validationMarkdown(research, [], String, false, review),
  ]) {
    assert.doesNotMatch(draft, /fixture/);
    assert.match(draft, /Save to review/);
  }
});

test("empty plans and decision-level checks remain available", () => {
  assert.deepEqual(groupValidationItems([]), []);
  const groups = groupValidationItems([
    { id: "one", status: "pending", result: "" },
    { id: "two", candidateId: null, status: "pending", result: "" },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].recorded, false);
});

test("entered test conditions remain visible before a result is available", () => {
  const [group] = groupValidationItems([
    {
      id: "one",
      candidateId: "a",
      status: "pending",
      result: "",
      testConditions: { modelVersion: "v1" },
    },
  ]);
  assert.equal(group.recorded, true);
  assert.equal(group.items[0].status, "pending");
});

test("private exports group candidates and retain hidden notes, criteria, statuses and escaped inputs", () => {
  const research = { id: "r", question: "choose", createdAt: "2026-10-11", citations: [] };
  const items = [
    {
      id: "a-quality",
      candidateId: "a",
      title: "核验全部样本 / Check all samples",
      status: "blocked",
      result: "<script>unsafe</script>\n\nsecond paragraph",
    },
    {
      id: "b-cost",
      candidateId: "b",
      title: "核对账单 / Check invoice",
      status: "pending",
      result: "",
    },
    {
      id: "a-cost",
      candidateId: "a",
      title: "保留计费渠道 / Keep billing channel",
      status: "pending",
      result: "invoice unknown",
    },
  ];
  const before = structuredClone(items);
  const html = decisionReportHtml(research, items, (id) => `Candidate ${id}`, true, "zh");
  const privateHtml = html.split("<h2>私人验证记录</h2>")[1].split("<h2>引用来源</h2>")[0];
  assert.equal((privateHtml.match(/<h3>Candidate a<\/h3>/g) ?? []).length, 1);
  assert.match(privateHtml, /<h4>任务效果<\/h4>/);
  assert.match(privateHtml, /<h4>实际费用<\/h4>/);
  assert.match(privateHtml, /Candidate b/);
  assert.match(privateHtml, /&lt;script&gt;unsafe/);
  assert.doesNotMatch(privateHtml, /<script>/);
  assert.match(privateHtml, /invoice unknown/);
  assert.match(privateHtml, /核验全部样本/);
  assert.match(privateHtml, /尚未实测/);
  const md = validationMarkdown(research, items, (id) => `Candidate ${id}`, true);
  assert.equal((md.match(/^### Candidate a$/gm) ?? []).length, 1);
  assert.match(md, /^#### 任务效果 \/ Task quality$/m);
  assert.match(md, /Candidate b/);
  assert.match(md, /invoice unknown/);
  assert.match(md, /Status \/ 状态: 缺少验证条件 \/ Blocked/);
  assert.deepEqual(items, before);
});
