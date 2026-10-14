import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repository = await readFile("src/services/knowledge-repository.ts", "utf8");
const reviewedFacts = await readFile("src/components/knowledge/ReviewedFacts.tsx", "utf8");

test("全部事实支持服务端检索与游标分页且保留快照兼容", () => {
  assert.match(repository, /\/api\/v2\/snapshot/);
  assert.match(repository, /\/api\/v2\/entities\/\$\{encodeURIComponent\(entityId\)\}\/claims/);
  assert.match(repository, /params\.set\("cursor", cursor\)/);
  assert.match(reviewedFacts, /getEntityClaims\([\s\S]*?entityId,[\s\S]*?"all"/);
  assert.match(reviewedFacts, /FACT_PAGE_SIZE = 8/);
  assert.match(repository, /params\.set\("q", filters\.q\.trim\(\)\)/);
  assert.match(repository, /params\.set\("topic", filters\.topic\)/);
});
