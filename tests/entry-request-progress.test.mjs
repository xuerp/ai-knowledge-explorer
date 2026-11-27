import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { entryRequestProgress, hasOfficialPage, needsPerson, showsAutoDetail } =
  await vite.ssrLoadModule("/src/domain/entry-request-progress.ts");

test.after(async () => vite.close());

function row(overrides = {}) {
  return {
    id: "r",
    status: "pending",
    kind: "visitor",
    autoState: null,
    candidatesOpen: 0,
    candidatesApproved: 0,
    candidatesRejected: 0,
    sourceUrl: "https://example.com/model",
    autoDetail: null,
    ...overrides,
  };
}

test("收录请求只在自动处理不了时要求人工", () => {
  assert.equal(entryRequestProgress(row()).label, "等待自动处理");
  assert.equal(needsPerson(row()), false);

  const waiting = row({ status: "in-review", autoState: "candidates", candidatesOpen: 2 });
  assert.equal(entryRequestProgress(waiting).label, "已生成事实，待审核 2 条");
  assert.equal(needsPerson(waiting), false);

  assert.equal(needsPerson(row({ autoState: "skipped" })), true);
  assert.equal(needsPerson(row({ autoState: "no-evidence" })), true);
  // A failure is retried automatically, so it does not ask for a person yet.
  assert.equal(needsPerson(row({ autoState: "failed" })), false);

  const reviewed = row({ status: "in-review", autoState: "candidates", candidatesApproved: 1 });
  assert.equal(entryRequestProgress(reviewed).label, "事实已审核，下一轮自动结束");
  // Facts merged or removed from the queue can never close the request on their own.
  assert.equal(needsPerson(row({ status: "in-review", autoState: "candidates" })), true);

  const closed = row({ status: "resolved", autoState: "candidates" });
  assert.equal(entryRequestProgress(closed).tone, "done");
  assert.equal(needsPerson(closed), false);
});

test("收录请求不重复显示自动处理说明，也不把后台占位地址当官方页面", () => {
  assert.equal(showsAutoDetail({ ...row(), autoState: "candidates", autoDetail: "已生成" }), false);
  assert.equal(
    showsAutoDetail({ ...row(), autoState: "skipped", autoDetail: "域名不在名单" }),
    true,
  );
  assert.equal(
    hasOfficialPage(row({ sourceUrl: "https://airadar.rainza.cn/admin/review" })),
    false,
  );
  assert.equal(hasOfficialPage(row()), true);
});
