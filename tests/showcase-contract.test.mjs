import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("公开首页仅在演示模式展示示例，API 不可用时显式提示", async () => {
  const [source, repository] = await Promise.all([
    read("src/routes/updates.tsx"),
    read("src/services/knowledge-repository.ts"),
  ]);

  assert.match(source, /把近期模型变化按时间排开，选择节点即可查看证据/);
  assert.match(source, /变化追踪|Change tracking/);
  assert.match(source, /模型家族|Model families/);
  assert.match(source, /browseModelFamilies\(snapshot.entities\)/);
  const coreEntitySelection = source.match(
    /const coreEntities =[\s\S]*?;\r?\n  const resetFilters/,
  )?.[0];
  assert.ok(coreEntitySelection);
  assert.doesNotMatch(coreEntitySelection, /\.slice\(/);
  assert.match(source, /if \(!liveSnapshot\)\s*\{\s*return/);
  assert.match(source, /onRetry=\{snapshotQuery\.error/);
  assert.doesNotMatch(source, /snapshotQuery\.data \?\? DEMO_KNOWLEDGE_SNAPSHOT/);
  assert.doesNotMatch(source, /useSyncExternalStore|subscribeToHydration/);
  assert.match(source, /const snapshot = liveSnapshot;/);
  assert.doesNotMatch(source, /DEMO_KNOWLEDGE_SNAPSHOT|fallbackToDemoSnapshot/);
  assert.match(source, /filteredChanges\.slice\(pageIndex \* 6/);
  assert.match(source, /动态分页/);
  assert.match(source, /模型家族/);
  assert.match(source, /没有符合条件的变化/);
  assert.match(source, /当前筛选组合没有已收录事件/);
  assert.match(source, /hasFilteredChanges && selectedChange && selectedEntity \?/);
  assert.doesNotMatch(source, /if \(!selectedChange \|\| !selectedEntity\)/);
  assert.doesNotMatch(
    source,
    /latest \? pick\(latest\.summary, lang\) : pick\(entity\.summary, lang\)/,
  );
  assert.match(
    repository,
    /if \(!snapshot\) throw new Error\("Knowledge snapshot is unavailable"\)/,
  );
});

test("营销首页与动态雷达使用独立路由，旧入口保留兼容跳转", async () => {
  const [home, updates, legacy, topNav, bottomNav] = await Promise.all([
    read("src/routes/index.tsx"),
    read("src/routes/updates.tsx"),
    read("src/routes/landing.tsx"),
    read("src/components/layout/TopNav.tsx"),
    read("src/components/layout/BottomNav.tsx"),
  ]);

  assert.match(home, /createFileRoute\("\/"\)/);
  assert.match(home, /\/updates#latest/);
  assert.doesNotMatch(home, /\/#latest/);
  assert.match(updates, /createFileRoute\("\/updates"\)/);
  assert.match(legacy, /redirect\(\{ to: "\/", replace: true \}\)/);
  assert.match(topNav, /to: "\/updates", zh: "动态"/);
  assert.match(bottomNav, /to: "\/updates", icon: Activity, zh: "动态"/);
});

test("知识快照首帧不根据服务端与浏览器的 API 模式注入不同数据", async () => {
  const hook = await read("src/hooks/use-knowledge.ts");

  assert.doesNotMatch(hook, /initialData:/);
  assert.match(hook, /queryFn: \(\{ signal \}\) => knowledgeRepository\.getSnapshot\(signal\)/);
});

test("决策助手与图谱进入一级导航，家族页保留时间线和来源", async () => {
  const [topNav, bottomNav, modelPage] = await Promise.all([
    read("src/components/layout/TopNav.tsx"),
    read("src/components/layout/BottomNav.tsx"),
    read("src/routes/knowledge_.model.$slug.tsx"),
  ]);

  assert.match(topNav, /to: "\/ask", zh: "决策助手"/);
  assert.match(topNav, /to: "\/graph", zh: "知识图谱"/);
  assert.match(bottomNav, /to: "\/ask", icon: Sparkles, zh: "决策"/);
  assert.match(bottomNav, /to: "\/graph", icon: Network/);
  assert.doesNotMatch(modelPage, /查看完整关系网络/);
  assert.doesNotMatch(modelPage, /to="\/graph"/);
  assert.doesNotMatch(modelPage, /<KnowledgeGraph/);
  assert.equal((modelPage.match(/<FamilyTimeline/g) ?? []).length, 1);
  assert.match(modelPage, /section="evidence"/);
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

test("模型对比提供系列与具体版本两种范围", async () => {
  const source = await read("src/routes/compare.tsx");

  assert.match(source, /resolveComparisonSelection/);
  assert.match(source, /模型对比/);
  assert.match(source, /DEMO_KNOWLEDGE_SNAPSHOT\.entities/);
});

test("未登录访客可以运行预置研究且证据不足时明确拒答", async () => {
  const [route, adapter] = await Promise.all([
    read("src/routes/ask.tsx"),
    read("src/data/demo-adapter.ts"),
  ]);

  assert.match(route, /showcaseAnswers\.find/);
  assert.match(route, /knowledgeRepository\.mode === "demo" \? DEMO_KNOWLEDGE_SNAPSHOT : null/);
  assert.doesNotMatch(route, /snapshotQuery\.data \?\? DEMO_KNOWLEDGE_SNAPSHOT/);
  assert.match(route, /AI 决策助手/);
  assert.match(route, /任务、预算与部署限制/);
  assert.match(route, /体验预置研究/);
  assert.match(adapter, /research-demo-gpt-claude/);
  assert.match(adapter, /research-demo-deepseek-cost/);
  assert.match(adapter, /research-demo-mcp-integrations/);
  assert.match(adapter, /status: "insufficient-evidence"/);
});
