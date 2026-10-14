import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("公开质量页区分业务更新时间与历史评估适用性", async () => {
  const [route, api, topNav] = await Promise.all([
    read("src/routes/quality.tsx"),
    read("src/services/quality-api.ts"),
    read("src/components/layout/TopNav.tsx"),
  ]);

  assert.match(route, /createFileRoute\("\/quality"\)/);
  assert.match(route, /metrics\.data\.business\.updatedAt/);
  assert.match(route, /metrics\.data\.evaluation\.updatedAt/);
  assert.match(route, /历史基线 · 不代表当前检索表现/);
  assert.match(route, /刷新会核对报告的适用范围，不会重新运行评估/);
  assert.match(route, /missingExpectedClaimSampleCount/);
  assert.match(route, /<details/);
  assert.match(api, /applicability\?/);
  assert.match(route, /Recall@8/);
  assert.match(route, /Precision@8/);
  assert.match(api, /\/api\/quality\/metrics/);
  assert.match(topNav, /to="\/quality"/);
});
