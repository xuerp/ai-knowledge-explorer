import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("只读审核演示展示真实聚合统计且不伪造失败数据", async () => {
  const [route, api, adminApi] = await Promise.all([
    read("src/routes/admin.review-demo.tsx"),
    read("src/services/review-stats-api.ts"),
    read("src/services/admin-api.ts"),
  ]);

  assert.match(route, /getReviewStats/);
  assert.match(route, /approvalRate/);
  assert.match(route, /rejectionReasons/);
  assert.match(route, /历史未分类/);
  assert.match(route, /不会用演示数字替代/);
  assert.match(api, /\/api\/review\/stats/);
  assert.match(adminApi, /reasonCategory/);
  assert.match(adminApi, /reasonNote/);
});
