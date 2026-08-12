import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { describeProbeFailure, isAllowlistedSource, selectRolloutSources } =
  await vite.ssrLoadModule("/src/domain/source-rollout.ts");

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

test("批量接入只选择经过验证、活跃、未启用且在白名单内的信源", () => {
  const selected = selectRolloutSources(
    [
      source("s-other", "https://allowed.example/other"),
      source("s-langchain-overview", "https://docs.langchain.com/overview"),
      source("s-anthropic-company", "https://anthropic.com/company"),
      source("s-disabled", "https://allowed.example/disabled", { active: false }),
      source("s-running", "https://allowed.example/running", { fetchEnabled: true }),
      source("s-outside", "https://outside.example/page"),
    ],
    ["langchain.com", "anthropic.com", "allowed.example"],
    2,
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["s-langchain-overview", "s-anthropic-company"],
  );
});

test("批量接入不会把 OpenAI、Qwen 或大型排行榜当作兜底候选", () => {
  const selected = selectRolloutSources(
    [
      source("s-openai-about", "https://openai.com/our-structure/"),
      source("s-openai-codex", "https://openai.com/index/introducing-codex/"),
      source("s-qwen-models", "https://qwenlm.ai/"),
      source("s-swebench", "https://www.swebench.com/"),
    ],
    ["openai.com", "qwenlm.ai", "swebench.com"],
  );
  assert.deepEqual(selected, []);
});

test("常见预检错误会转换为可操作的中文说明", () => {
  assert.match(describeProbeFailure("Client error '403 Forbidden'"), /拒绝云服务器访问/);
  assert.match(describeProbeFailure("Source document exceeds AI_RADAR_FETCH_MAX_BYTES."), /体积/);
  assert.match(
    describeProbeFailure("Source hostname is not in AI_RADAR_FETCH_ALLOWED_HOSTS."),
    /白名单/,
  );
});
