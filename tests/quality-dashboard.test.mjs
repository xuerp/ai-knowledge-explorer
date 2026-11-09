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
  assert.match(route, /formatDateTime\(e\.updatedAt/);
  assert.match(route, /历史评估 · 适用于原报告快照/);
  assert.match(route, /刷新核对数据与报告状态，检索成绩在完成新一轮评估后更新/);
  assert.match(route, /missingExpectedClaimSampleCount/);
  assert.match(route, /<details/);
  assert.match(api, /applicability\?/);
  assert.match(route, /Recall@8/);
  assert.match(route, /Precision@8/);
  assert.match(api, /\/api\/quality\/metrics/);
  assert.match(topNav, /to="\/quality"/);
});
