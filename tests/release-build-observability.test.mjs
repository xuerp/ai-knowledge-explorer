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
  assert.match(apiSource, /\/api\/v2\/admin\/claim-entity-repair/);
  assert.match(apiSource, /\/api\/v2\/admin\/relation-claim-audit/);
  assert.match(apiSource, /\/api\/v2\/admin\/relation-claim-repair/);
  assert.match(reviewSource, /workspace\.build\.buildCommit\.slice/);
  assert.match(reviewSource, /Claim 实体关联审计/);
  assert.match(reviewSource, /历史关系 Claim 审计/);
  assert.match(reviewSource, /人工关联实体/);
  assert.match(reviewSource, /撤回抽取噪声/);
  assert.match(reviewSource, /采纳关联建议/);
  assert.match(reviewSource, /确认撤回噪声/);
  assert.match(apiSource, /\/api\/v2\/admin\/claim-entity-resolution/);
  assert.match(reviewSource, /deterministicRepairCount/);
  assert.match(reviewSource, /运行确定性 Dry Run/);
  assert.match(reviewSource, /claimEntityRepair\(token, mode, claimIds\)/);
  assert.match(reviewSource, /classifyReviewLane\(item, approvedHistory\) === "fresh-safe"/);
  assert.match(reviewSource, /批准新鲜安全候选/);
});

test("审核认证成功不会被后续工作区请求伪装成持续登录", () => {
  const authenticatedAt = reviewSource.indexOf("setUser(response.user)");
  const workspaceRefreshAt = reviewSource.indexOf("await refresh(response.accessToken)");

  assert.ok(authenticatedAt >= 0);
  assert.ok(workspaceRefreshAt > authenticatedAt);
  assert.match(reviewSource, /登录成功，正在加载审核工作区/);
  assert.match(reviewSource, /重试加载/);
  assert.match(apiSource, /timeoutMs = 30_000/);
});

test("生产预检在基础工作区显示后再加载，避免重复质量评估争抢连接", () => {
  const workspaceStart = apiSource.indexOf("async workspace(token:");
  const workspaceEnd = apiSource.indexOf("\n  decide:", workspaceStart);
  const workspaceSource = apiSource.slice(workspaceStart, workspaceEnd);

  assert.doesNotMatch(workspaceSource, /生产预检/);
  assert.match(reviewSource, /adminApi\.productionReadiness\(token\)/);
});

test("刷新后台会先恢复现有会话而不是闪回登录表单", () => {
  const restoreStateAt = reviewSource.indexOf("sessionChecking && !user");
  const loginFormAt = reviewSource.indexOf("if (!user) {", restoreStateAt);

  assert.ok(restoreStateAt >= 0);
  assert.ok(loginFormAt > restoreStateAt);
  assert.match(reviewSource, /正在恢复登录状态/);
  assert.match(reviewSource, /setUser\(currentUser\);[\s\S]*adminApi\.workspace/);
});
