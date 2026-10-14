import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { findClaimLifecycleMatches, lifecycleIdempotencyKey } = await vite.ssrLoadModule(
  "/src/domain/claim-lifecycle.ts",
);

test.after(async () => vite.close());

function item(id, value, overrides = {}) {
  return {
    id: `review-${id}`,
    entityId: "e-gpt",
    status: "approved",
    lifecycleStatus: "current",
    publicationAction: "new",
    version: 2,
    claim: {
      id: `claim-${id}`,
      text: { zh: value, en: value },
      confidence: "verified",
      subject: "GPT",
      predicate: "context-window",
      objectOrValue: value,
      validFrom: "2026-08-22",
    },
    evidenceIds: [`evidence-${id}`],
    evidenceItems: [],
    conflictClaimIds: [],
    createdAt: "2026-08-22T00:00:00Z",
    ...overrides,
  };
}

test("审核候选区分完全重复事实与同主题更新", () => {
  const candidate = item("candidate", "1M", { status: "pending", version: 1 });
  const duplicate = item("duplicate", "1M");
  const update = item("update", "2M");
  const unrelated = item("unrelated", "1M", { entityId: "e-claude" });

  assert.deepEqual(
    findClaimLifecycleMatches(candidate, [update, unrelated, duplicate]).map((match) => [
      match.target.id,
      match.relationship,
    ]),
    [
      ["review-duplicate", "duplicate"],
      ["review-update", "update"],
    ],
  );
  assert.equal(
    lifecycleIdempotencyKey(candidate, duplicate, "merged-evidence"),
    lifecycleIdempotencyKey(candidate, duplicate, "merged-evidence"),
  );
});

test("相同数值补充实验条件需要修订，不静默合并为重复事实", () => {
  const original = item("unqualified", "72.7%");
  const qualified = item("qualified", "72.7%", { status: "pending", version: 1 });
  qualified.claim.text = {
    zh: "72.7%，未使用扩展思考，完整500题",
    en: "72.7%, no extended thinking, all 500 problems",
  };
  assert.equal(findClaimLifecycleMatches(qualified, [original])[0].relationship, "update");
  const spacingOnly = item("spacing-only", "72.7%", { status: "pending", version: 1 });
  spacingOnly.claim.text = { zh: " 72.7%  ", en: "72.7%\n" };
  assert.equal(findClaimLifecycleMatches(spacingOnly, [original])[0].relationship, "duplicate");
});
