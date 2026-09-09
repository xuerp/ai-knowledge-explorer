import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("公开首页先呈现产品价值，不被知识快照加载阻断", async () => {
  const source = await read("src/routes/index.tsx");

  assert.match(source, /基于可验证的最新变化，做出更可靠的 AI 选择/);
  assert.match(source, /GPT、Claude、Gemini/);
  assert.match(source, /变化追踪|Change tracking/);
  assert.match(source, /核心模型宇宙|Core model universe/);
  assert.match(source, /"gpt", "claude", "gemini"/);
  assert.match(source, /"deepseek"[\s\S]*"qwen"[\s\S]*"kimi"[\s\S]*"doubao"[\s\S]*"ernie"/);
  const coreEntitySelection = source.match(
    /const coreEntities =[\s\S]*?;\r?\n  const resetFilters/,
  )?.[0];
  assert.ok(coreEntitySelection);
  assert.doesNotMatch(coreEntitySelection, /\.slice\(/);
  assert.match(source, /snapshotQuery\.data \?\? DEMO_KNOWLEDGE_SNAPSHOT/);
  assert.doesNotMatch(source, /if \(!snapshotQuery\.data\)\s*\{\s*return/);
});

test("决策助手进入一级导航，关系图谱只保留二级入口", async () => {
  const [topNav, bottomNav, modelPage] = await Promise.all([
    read("src/components/layout/TopNav.tsx"),
    read("src/components/layout/BottomNav.tsx"),
    read("src/routes/knowledge_.model.$slug.tsx"),
  ]);

  assert.match(topNav, /to: "\/ask", zh: "决策助手"/);
  assert.doesNotMatch(topNav, /to: "\/graph"/);
  assert.match(bottomNav, /to: "\/ask", icon: Sparkles, zh: "决策"/);
  assert.doesNotMatch(bottomNav, /to: "\/graph"/);
  assert.match(modelPage, /查看完整关系网络/);
  assert.match(modelPage, /search=\{\{ entity: e\.id, mode: "ecosystem" \}\}/);
  assert.doesNotMatch(modelPage, /<KnowledgeGraph/);
  assert.equal((modelPage.match(/<TimelineHero/g) ?? []).length, 1);
  assert.doesNotMatch(modelPage, /版本演进时间线/);
});

test("产品 Case Study 是公开路由并覆盖关键产品决策", async () => {
  const [route, routeTree, root] = await Promise.all([
    read("src/routes/case-study.tsx"),
    read("src/routeTree.gen.ts"),
    read("src/routes/__root.tsx"),
  ]);

  assert.match(route, /createFileRoute\("\/case-study"\)/);
  assert.match(route, /Candidate \/ Verified Claim/);
  assert.match(route, /Showcase 与 Live 分开/);
  assert.match(route, /追踪器 · 高频入口/);
  assert.match(route, /知识关系 · 可信基础/);
  assert.match(route, /决策助手 · 核心价值/);
  assert.match(route, /8–10 个核心模型/);
  assert.match(root, /og:title", content: "AI Radar · 基于可信变化做出 AI 选择"/);
  assert.match(routeTree, /CaseStudyRoute/);
});

test("AI 对比默认提供 GPT、Claude、Gemini 系列级路线比较", async () => {
  const source = await read("src/routes/compare.tsx");

  assert.match(source, /resolveComparisonSelection/);
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
  assert.match(route, /AI 决策助手/);
  assert.match(route, /任务、优先级、预算和部署限制/);
  assert.match(route, /体验预置研究/);
  assert.match(adapter, /research-demo-gpt-claude/);
  assert.match(adapter, /research-demo-deepseek-cost/);
  assert.match(adapter, /research-demo-mcp-integrations/);
  assert.match(adapter, /status: "insufficient-evidence"/);
});
