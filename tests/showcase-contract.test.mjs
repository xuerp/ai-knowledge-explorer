import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("公开首页先呈现产品价值，不被知识快照加载阻断", async () => {
  const source = await read("src/routes/index.tsx");

  assert.match(source, /持续追踪 AI 世界正在发生什么/);
  assert.match(source, /为什么不直接问 ChatGPT/);
  assert.match(source, /三个核心体验/);
  assert.match(source, /to="\/case-study"/);
  assert.match(source, /snapshotQuery\.data \?\? DEMO_KNOWLEDGE_SNAPSHOT/);
  assert.doesNotMatch(source, /if \(!snapshotQuery\.data\)\s*\{\s*return/);
});

test("产品 Case Study 是公开路由并覆盖关键产品决策", async () => {
  const [route, routeTree] = await Promise.all([
    read("src/routes/case-study.tsx"),
    read("src/routeTree.gen.ts"),
  ]);

  assert.match(route, /createFileRoute\("\/case-study"\)/);
  assert.match(route, /Candidate \/ Verified Claim/);
  assert.match(route, /Showcase 与 Live 分开/);
  assert.match(routeTree, /CaseStudyRoute/);
});

test("AI 对比默认提供 GPT、Claude、Gemini 系列级路线比较", async () => {
  const source = await read("src/routes/compare.tsx");

  assert.match(source, /useState<Scope>\("families"\)/);
  assert.match(source, /\["e-gpt", "e-claude", "e-gemini"\]/);
  assert.match(source, /AI 路线对比/);
  assert.match(source, /DEMO_KNOWLEDGE_SNAPSHOT\.entities/);
});

test("未登录访客可以运行预置研究且证据不足时明确拒答", async () => {
  const [route, adapter] = await Promise.all([
    read("src/routes/ask.tsx"),
    read("src/data/demo-adapter.ts"),
  ]);

  assert.match(route, /showcaseAnswers\.find/);
  assert.match(route, /snapshotQuery\.data \?\? DEMO_KNOWLEDGE_SNAPSHOT/);
  assert.match(route, /体验预置研究/);
  assert.match(adapter, /research-demo-gpt-claude/);
  assert.match(adapter, /research-demo-deepseek-cost/);
  assert.match(adapter, /research-demo-mcp-integrations/);
  assert.match(adapter, /status: "insufficient-evidence"/);
});
