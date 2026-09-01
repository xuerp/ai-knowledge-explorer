import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

test("Render 只将首批官方证据域名加入自动采集白名单", () => {
  assert.match(blueprint, /AI_RADAR_FETCH_ALLOWED_HOSTS/);
  for (const host of [
    "openai.com",
    "anthropic.com",
    "platform.claude.com",
    "deepmind.google",
    "modelcontextprotocol.io",
    "docs.langchain.com",
    "arxiv.org",
    "raw.githubusercontent.com",
    "microsoft.github.io",
    "docs.crewai.com",
    "docs.devin.ai",
    "help.manus.im",
  ]) {
    assert.match(blueprint, new RegExp(`(?:value: |,)${host.replaceAll(".", "\\.")}(?:,|$)`, "m"));
  }
  assert.doesNotMatch(blueprint, /news\.ycombinator\.com/);
});

test("信源策略保留批量安全预检和人工审核边界", () => {
  assert.match(blueprint, /信源仍默认关闭自动采集/);
  assert.match(blueprint, /通过批量安全预检后启用，并核验首次快照/);
  assert.match(blueprint, /AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS\s+value: "false"/);
});

test("Render 自动抽取吞吐与失败退避保持保守上限", () => {
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE\s+value: "2"/);
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_MAX_CANDIDATES_PER_SNAPSHOT\s+value: "10"/);
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_RETRY_MINUTES\s+value: "360"/);
});

test("Render 在生产化分支提交后自动部署 API", () => {
  assert.match(blueprint, /branch: codex\/productionize/);
  assert.match(blueprint, /autoDeployTrigger: commit/);
});
