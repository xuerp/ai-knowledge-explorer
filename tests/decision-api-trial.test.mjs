import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { apiTrialCandidates, apiTrialPlan, apiTrialReceipt, mergeApiTrialReceipt } =
  await vite.ssrLoadModule("/src/domain/decision-api-trial.ts");
test.after(() => vite.close());
const research = () => ({
  id: "synthetic-research",
  question: "Extract the supplied integer",
  decisionContext: { taskType: "model-api", task: "Extract the supplied integer" },
  decision: {
    scenario: { requiredFeatures: [] },
    candidates: ["a", "b"].map((entityId) => ({
      entityId,
      eligibility: "eligible",
      strengths: [],
    })),
    plan: { state: "ready-to-validate", trialCandidateIds: ["a", "b"] },
  },
});
const records = () =>
  ["a", "b"].flatMap((candidateId) =>
    ["quality", "cost", "latency", "terms"].map((dimension) => ({
      id: `${candidateId}-${dimension}`,
      candidateId,
      title: `Synthetic ${dimension}`,
      status: "pending",
      result: "",
    })),
  );
const receipt = () => {
  const plan = apiTrialPlan(research(), ["a", "b"], {
    samples: JSON.stringify([{ id: "one", input: "1", expected: 1 }]),
    instruction: "Return the supplied integer as JSON",
    minimum: 1,
    ceiling: 1,
    currency: "USD",
  });
  return {
    format: "ai-radar-api-trial-receipt-v1",
    researchId: "synthetic-research",
    planDigest: "a".repeat(64),
    startedAt: "2026-01-01T00:00:00+00:00",
    completedAt: "2026-01-01T00:00:02+00:00",
    scope: "synthetic mocked contract fixture; not real model performance",
    configuration: "b".repeat(64),
    sampleCount: 1,
    minimumSuccessfulSamples: 1,
    currency: "USD",
    kind: "private-api-trial-not-product-ranking",
    rateBasis: "local-user-declared-rates-not-an-invoice",
    status: "complete",
    plan,
    results: ["a", "b"].map((candidateId) => ({
      candidateId,
      requestedModel: `fixture-${candidateId}`,
      endpointOrigin: "https://supplier.example",
      samples: [{ sampleId: "one", status: "passed", output: "1", estimatedCost: 0.01 }],
      successfulSamples: 1,
      status: "complete",
      p50Ms: 10,
      p95Ms: 10,
    })),
  };
};

test("opt-in export uses user-labeled samples, not made-up measurements or credentials", () => {
  assert.deepEqual(apiTrialCandidates(research(), records()), ["a", "b"]);
  const p = receipt().plan;
  assert.equal(p.samples[0].expected, 1);
  assert.equal(p.maximumSeconds, 120);
  assert.equal("measurements" in p, false);
  assert.equal("key" in p, false);
  assert.throws(() =>
    apiTrialPlan(research(), ["a"], {
      samples: '[{"id":"x","input":"input"}]',
      instruction: "test",
      minimum: 1,
      ceiling: 1,
      currency: "USD",
    }),
  );
  assert.throws(() =>
    apiTrialPlan(research(), ["a"], {
      samples: JSON.stringify(p.samples),
      instruction: "test",
      minimum: 2,
      ceiling: 1,
      currency: "USD",
    }),
  );
});

test("receipt applies to a draft only, keeps terms and other records, and estimates never become paid charges", () => {
  const original = records();
  original[3].result = "Preserve actual terms note";
  const before = JSON.stringify(original);
  const imported = apiTrialReceipt(research(), JSON.stringify(receipt()), "zh");
  const merged = mergeApiTrialReceipt(original, imported);
  assert.equal(JSON.stringify(original), before);
  assert.equal(merged[0].status, "passed");
  assert.equal(merged[1].status, "pending");
  assert.equal(merged[1].measurements.costBasis, "estimate");
  assert.equal(merged[2].status, "pending");
  assert.equal(merged[3].result, "Preserve actual terms note");
  assert.equal(merged[3].status, "pending");
  assert.throws(() => mergeApiTrialReceipt(merged, imported), /explicit/);
  assert.equal(
    mergeApiTrialReceipt(merged, imported, true)[3].result,
    "Preserve actual terms note",
  );
});

test("partial runs remain blocked and missing cost cannot become a free actual charge", () => {
  const r = receipt();
  r.status = "blocked";
  r.results[1].samples = [];
  r.results[1].successfulSamples = 0;
  r.results[1].status = "blocked";
  const result = mergeApiTrialReceipt(
    records(),
    apiTrialReceipt(research(), JSON.stringify(r), "en"),
  );
  assert.equal(result[0].status, "blocked");
  assert.equal(result[4].status, "blocked");
  assert.equal(result[1].measurements, undefined);
  const missing = receipt();
  delete missing.results[0].samples[0].estimatedCost;
  const imported = mergeApiTrialReceipt(
    records(),
    apiTrialReceipt(research(), JSON.stringify(missing), "en"),
  );
  assert.equal(imported[1].measurements, undefined);
});

test("receipts cannot cross decisions, candidate eligibility, sample scopes or existing revisions", () => {
  for (const change of [
    (r) => {
      r.researchId = "other";
    },
    (r) => {
      r.plan.task = "other";
    },
    (r) => {
      r.results[0].candidateId = "unknown";
    },
    (r) => {
      r.results[0].samples[0].sampleId = "other";
    },
    (r) => {
      r.results[0].successfulSamples = 0;
    },
    (r) => {
      r.results.push(r.results[0]);
    },
    (r) => {
      r.completedAt = "9999-01-01T00:00:00+00:00";
    },
  ]) {
    const r = receipt();
    change(r);
    assert.throws(() => apiTrialReceipt(research(), JSON.stringify(r), "en"));
  }
  const blocked = research();
  blocked.decision.candidates[0].eligibility = "unknown";
  assert.throws(() => apiTrialReceipt(blocked, JSON.stringify(receipt()), "en"));
  const coding = research();
  coding.decisionContext.taskType = "coding-product";
  assert.deepEqual(apiTrialCandidates(coding, records()), []);
  const stale = research();
  stale.citationStates = { source: "changed" };
  assert.deepEqual(apiTrialCandidates(stale, records()), []);
});
