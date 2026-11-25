import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Only the pure mapping is tested; the component needs a browser document.
const source = await readFile(new URL("../src/lib/page-title.ts", import.meta.url), "utf8");
const mapping = source
  .replace(/^import .*$/gm, "")
  .replace(/\/\*\* Keeps the tab title[\s\S]*$/, "");
const compiled = ts.transpileModule(mapping, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { localizedTitle } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("Chinese stays as the route wrote it", () => {
  assert.equal(localizedTitle("账户 · AI Radar", "zh"), "账户 · AI Radar");
});

test("every route title has an English tab title", async () => {
  const { readdir } = await import("node:fs/promises");
  const routes = new URL("../src/routes/", import.meta.url);
  for (const name of await readdir(routes)) {
    if (!name.endsWith(".tsx")) continue;
    const text = await readFile(new URL(name, routes), "utf8");
    for (const [, title] of text.matchAll(/\{ title: "([^"]+)" \}/g)) {
      const english = localizedTitle(title, "en");
      assert.doesNotMatch(english, /[\u3400-\u9fff]/, `${name}: ${title} -> ${english}`);
    }
  }
});

test("product names in entity titles are kept, unknown titles untouched", () => {
  assert.equal(localizedTitle("GPT-5 · AI Radar", "en"), "GPT-5 · AI Radar");
  assert.equal(localizedTitle("审核工作台 · AI Radar", "en"), "Review workspace · AI Radar");
});
