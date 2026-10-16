import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const {
  interpretDecisionTask,
  decisionFingerprint,
  matchesDecisionFingerprint,
  decisionResumePath,
  createValidationPlan,
  decisionMarkdown,
  validationMarkdown,
  decisionInputConflicts,
  decisionScenario,
} = await vite.ssrLoadModule("/src/domain/decision-workflow.ts");
test.after(() => vite.close());
const context = {
  workflowVersion: 2,
  task: "企业知识库问答，要求私有部署，上下文不低于100k，每月预算2万元，支持图像输入，可商用",
  taskType: "model-api",
  priority: "quality",
  budget: { mode: "unknown" },
  deployment: "undecided",
  exclusions: [],
  candidateEntityIds: ["version-1"],
  inputModalities: [],
  commercialUseRequired: false,
};

test("knowledge application selection differs from choosing its underlying model", () => {
  const task = "公司内部知识库问答，中文 PDF 和 Word，引用原文，权限控制";
  const product = interpretDecisionTask({ ...context, task, taskType: "unspecified" });
  assert.equal(product.taskType, "knowledge-product");
  assert.equal(decisionScenario(product, "zh").id, "knowledge-workspace");
  assert.ok(decisionScenario(product, "zh").requiredFeatures.includes("workspace-permissions"));
  assert.equal(
    decisionScenario({ ...product, taskType: "model-api" }, "zh").id,
    "knowledge-assistant",
  );
  const link = new URL(decisionResumePath(product), "http://localhost");
  assert.equal(link.searchParams.get("taskType"), "knowledge-product");
});

test("strict offline contract wording preserves every decisive form condition", () => {
  const strict = interpretDecisionTask({
    ...context,
    task: "我要处理公司保密合同，禁止把原文发送到外部云服务，必须完全离线运行，至少支持 200 万 token 上下文，允许商用。请严格保留这些必要条件，不要为了推荐而自动放宽。",
    taskType: "unspecified",
    minimumContextTokens: undefined,
  });
  assert.equal(strict.taskType, "model-api");
  assert.equal(strict.deployment, "on-device");
  assert.equal(strict.minimumContextTokens, 2000000);
  assert.equal(strict.commercialUseRequired, true);
  const optional = interpretDecisionTask({
    ...context,
    task: "文档问答，不需要完全离线运行，不要求商用",
    taskType: "unspecified",
  });
  assert.equal(optional.deployment, "undecided");
  assert.equal(optional.commercialUseRequired, false);
});

test("batch extraction is recognized before generic customer-service dialogue", () => {
  const scene = decisionScenario(
    { ...context, task: "批量提取客服工单中的问题类型、产品名称和紧急程度" },
    "zh",
  );
  assert.equal(scene.id, "document-extraction");
  assert.ok(scene.requiredFeatures.includes("structured-output"));
});

test("a gateway service cannot silently use a different supplier's budget channel", () => {
  const scoped = {
    ...context,
    task: "文档字段提取",
    serviceAccess: { channel: "CCSub", tier: "paid", region: "US" },
    budget: { mode: "range", channel: "Google Gemini Developer API", max: 20, currency: "USD" },
  };
  assert.ok(decisionInputConflicts(scoped).includes("service-channel"));
  assert.ok(
    !decisionInputConflicts({
      ...scoped,
      budget: { ...scoped.budget, channel: " ccsub " },
    }).includes("service-channel"),
  );
});
test("actual service scope survives login/resume and changing it invalidates saved advice", () => {
  const scoped = {
    ...context,
    commercialUseRequired: true,
    serviceAccess: { channel: "fixture-direct", tier: "paid", region: "US" },
  };
  const url = new URL(decisionResumePath(scoped), "http://localhost");
  assert.equal(url.searchParams.get("serviceChannel"), "fixture-direct");
  assert.equal(url.searchParams.get("serviceTier"), "paid");
  assert.equal(url.searchParams.get("serviceRegion"), "US");
  for (const change of [{ channel: "gateway" }, { tier: "free" }, { region: "CN" }]) {
    assert.notEqual(
      decisionFingerprint(scoped),
      decisionFingerprint({ ...scoped, serviceAccess: { ...scoped.serviceAccess, ...change } }),
    );
  }
});

