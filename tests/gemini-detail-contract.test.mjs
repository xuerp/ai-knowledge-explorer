import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(await readFile("backend/data/frontier_catalog_v1.json", "utf8"));
const gemini = catalog.entities.filter((entity) => entity.familyId === "e-gemini");

test("Gemini concrete releases have a product line and reviewed capability", () => {
  assert.ok(gemini.length >= 30);
  for (const entity of gemini) {
    assert.ok(entity.release?.productLine?.id, `${entity.id} lacks a product line`);
    assert.ok(entity.specs, `${entity.id} lacks a specification snapshot`);
    if (entity.release.stage !== "pending") {
      assert.ok(entity.capabilities?.length, `${entity.id} lacks reviewed capabilities`);
    }
  }
});

test("specialized current Gemini profiles keep concrete official specifications", () => {
  const byId = new Map(gemini.map((entity) => [entity.id, entity]));
  const live = byId.get("e-gemini-38-live");
  const omni = byId.get("e-gemini-omni-flash");
  assert.equal(live.specs.contextWindow, "131,072 input · 65,536 output tokens");
  assert.equal(live.capabilities.length, 3);
  assert.equal(omni.release.stage, "stable");
  assert.equal(omni.specs.contextWindow, "1,048,576 input tokens");
  for (const entity of [live, omni]) {
    const url = entity.release.accessChannels[0].url;
    assert.ok(catalog.evidence.some((source) => source.url === url));
  }
});

test("detail page reads relationship evidence through the snapshot graph", async () => {
  const route = await readFile("src/routes/knowledge_.model.$slug.tsx", "utf8");
  assert.match(route, /snapshot\.graph\?\.edges \?\? \[\]/);
  assert.doesNotMatch(route, /snapshot\.relations/);
});

test("short release tabs do not inherit the long product-line sidebar height", async () => {
  const [route, styles] = await Promise.all([
    readFile("src/routes/knowledge_.model.$slug.tsx", "utf8"),
    readFile("src/styles.css", "utf8"),
  ]);
  assert.match(
    route,
    /const showVersionAside = activeTab === "overview" \|\| activeTab === "specs"/,
  );
  assert.match(route, /showVersionAside && \(\s*<aside className="model-version__aside">/);
  assert.match(
    styles,
    /\.model-version__layout\.is-compact\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
  );
  assert.doesNotMatch(styles, /\.model-version__aside\s*\{[^}]*grid-row:\s*1\s*\/\s*span\s*3/s);
  assert.doesNotMatch(styles, /\.model-version-page\s*\{[^}]*min-height:\s*100vh/s);
});

test("family reading modes expose a quiet boundary note and distinct line views", async () => {
  const [route, article, styles] = await Promise.all([
    readFile("src/routes/knowledge_.model.$slug.tsx", "utf8"),
    readFile("src/components/knowledge/KnowledgeArticle.tsx", "utf8"),
    readFile("src/styles.css", "utf8"),
  ]);
  assert.match(route, /mode === "technical" \? \(/);
  assert.match(route, /mode === "product" && \(/);
  assert.match(route, /className="model-family__all-versions"/);
  assert.match(article, /className="knowledge-boundary"/);
  assert.match(
    styles,
    /\.knowledge-boundary\s*\{[^}]*border-top:\s*1px solid var\(--color-border\)/s,
  );
});

test("family sources stay focused on evidence and product copy names the actual section", async () => {
  const [route, article] = await Promise.all([
    readFile("src/routes/knowledge_.model.$slug.tsx", "utf8"),
    readFile("src/components/knowledge/KnowledgeArticle.tsx", "utf8"),
  ]);
  assert.doesNotMatch(route, /三种深度共享同一份已审核知识/);
  assert.doesNotMatch(route, /competitors\.slice\(0, 4\)/);
  assert.match(article, /title=\{t\("产品决策", "Product decision"\)\}/);
  assert.doesNotMatch(article, /产品决策视图/);
});
