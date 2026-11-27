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

test("Render 普通自动抽取限量开启：每轮 1 个快照、每天最多 50 个", () => {
  // 2026-11-26 用户同意打开，用于自动收录官方新模型；2026-11-27 用户把每日上限调到 50。
  // 再调大前需要再次确认。
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE[\s\S]*?value: "1"/);
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_DAY\s+value: "50"/);
  assert.match(blueprint, /AI_RADAR_AUTO_CREATE_NEW_MODELS[\s\S]*?value: "true"/);
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_MAX_CANDIDATES_PER_SNAPSHOT\s+value: "5"/);
  assert.match(blueprint, /AI_RADAR_AUTO_EXTRACTION_RETRY_MINUTES\s+value: "360"/);
  assert.match(blueprint, /AI_RADAR_RELATION_BACKFILL_BATCH_ID\s+value: 2026-09-core-relations-02/);
  assert.match(blueprint, /AI_RADAR_RELATION_BACKFILL_MAX_SNAPSHOTS\s+value: "4"/);
});

test("Render 与网站由同一受测试门禁保护的 main 发布任务部署", () => {
  assert.match(blueprint, /branch: main/);
  assert.match(qualityWorkflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(blueprint, /autoDeployTrigger: off/);
  assert.doesNotMatch(blueprint, /autoDeployTrigger: commit/);
  const releaseJob = qualityWorkflow.slice(qualityWorkflow.indexOf("  deploy-staging:"));
  assert.match(releaseJob, /github.event_name == 'push'/);
  assert.match(releaseJob, /needs: \[frontend, backend\]/);
  assert.match(releaseJob, /node scripts\/deploy-render-staging\.mjs/);
  assert.match(
    releaseJob,
    /deploy-render-staging\.mjs[\s\S]*wait-staging-release\.mjs --backend-only[\s\S]*wrangler deploy/,
  );
  assert.match(
    releaseJob,
    /RENDER_STAGING_DEPLOY_HOOK: \$\{\{ secrets\.RENDER_STAGING_DEPLOY_HOOK \}\}/,
  );
  assert.doesNotMatch(releaseJob, /continue-on-error/);
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
