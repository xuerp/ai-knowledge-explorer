import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { freshnessAgeLabel, freshnessBudgetLabel, freshnessTrackLabels } = await vite.ssrLoadModule(
  "/src/domain/knowledge-freshness.ts",
);
const { reviewReasonCategoryLabels, resolveReviewReasonCategory } = await vite.ssrLoadModule(
  "/src/domain/review-decision.ts",
);

test.after(async () => vite.close());

test("审核时限按承诺口径显示：关系 24 小时，其他事实 3 天", () => {
  assert.equal(freshnessBudgetLabel(24), "24 小时");
  assert.equal(freshnessBudgetLabel(72), "3 天");
  assert.deepEqual(freshnessTrackLabels, { relation: "可逐字核验的关系", fact: "其他事实" });
});

test("等待时长在两天内按小时、之后按天显示，无待审时明确说明", () => {
  assert.equal(freshnessAgeLabel(null), "无待审");
  assert.equal(freshnessAgeLabel(0.4), "不到 1 小时");
  assert.equal(freshnessAgeLabel(25.9), "25 小时");
  assert.equal(freshnessAgeLabel(73), "3 天");
});

test("无法归属实体是独立的驳回原因，不再并入结构错误", () => {
  assert.equal(reviewReasonCategoryLabels.entity_unresolved, "无法归属实体");
  assert.equal(resolveReviewReasonCategory("reject", "entity_unresolved"), "entity_unresolved");
  assert.equal(reviewReasonCategoryLabels.schema_error, "结构错误");
});
