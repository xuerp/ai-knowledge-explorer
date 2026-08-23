import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const read = (file) => readFile(path.resolve(process.cwd(), file), "utf8");

test("阅读模式由一份共享配置驱动顶部入口与设置页", async () => {
  const [config, topNav, settings] = await Promise.all([
    read("src/domain/reading-mode.ts"),
    read("src/components/layout/TopNav.tsx"),
    read("src/routes/settings.tsx"),
  ]);

  for (const mode of ["general", "product", "technical"]) {
    assert.match(config, new RegExp(`id: "${mode}"`));
  }
  assert.match(config, /READING_MODE_OPTIONS/);
  assert.match(config, /knowledgeBlockOrder: \["guide", "use-cases", "limitations"\]/);
  assert.match(config, /knowledgeBlockOrder: \["use-cases", "limitations", "guide"\]/);
  assert.match(topNav, /currentReadingMode/);
  assert.match(topNav, /currentReadingMode\.shortLabel/);
  assert.match(topNav, /hidden gap-2 px-2\.5 lg:inline-flex/);
  assert.match(settings, /READING_MODE_OPTIONS\.map/);
});

test("模型与通用实体页按阅读模式展示不同重点信息", async () => {
  const [config, article, modelPage, entityPage] = await Promise.all([
    read("src/domain/reading-mode.ts"),
    read("src/components/knowledge/KnowledgeArticle.tsx"),
    read("src/routes/knowledge_.model.$slug.tsx"),
    read("src/routes/knowledge_.$type.$slug.tsx"),
  ]);

  assert.match(config, /getEntitySectionPresentation/);
  assert.match(config, /getVisibleEntitySections/);
  assert.match(config, /ENTITY_SECTION_DENSITY/);
  assert.match(config, /knowledgeBlockOrder/);
  assert.match(
    config,
    /technical: \[\s*"profile",\s*"lineage",\s*"claims",\s*"relationships",\s*"timeline",\s*"evidence",\s*"guide"/,
  );
  assert.match(
    config,
    /product: \["guide", "claims", "relationships", "timeline", "profile", "evidence"\]/,
  );
  assert.match(article, /data-reading-block="guide"/);
  assert.match(article, /data-reading-block="use-cases"/);
  assert.match(article, /data-reading-block="limitations"/);
  assert.match(article, /data-reading-view="general"/);
  assert.match(article, /data-reading-view="product"/);
  assert.match(article, /data-reading-view="technical"/);
  assert.match(modelPage, /data-reading-section="profile"/);
  assert.match(modelPage, /data-reading-section="lineage"/);
  assert.match(modelPage, /hidden=\{!sectionVisible\("comparison"\)\}/);
  assert.match(modelPage, /data-reading-focus=\{mode\}/);
  assert.match(entityPage, /data-reading-section="relationships"/);
  assert.match(entityPage, /data-reading-section="evidence"/);
  assert.match(entityPage, /hidden=\{!sectionVisible\("evidence"\)\}/);
});