test("server default cost scope does not falsely mark unchanged requirements as edited", () => {
  const returned = {
    ...context,
    budget: {
      ...context.budget,
      period: "month",
      costScope: "all-costs",
      max: null,
      currency: null,
    },
  };
  assert.equal(decisionFingerprint(context), decisionFingerprint(returned));
  assert.notEqual(
    decisionFingerprint(context),
    decisionFingerprint({ ...returned, priority: "speed" }),
  );
  assert.notEqual(
    decisionFingerprint(context),
    decisionFingerprint({
      ...returned,
      budget: { ...returned.budget, costScope: "standard-token-only" },
    }),
  );
});

test("saved results survive new default fields while actual edits and malformed signatures stay unmatched", () => {
  const saved = JSON.stringify(context);
  const current = {
    ...context,
    budget: { ...context.budget, costScope: "all-costs", period: "month" },
  };
  assert.equal(matchesDecisionFingerprint(saved, decisionFingerprint(current)), true);
  assert.equal(
    matchesDecisionFingerprint(saved, decisionFingerprint({ ...current, deployment: "private" })),
    false,
  );
  assert.equal(
    matchesDecisionFingerprint(
      saved,
      decisionFingerprint({ ...current, budget: { mode: "range", max: 100 } }),
    ),
    false,
  );
  assert.equal(matchesDecisionFingerprint("invalid", decisionFingerprint(current)), false);
  assert.equal(matchesDecisionFingerprint(undefined, decisionFingerprint(current)), false);
});
test("bounded intent recognition proposes explicit constraints without inventing workload or facts", () => {
  const result = interpretDecisionTask(context);
  assert.equal(result.deployment, "private");
  assert.equal(result.minimumContextTokens, 100000);
  assert.equal(result.budget.max, 20000);
  assert.equal(result.budget.currency, "CNY");
  assert.deepEqual(result.inputModalities, ["image"]);
  assert.equal(result.commercialUseRequired, true);
  assert.equal(result.budget.monthlyInputTokens, undefined);
  assert.equal(result.budget.channel, "");
  assert.equal(context.deployment, "undecided");
  assert.equal(
    interpretDecisionTask({
      ...context,
      budget: { mode: "range", max: 500, currency: "USD" },
      deployment: "cloud-api",
    }).budget.max,
    500,
  );
});
test("ambiguous currency and maximum context are not treated as proven requirements", () => {
  const result = interpretDecisionTask({
    ...context,
    task: "Monthly budget 20000; 上下文不超过100k，不需要图像输入",
  });
  assert.equal(result.budget.mode, "unknown");
  assert.equal(result.minimumContextTokens, undefined);
  assert.deepEqual(result.inputModalities, []);
});
test("resume retains the complete decision and canonical fingerprints invalidate changed conditions", () => {
  const result = interpretDecisionTask({
    ...context,
    region: "CN",
    budget: {
      mode: "range",
      max: 20,
      currency: "USD",
      channel: "official",
      monthlyInputTokens: 0,
      monthlyOutputTokens: 100,
    },
  });
  const search = new URL(decisionResumePath(result), "http://localhost").searchParams;
  assert.equal(search.get("inputTokens"), "0");
  assert.equal(search.get("minimumContext"), "100000");
  assert.equal(search.get("commercialUse"), "true");
  assert.equal(search.get("region"), "CN");
  assert.notEqual(
    decisionFingerprint(result),
    decisionFingerprint({ ...result, priority: "cost" }),
  );
  assert.equal(
    decisionFingerprint(result),
    decisionFingerprint(Object.fromEntries(Object.entries(result).reverse())),
  );
});
test("backend nulls and defaults preserve unchanged conditions; nulls never enter resume URLs", () => {
  const backend = {
    ...context,
    budget: { ...context.budget, period: "month", min: null, max: null, channel: null },
    notes: null,
    region: null,
    minimumContextTokens: null,
  };
  assert.equal(decisionFingerprint(context), decisionFingerprint(backend));
  assert.ok(!decisionResumePath(backend).includes("null"));
  assert.equal(
    interpretDecisionTask({ ...context, task: "需要支持100k以上上下文" }).minimumContextTokens,
    100000,
  );
  assert.deepEqual(
    decisionInputConflicts({ ...context, deployment: "cloud-api", minimumContextTokens: 50000 }),
    ["deployment", "context"],
  );
  assert.deepEqual(decisionInputConflicts(interpretDecisionTask(context)), []);
});
test("PoC starts pending and report retains qualified conclusions, dimensions and source claim ids", () => {
  const research = {
    decision: {
      asOf: "2026-10-09T01:00:00Z",
      recommendation: { summary: "Insufficient evidence" },
      conditions: ["Private deployment"],
      risks: [{ detail: "Missing quality tests", claimIds: [] }],
      nextChecks: ["Measure task success"],
      candidates: [
        {
          entityId: "version-1",
          eligibility: "unknown",
          coveredDimensions: ["deployment"],
          requiredDimensions: ["deployment", "task-quality"],
          reasons: ["Quality unknown"],
        },
        {
          entityId: "excluded",
          eligibility: "excluded",
          coveredDimensions: [],
          requiredDimensions: ["task-quality"],
          reasons: ["Excluded by task"],
        },
      ],
      comparisons: [
        {
          dimension: "Deployment",
          cells: [
            {
              entityId: "version-1",
              state: "supported",
              facts: [{ finding: "Verified private deployment", claimIds: ["claim-1"] }],
            },
          ],
        },
      ],
    },
  };
  const plan = createValidationPlan(research);
  assert.equal(plan.length, 4);
  assert.ok(
    plan.every(
      (item) => item.status === "pending" && item.result === "" && item.candidateId === "version-1",
    ),
  );
  const markdown = decisionMarkdown(research, (id) => id);
  assert.match(markdown, /Insufficient evidence/);
  assert.match(markdown, /claim-1/);
  assert.match(markdown, /Verified constraints: 1\/1/);
  assert.match(markdown, /Quality unknown/);
  const exported = validationMarkdown(
    { ...research, id: "private-record", citations: [] },
    [{ ...plan[0], status: "blocked", result: "No actual model testing yet" }],
    (id) => id,
    false,
  );
  assert.match(exported, /Unsaved draft/);
  assert.match(exported, /No actual model testing yet/);
  assert.match(exported, /not verified public Claims/);
});

