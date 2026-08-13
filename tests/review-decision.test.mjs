import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { defaultApprovalReason, isAlreadyAppliedReviewDecision, resolveReviewReason } =
  await vite.ssrLoadModule("/src/domain/review-decision.ts");

test.after(async () => vite.close());

test("批准可以使用标准审计理由直接提交", () => {
  assert.equal(resolveReviewReason("approve", ""), defaultApprovalReason);
});

test("人工填写的审核理由会被保留", () => {
  assert.equal(resolveReviewReason("approve", "  已核对官方原文  "), "已核对官方原文");
});

test("拒绝仍要求填写具体理由", () => {
  assert.throws(() => resolveReviewReason("reject", ""), /至少 3 个字符/);
});

test("重复的同向审核决定按成功处理", () => {
  assert.equal(isAlreadyAppliedReviewDecision("approve", "Review job is already approved."), true);
  assert.equal(isAlreadyAppliedReviewDecision("reject", "Review job is already rejected."), true);
  assert.equal(isAlreadyAppliedReviewDecision("reject", "Review job is already approved."), false);
});
