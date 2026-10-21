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

test("knowledge platform trial separates setup from the chatbot prompt and retains verification boundaries", () => {
  const research = fixture();
  research.decision.scenario.id = "knowledge-workspace";
  research.decision.plan.trial.procedure = [
    "先确认模型和嵌入服务的数据去向，用授权 PDF 接入 Chatbot 并启用引用。",
    "用不同权限账户核对回答、引用和拒答，记录维护成本。",
  ];
  const kit = decisionTrialKit(research, ["a"], () => "Dify", "zh");
  assert.match(kit.starterInputs, /数据去向.*PDF.*Chatbot.*启用引用/);
  assert.match(kit.prompt, /当前已连接的知识库/);
  assert.match(kit.prompt, /明确说不知道/);
  assert.match(kit.prompt, /不能|不要把这些指令/);
  assert.doesNotMatch(kit.prompt, /不要回答选哪个产品|本轮选择回答模型/);
  assert.match(kit.html, /PDF/);
  assert.match(kit.markdown, /不同权限账户.*维护成本/);
  assert.equal(research.decision.plan.trial.executed, false);
});

test("an existing workspace uses the server's acceptance step without inventing setup or migration", () => {
  const research = fixture();
  research.decision.scenario.id = "knowledge-workspace";
  research.decisionContext.task = "验收已有知识库服务，不新建平台，不请求生产登录";
  research.decision.plan.trial.sample = research.decisionContext.task;
  research.decision.plan.trial.procedure = [
    "在获准的现有服务测试空间准备身份与样本，建立允许、禁止及无答案矩阵。",
    "逐身份核对引用、生效版本和拒答；不请求生产登录。",
  ];
  const kit = decisionTrialKit(research, ["a"], () => "Existing fixture", "zh");
  assert.equal(kit.starterInputs, research.decision.plan.trial.procedure[0]);
  assert.match(kit.prompt, /不请求生产登录/);
  assert.match(kit.markdown, /允许、禁止及无答案矩阵/);
  assert.match(kit.html, /允许、禁止及无答案矩阵/);
  assert.doesNotMatch(kit.starterInputs, /建立知识库|接入 Chatbot|迁移/);
  assert.equal(kit.protocol.executed, false);
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

test("formatted trial instructions remain offline, escape user content and share the actual protocol", () => {
  const research = fixture();
  research.decisionContext.task =
    '<script src="https://untrusted.invalid/x.js"></script> & actual task';
  const kit = decisionTrialKit(research, ["a"], () => "A <img src=x onerror=alert(1)>", "zh");
  assert.match(kit.html, /<meta charset="utf-8">/);
  assert.match(kit.html, /default-src 'none'/);
  assert.match(kit.html, /&lt;script/);
  assert.match(kit.html, /&lt;img/);
  assert.doesNotMatch(kit.html, /<script|<img|<iframe|<link /);
  assert.match(kit.html, /按实际文件逐字段核对/);
  assert.match(kit.html, /不得虚构字段/);
  assert.match(kit.html, /font-size:25px/);
  assert.match(kit.html, /@media print/);
  assert.match(kit.html, /isolated-fixture/);
  assert.equal(research.decision.plan.trial.executed, false);
});

test("trial exports accept synthetic inputs and prepare missing human references before scoring", () => {
  const research = fixture();
  research.decisionContext.task = "仅用合成通知试分类，没有人工参考答案";
  research.decision.plan.trial.sample = research.decisionContext.task;
  for (const lang of ["zh", "en"]) {
    const kit = decisionTrialKit(research, ["a"], () => "Candidate A", lang);
    assert.ok(kit.markdown.includes(research.decisionContext.task));
    assert.ok(kit.html.includes(research.decisionContext.task));
    if (lang === "zh") {
      assert.match(kit.markdown, /可用真实或合成材料/);
      assert.match(kit.markdown, /没有则先建立/);
      assert.match(kit.html, /没有则先建立/);
      assert.match(kit.markdown, /不以候选自己的输出作为参考答案/);
      assert.doesNotMatch(kit.markdown, /提供你有权使用的实际样本/);
    } else {
      assert.match(kit.markdown, /real or synthetic samples/);
      assert.match(kit.markdown, /establish them first/);
      assert.match(kit.html, /establish them first/);
      assert.match(kit.markdown, /cannot serve as their own reference/);
    }
    assert.ok(kit.markdown.includes(kit.prompt));
    assert.equal(kit.protocol.executed, false);
  }
});

test("coding quick start is one actual task while full comparison stays optional", () => {
  const research = fixture();
  research.decisionContext.taskType = "coding-product";
  research.decisionContext.task = "我是初学者，请建议是否换工具";
  const kit = decisionTrialKit(research, ["a"], () => "Claude Code", "zh");
  assert.match(kit.prompt, /本轮只做这一项/);
  assert.match(kit.prompt, /不能运行测试就明确说明/);
  assert.doesNotMatch(kit.prompt, /请建议是否换工具/);
  assert.match(kit.starterInputs, /先试一项即可/);
  assert.match(kit.markdown, /完整对比方案（可选）/);
  assert.match(kit.html, /完整对比方案与验收标准（可选）/);
  assert.equal(research.decision.plan.trial.executed, false);
});