test("specific file and test requirements replace generic coding labels and produce repository trials", () => {
  const scene = decisionScenario(
    {
      ...context,
      taskType: "coding-product",
      task: "编辑文件、运行测试",
    },
    "zh",
  );
  assert.deepEqual(scene.requiredFeatures, ["file-editing", "test-execution"]);
  const plan = createValidationPlan({
    decision: {
      scenario: scene,
      candidates: [{ entityId: "cli", eligibility: "eligible" }],
    },
  });
  assert.match(plan[0].title, /失败测试修复/);
  assert.match(plan[0].title, /退出码/);
  assert.match(plan[1].title, /人工修改量/);
  assert.match(plan[2].title, /未知费用保留未知/);
  assert.match(plan[3].title, /命令审批/);
  assert.ok(plan.every((item) => item.status === "pending" && item.result === ""));
});

test("stateful requirements and business PoC checks survive without fabricated measurements", () => {
  const scene = decisionScenario(
    {
      ...context,
      taskType: "agent-development",
      task: "有状态 Agent 框架，需要人工审批和中断恢复",
    },
    "zh",
  );
  assert.ok(scene.requiredFeatures.includes("persistent-state"));
  assert.ok(scene.requiredFeatures.includes("human-approval"));
  const noState = decisionScenario(
    {
      ...context,
      taskType: "agent-development",
      task: "Agent framework; no need for persistent state",
    },
    "en",
  );
  assert.ok(!noState.requiredFeatures.includes("persistent-state"));
  const plan = createValidationPlan({
    decision: { scenario: scene, candidates: [{ entityId: "framework", eligibility: "unknown" }] },
  });
  assert.match(plan[0].title, /中断恢复/);
  assert.ok(
    plan.every((item) => item.status === "pending" && item.testConditions.modelVersion === ""),
  );
});
