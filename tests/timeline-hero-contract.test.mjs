import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const read = (file) => readFile(path.resolve(process.cwd(), file), "utf8");

test("时间线详情使用文档流布局，并将桌面与移动视图明确分流", async () => {
  const [component, styles] = await Promise.all([
    read("src/components/knowledge/TimelineHero.tsx"),
    read("src/styles.css"),
  ]);

  assert.match(component, /className="relative hidden md:block"/);
  assert.match(component, /className="mt-6 space-y-4 md:hidden"/);
  assert.match(component, /aria-expanded=\{isExpanded\}/);
  assert.match(component, /aria-controls=\{detailsId\}/);
  assert.match(component, /id=\{detailsId\}/);
  assert.match(component, /className="timeline-event-card[^\"]*w-full/);
  assert.doesNotMatch(styles, /\.timeline-event-card\s*\{[^}]*position:\s*absolute/s);
});

test("阅读模式选择器不再用高层级 sticky 容器覆盖顶部导航", async () => {
  const [selector, styles] = await Promise.all([
    read("src/components/knowledge/ReadingModeSelector.tsx"),
    read("src/styles.css"),
  ]);

  assert.match(selector, /overflow-x-auto/);
  assert.match(selector, /overflow-y-hidden/);
  assert.match(selector, /shrink-0/);
  assert.doesNotMatch(styles, /\.reading-mode-selector\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(styles, /\.reading-mode-selector\s*\{[^}]*z-index:\s*40/s);
});
