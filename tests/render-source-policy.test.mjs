import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

test("Render 只将首批官方证据域名加入自动采集白名单", () => {
  assert.match(blueprint, /AI_RADAR_FETCH_ALLOWED_HOSTS/);
  for (const host of [
    "openai.com",
    "anthropic.com",
    "deepmind.google",
    "modelcontextprotocol.io",
    "docs.langchain.com",
    "arxiv.org",
  ]) {
    assert.match(blueprint, new RegExp(`(?:value: |,)${host.replaceAll(".", "\\.")}(?:,|$)`, "m"));
  }
  assert.doesNotMatch(blueprint, /news\.ycombinator\.com/);
});

test("信源策略保留逐个预检和人工启用边界", () => {
  assert.match(blueprint, /信源仍默认关闭自动采集/);
  assert.match(blueprint, /逐个启用并核验首次快照/);
});
