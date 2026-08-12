import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { isAllowlistedSource, selectRolloutSources } = await vite.ssrLoadModule(
  "/src/domain/source-rollout.ts",
);

test.after(async () => vite.close());

function source(id, url, changes = {}) {
  return {
    id,
    title: id,
    publisher: "Official",
    url,
    active: true,
    fetchEnabled: false,
    fetchIntervalMinutes: 240,
    consecutiveFailures: 0,
    ...changes,
  };
}

test("白名单匹配允许根域名和子域名，但拒绝伪装域名", () => {
  assert.equal(
    isAllowlistedSource(source("a", "https://docs.langchain.com/a"), ["langchain.com"]),
    true,
  );
  assert.equal(
    isAllowlistedSource(source("b", "https://langchain.com/a"), ["langchain.com"]),
    true,
  );
  assert.equal(
    isAllowlistedSource(source("c", "https://langchain.com.attacker.example/a"), ["langchain.com"]),
    false,
  );
});

test("批量接入只选择活跃、未启用、白名单内的信源并限制数量", () => {
  const selected = selectRolloutSources(
    [
      source("s-other", "https://allowed.example/other"),
      source("s-langchain-overview", "https://docs.langchain.com/overview"),
      source("s-disabled", "https://allowed.example/disabled", { active: false }),
      source("s-running", "https://allowed.example/running", { fetchEnabled: true }),
      source("s-outside", "https://outside.example/page"),
    ],
    ["langchain.com", "allowed.example"],
    2,
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["s-langchain-overview", "s-other"],
  );
});
