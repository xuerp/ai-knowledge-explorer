import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repository = await readFile("src/services/knowledge-repository.ts", "utf8");
const reviewedFacts = await readFile("src/components/knowledge/ReviewedFacts.tsx", "utf8");

test("实体事实历史使用服务端范围与游标分页且保留快照兼容", () => {
  assert.match(repository, /\/api\/v2\/snapshot/);
  assert.match(repository, /\/api\/v2\/entities\/\$\{encodeURIComponent\(entityId\)\}\/claims/);
  assert.match(repository, /params\.set\("cursor", cursor\)/);
  assert.match(reviewedFacts, /getEntityClaims\(entityId, "history"/);
  assert.match(reviewedFacts, /HISTORY_PAGE_SIZE = 10/);
});
