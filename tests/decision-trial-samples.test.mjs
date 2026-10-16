import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { emptyTrialSample, trialSampleJSON, trialDraftKey, parseTrialDraft, trialDraftPrefix } =
  await vite.ssrLoadModule("/src/domain/decision-trial-samples.ts");
const { apiTrialPlan } = await vite.ssrLoadModule("/src/domain/decision-api-trial.ts");
test.after(() => vite.close());
const draft = () => ({
  id: "one",
  input: "Explicitly synthetic form contract fixture",
  fields: [
    { name: "label", type: "text", value: "001" },
    { name: "count", type: "number", value: "0" },
    { name: "valid", type: "boolean", value: "false" },
    { name: "missing", type: "null", value: "ignored" },
    { name: "nested", type: "json", value: '{"items":[1,"2"]}' },
  ],
});
test("forms preserve exact user labels and JSON types, including false, zero and null", () => {
  assert.deepEqual(JSON.parse(trialSampleJSON([draft()], "zh"))[0].expected, {
    label: "001",
    count: 0,
    valid: false,
    missing: null,
    nested: { items: [1, "2"] },
  });
  const empty = emptyTrialSample("blank");
  assert.equal(empty.input, "");
  assert.throws(() => trialSampleJSON([empty], "zh"), /输入材料/);
  assert.equal("measurements" in draft(), false);
});

test("tab drafts are partitioned by owner and research, and invalid or foreign-task payloads are rejected", async () => {
  const token = (sub) =>
    `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
  assert.notEqual(trialDraftKey(token("owner-a"), "one"), trialDraftKey(token("owner-b"), "one"));
  assert.notEqual(trialDraftKey(token("owner-a"), "one"), trialDraftKey(token("owner-a"), "two"));
  assert.equal(trialDraftKey("invalid", "one"), "");
  const state = {
    task: "task",
    samples: "",
    sampleMode: "form",
    sampleDrafts: [emptyTrialSample("one")],
    instruction: "",
    minimum: "",
    ceiling: "",
    currency: "USD",
  };
  assert.deepEqual(parseTrialDraft(JSON.stringify(state), "task"), state);
  assert.equal(parseTrialDraft(JSON.stringify(state), "other task"), null);
  assert.equal(parseTrialDraft('{"sampleMode":"invented"}', "task"), null);
  const { clearAuthToken } = await vite.ssrLoadModule("/src/services/auth-session.ts");
  const session = new Map([
    [trialDraftPrefix + "owner-a:one", "private"],
    ["unrelated", "keep"],
  ]);
  const storage = {
    get length() {
      return session.size;
    },
    key: (index) => [...session.keys()][index],
    removeItem: (key) => session.delete(key),
  };
  globalThis.window = { sessionStorage: storage, localStorage: { removeItem() {} } };
  try {
    clearAuthToken();
    assert.equal(session.size, 1);
    assert.equal(session.get("unrelated"), "keep");
  } finally {
    delete globalThis.window;
  }
});
test("invalid edits fail before export instead of reusing earlier valid samples", () => {
  for (const value of ["", " ", "0x10", "Infinity", "NaN", "1,000", "9007199254740993"]) {
    const row = draft();
    row.fields[1].value = value;
    assert.throws(() => trialSampleJSON([row], "zh"), /数字|安全整数/);
  }
  const duplicate = draft();
  duplicate.fields.push({ name: " label ", type: "text", value: "other" });
  assert.throws(() => trialSampleJSON([duplicate], "zh"), /名称/);
  const invalidJson = draft();
  invalidJson.fields[4].value = "{";
  assert.throws(() => trialSampleJSON([invalidJson], "en"), /invalid JSON/);
  assert.throws(() => trialSampleJSON([draft(), draft()], "en"), /unique/);
  assert.throws(() => trialSampleJSON([], "en"), /1–20/);
});
test("form plans use the unchanged provider-neutral execution contract without calls or scores", () => {
  const research = {
    id: "synthetic",
    question: "Extract provided values",
    decisionContext: { taskType: "model-api", task: "Extract provided values" },
    decision: {
      scenario: { requiredFeatures: [] },
      candidates: [{ entityId: "a", eligibility: "eligible", strengths: [] }],
      plan: { state: "ready-to-validate", trialCandidateIds: ["a"] },
    },
  };
  const form = trialSampleJSON([draft()], "en");
  const plan = apiTrialPlan(research, ["a"], {
    samples: form,
    instruction: "Return only the declared JSON fields",
    minimum: 1,
    ceiling: 1,
    currency: "USD",
  });
  assert.deepEqual(plan.samples, JSON.parse(form));
  assert.equal(plan.grader, "json-exact");
  assert.equal(plan.maximumSeconds, 120);
  assert.equal("channel" in plan, false);
  assert.equal("measurements" in plan, false);
  assert.equal("credentials" in plan, false);
  const prototype = draft();
  prototype.fields = [{ name: "__proto__", type: "text", value: "literal" }];
  const expected = JSON.parse(trialSampleJSON([prototype], "en"))[0].expected;
  assert.equal(Object.hasOwn(expected, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});
