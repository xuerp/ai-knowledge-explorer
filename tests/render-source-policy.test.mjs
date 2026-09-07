import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
const qualityWorkflow = await readFile(
  new URL("../.github/workflows/quality.yml", import.meta.url),
  "utf8",
);
const stagingAcceptanceWorkflow = await readFile(
  new URL("../.github/workflows/staging-acceptance.yml", import.meta.url),
  "utf8",
);
const packageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

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

test("Render 在已授权关系批次完成后关闭普通自动抽取", () => {
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE[\s\S]*?value: "0"/);
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_MAX_CANDIDATES_PER_SNAPSHOT\s+value: "10"/);
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_RETRY_MINUTES\s+value: "360"/);
  assert.match(blueprint, /AI_RADAR_RELATION_BACKFILL_BATCH_ID\s+value: 2026-09-core-relations-02/);
  assert.match(blueprint, /AI_RADAR_RELATION_BACKFILL_MAX_SNAPSHOTS\s+value: "4"/);
});

test("Render 只在生产化分支的 GitHub 检查通过后部署 API", () => {
  assert.match(blueprint, /branch: codex\/productionize/);
  assert.match(blueprint, /autoDeployTrigger: checksPass/);
  assert.doesNotMatch(blueprint, /autoDeployTrigger: commit/);
});

test("Cloudflare staging 部署独立等待前后端检查并使用固定 Wrangler", () => {
  assert.match(qualityWorkflow, /deploy-staging:[\s\S]*needs: \[frontend, backend\]/);
  assert.match(qualityWorkflow, /npx --no-install wrangler deploy/);
  assert.doesNotMatch(qualityWorkflow, /npx wrangler deploy/);
  assert.equal(packageManifest.devDependencies.wrangler, "4.120.0");
  assert.match(stagingAcceptanceWorkflow, /workflow_run:[\s\S]*workflows: \[Quality\]/);
  assert.match(stagingAcceptanceWorkflow, /AI_RADAR_EXPECTED_COMMIT/);
  assert.match(stagingAcceptanceWorkflow, /npm run smoke:staging/);
});
