import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { describeProbeFailure, formatRolloutSummary, isAllowlistedSource, selectRolloutSources } =
  await vite.ssrLoadModule("/src/domain/source-rollout.ts");

test.after(async () => vite.close());

function source(id, url, changes = {}) {
  return {
    id,
    title: id,
    publisher: "Official",
    url,
    effectiveFetchUrl: url,
    fallbackUrls: [],
    healthState: "unverified",
    active: true,
    fetchEnabled: false,
    fetchIntervalMinutes: 240,
    consecutiveFailures: 0,
    collectionStrategy: "unverified",
    collectionReason: "尚未验证",
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
  assert.equal(
    isAllowlistedSource(
      source("fallback", "https://official.example/evidence", {
        effectiveFetchUrl: "https://docs.official.example/page.md",
        fallbackUrls: ["https://attacker.example/fallback"],
      }),
      ["official.example"],
    ),
    false,
  );
});

test("批量接入只选择经过验证、活跃、未启用且在白名单内的信源", () => {
  const selected = selectRolloutSources(
    [
      source("s-other", "https://allowed.example/other"),
      source("s-langchain-overview", "https://docs.langchain.com/overview", {
        collectionStrategy: "automatic",
      }),
      source("s-anthropic-company", "https://anthropic.com/company", {
        collectionStrategy: "automatic",
      }),
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

test("批量接入不会把人工或未验证入口当作兜底候选", () => {
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

test("批量接入接受后端标记为自动的稳定机器入口", () => {
  const selected = selectRolloutSources(
    [
      source("s-qwen-models", "https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md", {
        collectionStrategy: "automatic",
      }),
      source(
        "s-swebench",
        "https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/info_for_leaderboard.json",
        { collectionStrategy: "automatic" },
      ),
    ],
    ["raw.githubusercontent.com"],
  );
  assert.deepEqual(
    selected.map((item) => item.id),
    ["s-qwen-models", "s-swebench"],
  );
});

test("常见预检错误会转换为可操作的中文说明", () => {
  assert.match(describeProbeFailure("Client error '403 Forbidden'"), /拒绝云服务器访问/);
  assert.match(describeProbeFailure("Source document exceeds AI_RADAR_FETCH_MAX_BYTES."), /体积/);
  assert.match(
    describeProbeFailure("Source hostname is not in AI_RADAR_FETCH_ALLOWED_HOSTS."),
    /白名单/,
  );
});

test("批量接入汇总区分首次采集、运行中、自动重试和接入失败", () => {
  const summary = formatRolloutSummary([
    {
      source: source("collected", "https://allowed.example/collected"),
      enabled: true,
      firstCollection: "completed",
    },
    {
      source: source("running", "https://allowed.example/running"),
      enabled: true,
      firstCollection: "running",
    },
    {
      source: source("retrying", "https://allowed.example/retrying"),
      enabled: true,
      firstCollection: "scheduled",
      reason: "首次访问超时",
    },
    {
      source: source("blocked", "https://blocked.example/page"),
      enabled: false,
      reason: "连接预检失败",
    },
  ]);
  assert.match(summary, /首次采集完成 1 个/);
  assert.match(summary, /调度器正在处理 1 个/);
  assert.match(summary, /等待自动重试 1 个/);
  assert.match(summary, /接入失败保持关闭 1 个/);
  assert.match(summary, /retrying（首次访问超时）/);
  assert.match(summary, /blocked（连接预检失败）/);
});
