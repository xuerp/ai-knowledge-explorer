import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../src/services/admin-api.ts", import.meta.url), "utf8");
const reviewSource = await readFile(
  new URL("../src/routes/admin.review.tsx", import.meta.url),
  "utf8",
);

test("审核后台展示后端构建与 Claim 实体关联审计", () => {
  assert.match(apiSource, /request<HealthStatus>\("\/health"/);
  assert.match(apiSource, /\/api\/v2\/admin\/claim-entity-audit/);
  assert.match(reviewSource, /workspace\.build\.buildCommit\.slice/);
  assert.match(reviewSource, /Claim 实体关联审计/);
  assert.match(reviewSource, /deterministicRepairCount/);
});
