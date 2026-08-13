import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  defaultApprovalReason,
  isAlreadyAppliedReviewDecision,
  mergeReviewQueue,
  resolveReviewReason,
  selectBatchApprovableReviewItems,
} = await vite.ssrLoadModule("/src/domain/review-decision.ts");

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

test("批准成功后的本地状态不会被延迟的待审响应覆盖", () => {
  const approved = { id: "review-1", status: "approved", version: 2, marker: "local" };
  const stale = { id: "review-1", status: "pending", version: 1, marker: "remote" };

  assert.deepEqual(mergeReviewQueue([approved], [stale]), [approved]);
});

test("刷新失败返回空队列时保留当前审核状态", () => {
  const approved = { id: "review-1", status: "approved", version: 2 };
  const pending = { id: "review-2", status: "pending", version: 1 };

  assert.deepEqual(mergeReviewQueue([approved, pending], []), [approved, pending]);
});

test("批量批准只选择本批无冲突的待审候选", () => {
  const queue = [
    { id: "safe", status: "pending", version: 1, conflictClaimIds: [] },
    { id: "conflict", status: "pending", version: 1, conflictClaimIds: ["claim-old"] },
    { id: "evidence", status: "needs-more-evidence", version: 1, conflictClaimIds: [] },
    { id: "other", status: "pending", version: 1, conflictClaimIds: [] },
  ];

  assert.deepEqual(selectBatchApprovableReviewItems(queue, ["safe", "conflict", "evidence"]), [
    queue[0],
  ]);
});
