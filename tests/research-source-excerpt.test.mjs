import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import ts from "typescript";

const vite = await createServer({
  // This leaf renderer does not need Start's dev instrumentation, which resolves
  // the CommonJS JSX runtime as a page module in middleware SSR.
  configFile: false,
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
// Render the actual leaf component through TypeScript and Node: middleware SSR
// treats pnpm's CommonJS JSX runtime as an inline browser module in Vite 8.
const componentSource = readFileSync(
  new URL("../src/components/research/SourceExcerpt.tsx", import.meta.url),
  "utf8",
);
const componentJs = ts.transpileModule(componentSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { SourceExcerpt } = await import(
  `data:text/javascript;base64,${Buffer.from(`import * as React from ${JSON.stringify(import.meta.resolve("react"))};\n${componentJs}`).toString("base64")}`
);
const { createMarkdown } = await vite.ssrLoadModule("/src/domain/research-markdown.ts");
const { selectResearchEvidence } = await vite.ssrLoadModule("/src/domain/research-evidence.ts");
test.after(() => vite.close());

const excerpt =
  "| Model | Score |\n| --- | --- |\n| Sonnet 4 | 72.7% |\nNo extended thinking; all 500 problems.\n<script>untrusted source text</script>";
const source = {
  id: "official-score",
  publisher: "Anthropic",
  title: { zh: "官方实验条件", en: "Official evaluation conditions" },
  url: "https://www.anthropic.com/news/claude-4",
  publishedAt: "2025-05-22",
  sourceExcerpt: excerpt,
};

test("source excerpts remain literal, collapsed by default and safe as text", () => {
  const html = renderToStaticMarkup(createElement(SourceExcerpt, { source, lang: "en" }));
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /View source excerpt/);
  assert.match(html, /\| --- \| --- \|\n\| Sonnet 4 \| 72\.7% \|/);
  assert.match(html, /all 500 problems/);
  assert.match(html, /&lt;script&gt;untrusted source text&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("missing excerpts are explicit and never replaced by a claim or source title", () => {
  const html = renderToStaticMarkup(
    createElement(SourceExcerpt, {
      source: { ...source, sourceExcerpt: "  \n " },
      lang: "zh",
    }),
  );
  assert.match(html, /原文摘录暂缺/);
  assert.doesNotMatch(html, /<details|72\.7|官方实验条件/);
});

test("Markdown preserves source evidence and API provenance rather than claiming demo data", () => {
  const answer = {
    question: { zh: "测试条件", en: "Evaluation conditions" },
    summary: { zh: "历史厂商自报", en: "Historical vendor report" },
    generatedAt: "2026-10-06T11:18:00Z",
    status: "insufficient-evidence",
  };
  const claims = [
    {
      text: { zh: "72.7%，无扩展思考", en: "72.7%, no extended thinking" },
      sourceIds: [source.id],
      confidence: "verified",
    },
  ];
  const markdown = createMarkdown(answer, claims, [source], "en", "live");
  assert.match(markdown, /72\.7%, no extended thinking \[1\]/);
  assert.match(markdown, /> \| --- \| --- \|\n> \| Sonnet 4 \| 72\.7% \|/);
  assert.match(markdown, /2025-05-22/);
  assert.match(markdown, /cited AI Radar API research evidence/);
  assert.doesNotMatch(markdown, /demo snapshot/);
  assert.match(
    createMarkdown(answer, claims, [source], "en", "demo"),
    /explicitly labelled AI Radar demo snapshot/,
  );
});

test("research sources exclude the full catalogue and retain cited sources beyond eight", () => {
  const catalogue = Array.from({ length: 461 }, (_, index) => ({
    ...source,
    id: `source-${index}`,
  }));
  const claim = { id: "current", sourceIds: catalogue.slice(452).map((item) => item.id) };
  assert.deepEqual(selectResearchEvidence(null, [claim], catalogue), { claims: [], evidence: [] });
  const result = selectResearchEvidence({ claimIds: [claim.id] }, [claim], catalogue);
  assert.equal(result.evidence.length, 9);
  assert.equal(result.evidence[8].id, "source-460");
});

test("API citations preserve derived claims, exact excerpts and current evidence authority", () => {
  const claim = { id: "derived", sourceIds: [source.id, "absent"] };
  const stale = { ...source, sourceExcerpt: "stale snapshot" };
  const result = selectResearchEvidence(
    { claimIds: [claim.id, claim.id], citations: [{ claim, evidence: [source] }] },
    [],
    [stale],
  );
  assert.deepEqual(result, { claims: [claim], evidence: [source] });
  assert.deepEqual(
    selectResearchEvidence({ claimIds: [claim.id], citations: [] }, [claim], [source]),
    {
      claims: [],
      evidence: [],
    },
  );
  assert.deepEqual(
    selectResearchEvidence(
      {
        claimIds: [claim.id],
        citations: [{ claim, evidence: [source] }],
        citationStates: { [claim.id]: "unavailable" },
      },
      [claim],
      [source],
    ),
    { claims: [], evidence: [] },
  );
});
