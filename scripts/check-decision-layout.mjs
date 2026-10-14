import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Resolve the parser declared by Vite, without introducing another dependency.
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve("vite/package.json"))("postcss");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const operational = /\.(?:decision[\w-]*|ask-result[\w-]*|ask-claim-row[\w-]*)\b/;
const boundaries = new Set([".decision-page__container"]);
const fill = (value) => /^(?:none|100%)$/i.test(value.trim());

export function cssLayoutViolations(source, file = "fixture.css") {
  const errors = [];
  postcss.parse(source, { from: file }).walkDecls((declaration) => {
    const selectors = [];
    for (let parent = declaration.parent; parent; parent = parent.parent)
      if (parent.type === "rule") selectors.unshift(parent.selector);
    const selector = selectors.join(" ");
    const maximum = ["max-width", "max-inline-size"].includes(declaration.prop);
    const fixedTextWidth =
      ["width", "inline-size"].includes(declaration.prop) &&
      /\.decision-(?:outcome(?:__summary)?|verdict__next|choice__facts|evidence-request|trial-kit|preferences__hint|validation__result)(?:\s+[ph][1-6]?)?\s*$/.test(
        selector,
      );
    if (!maximum && !fixedTextWidth) return;
    if (!operational.test(selector) || fill(declaration.value)) return;
    if (fixedTextWidth && declaration.value.trim() === "auto") return;
    if (selectors.length === 1 && boundaries.has(selectors[0])) return;
    errors.push({
      file,
      line: declaration.source.start.line,
      message: `${selectors.join(" ")}: ${declaration.prop}: ${declaration.value} restricts the available text width`,
    });
  });
  return errors;
}

export function jsxLayoutViolations(source, file = "fixture.tsx") {
  const errors = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const add = (node, message) =>
    errors.push({
      file,
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      message,
    });
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "className" && node.initializer) {
      const value = node.initializer.getText(ast);
      if (
        /(?:^|[\s"'`:])max-w-(?!full\b|none\b|\[100%\])/.test(value) &&
        !/\bmx-auto\b/.test(value)
      )
        add(node, "Nested maximum-width utility must not reserve empty space beside decision text");
      if (/max-w-(?:prose|\[[^\]]*(?:ch|rem|px|\d+%)[^\]]*\])/.test(value))
        add(node, "Nested fixed/prose width can prematurely wrap operational text");
      if (
        /^(?:p|span|h[1-6]|summary)$/.test(node.parent.parent.tagName.getText(ast)) &&
        /max-w-/.test(value)
      )
        add(node, "Text must inherit its column width; apply the page cap to the outer container");
    }
    if (
      ts.isPropertyAssignment(node) &&
      ["maxWidth", "maxInlineSize"].includes(node.name.getText(ast).replace(/["']/g, ""))
    ) {
      const value = node.initializer.getText(ast).replace(/["']/g, "");
      if (!fill(value)) add(node, "Inline maximum width can bypass the shared text-width rule");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return errors;
}

// Used with read-only DOM measurements from the actual browser, not mock scores.
export function geometryViolations({ rows, clientWidth, scrollWidth, requestedWidth }) {
  const errors = [];
  if (requestedWidth && (clientWidth > requestedWidth + 1 || clientWidth < requestedWidth - 32))
    errors.push(`Requested viewport did not apply: ${clientWidth}, requested ${requestedWidth}`);
  if (!rows.length) errors.push("No visible decision text was measured");
  for (const row of rows) {
    if (Math.abs(row.width - row.availableWidth) > 2)
      errors.push(`${row.name}: text width ${row.width}, available width ${row.availableWidth}`);
  }
  if (scrollWidth > clientWidth + 1)
    errors.push(`Horizontal overflow: ${scrollWidth} > ${clientWidth}`);
  return errors;
}

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesBelow(join(path, entry.name)) : [join(path, entry.name)],
  );
}

export function checkProjectLayout() {
  const css = filesBelow(join(root, "src")).filter((file) => file.endsWith(".css"));
  const jsx = [
    ...filesBelow(join(root, "src/components/research")).filter((file) => file.endsWith(".tsx")),
    join(root, "src/routes/ask.tsx"),
  ];
  return [
    ...css.flatMap((file) => cssLayoutViolations(readFileSync(file, "utf8"), relative(root, file))),
    ...jsx.flatMap((file) => jsxLayoutViolations(readFileSync(file, "utf8"), relative(root, file))),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkProjectLayout();
  if (errors.length) {
    errors.forEach((error) => console.error(`${error.file}:${error.line}: ${error.message}`));
    process.exitCode = 1;
  } else console.log("Decision layout guard passed: no nested text-width caps.");
}
