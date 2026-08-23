import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { getVisibleEntitySections } = await vite.ssrLoadModule("/src/domain/reading-mode.ts");
const { claimTextForReadingMode, rankClaimsForReadingMode } = await vite.ssrLoadModule(
  "/src/domain/claim-reading-mode.ts",
);

test.after(async () => vite.close());

const modelSections = [
  "guide",
  "profile",
  "claims",
  "lineage",
  "relationships",
  "timeline",
  "comparison",
  "questions",
  "evidence",
];

test("三种阅读模式拥有不同的模型页信息集合", () => {
  const general = getVisibleEntitySections("general", "model", modelSections);
  const product = getVisibleEntitySections("product", "model", modelSections);
  const technical = getVisibleEntitySections("technical", "model", modelSections);

  assert.deepEqual(general, ["guide", "claims", "lineage", "timeline", "questions"]);
  assert.deepEqual(product, [
    "guide",
    "claims",
    "lineage",
    "relationships",
    "timeline",
    "comparison",
  ]);
  assert.deepEqual(technical, [
    "guide",
    "profile",
    "claims",
    "lineage",
    "relationships",
    "timeline",
    "evidence",
  ]);
});

test("产品与技术模式按语义优先展示不同事实", () => {
  const claims = [
    {
      id: "general",
      updatedAt: "2026-08-23",
      text: { zh: "团队公布了新消息", en: "The team shared an update" },
      confidence: "verified",
      sourceIds: [],
    },
    {
      id: "product",
      updatedAt: "2026-08-22",
      predicate: "pricing availability",
      text: { zh: "产品价格与可用范围更新", en: "Pricing and availability changed" },
      confidence: "verified",
      sourceIds: [],
    },
    {
      id: "technical",
      updatedAt: "2026-08-21",
      predicate: "context benchmark api",
      text: {
        zh: "技术能力更新",
        en: "Technical capability update",
        technical: { zh: "API 上下文与评测指标更新", en: "API context and benchmark update" },
      },
      confidence: "verified",
      sourceIds: [],
    },
  ];

  assert.equal(rankClaimsForReadingMode(claims, "product")[0].id, "product");
  assert.equal(rankClaimsForReadingMode(claims, "technical")[0].id, "technical");
  assert.equal(claimTextForReadingMode(claims[2], "technical").zh, "API 上下文与评测指标更新");
  assert.equal(claimTextForReadingMode(claims[2], "product").zh, "技术能力更新");
});
