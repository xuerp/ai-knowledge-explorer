import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  defaultApprovalReason,
  isAlreadyAppliedReviewDecision,
  mergeReviewQueue,
  partitionReviewBatchItems,
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

test("批量批准只选择本批有原文锚点且无冲突的待审候选", () => {
  const queue = [
    {
      id: "safe",
      status: "pending",
      version: 1,
      claim: { subject: "GPT", objectOrValue: "MCP" },
      conflictClaimIds: [],
      evidenceItems: [{ sourceExcerpt: "GPT uses MCP." }],
    },
    {
      id: "conflict",
      status: "pending",
      version: 1,
      claim: { subject: "GPT", objectOrValue: "MCP" },
      conflictClaimIds: ["claim-old"],
      evidenceItems: [{ sourceExcerpt: "Conflicting excerpt." }],
    },
    {
      id: "needs-evidence",
      status: "needs-more-evidence",
      version: 1,
      claim: { subject: "GPT", objectOrValue: "MCP" },
      conflictClaimIds: [],
      evidenceItems: [{ sourceExcerpt: "Incomplete excerpt." }],
    },
    {
      id: "missing-evidence",
      status: "pending",
      version: 1,
      claim: { subject: "GPT", objectOrValue: "MCP" },
      conflictClaimIds: [],
      evidenceItems: [],
    },
    {
      id: "missing-excerpt",
      status: "pending",
      version: 1,
      claim: { subject: "GPT", objectOrValue: "MCP" },
      conflictClaimIds: [],
      evidenceItems: [{}],
    },
    {
      id: "unanchored-excerpt",
      status: "pending",
      version: 1,
      claim: { subject: "GPT", objectOrValue: "MCP" },
      conflictClaimIds: [],
      evidenceItems: [{ sourceExcerpt: "GPT is a language model." }],
    },
    {
      id: "other",
      status: "pending",
      version: 1,
      claim: { subject: "Other", objectOrValue: "fact" },
      conflictClaimIds: [],
      evidenceItems: [{ sourceExcerpt: "Other anchored fact." }],
    },
  ];

  assert.deepEqual(
    selectBatchApprovableReviewItems(queue, [
      "safe",
      "conflict",
      "needs-evidence",
      "missing-evidence",
      "missing-excerpt",
      "unanchored-excerpt",
    ]),
    [queue[0]],
  );
});

test("大量安全候选会按后端事务上限拆分且不遗漏", () => {
  const items = Array.from({ length: 121 }, (_, index) => `review-${index + 1}`);

  const batches = partitionReviewBatchItems(items);

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [50, 50, 21],
  );
  assert.deepEqual(batches.flat(), items);
  assert.throws(() => partitionReviewBatchItems(items, 0), /正整数/);
});
