import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("公开质量页区分业务与评估更新时间并标注低频评估", async () => {
  const [route, api, topNav] = await Promise.all([
    read("src/routes/quality.tsx"),
    read("src/services/quality-api.ts"),
    read("src/components/layout/TopNav.tsx"),
  ]);

  assert.match(route, /createFileRoute\("\/quality"\)/);
  assert.match(route, /metrics\.data\.business\.updatedAt/);
  assert.match(route, /metrics\.data\.evaluation\.updatedAt/);
  assert.match(route, /不挂载到 30 分钟高频 Cron/);
  assert.match(route, /Recall@8/);
  assert.match(route, /Precision@8/);
  assert.match(api, /\/api\/quality\/metrics/);
  assert.match(topNav, /to="\/quality"/);
});
