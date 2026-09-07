import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import * as prettier from "prettier";

const supportedExtensions = /\.(?:cjs|css|html|js|jsx|json|md|mjs|scss|ts|tsx|ya?ml)$/i;
const includedFiles = new Set([
  ".github/workflows/quality.yml",
  ".github/workflows/staging-acceptance.yml",
  ".prettierignore",
  "docs/CORE_MODEL_COVERAGE.md",
  "docs/END_TO_END_OPERATING_MODEL.md",
  "docs/PROJECT_COMPLETION_SPEC.md",
  "docs/README.md",
  "package.json",
  "product/core-models.v1.json",
  "render.yaml",
  "scripts/check-format.mjs",
  "scripts/report-core-model-coverage.mjs",
  "scripts/wait-staging-release.mjs",
  "src/components/research/DecisionBrief.tsx",
  "src/components/research/ResearchReport.tsx",
  "src/routes/ask.tsx",
  "src/routes/compare.tsx",
  "src/routes/research.$id.tsx",
  "src/routes/share.$id.tsx",
  "src/services/user-api.ts",
  "tests/core-model-manifest.test.mjs",
  "tests/decision-assistant-contract.test.mjs",
  "tests/staging-release-contract.test.mjs",
  "tests/timeline-hero-contract.test.mjs",
]);

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => supportedExtensions.test(file))
  .filter((file) => includedFiles.has(file));

const unformatted = [];

for (const filepath of files) {
  const fileInfo = await prettier.getFileInfo(filepath, {
    ignorePath: ".prettierignore",
  });
  if (fileInfo.ignored || !fileInfo.inferredParser) continue;

  const source = await readFile(filepath, "utf8");
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  if (!(await prettier.check(source, { ...config, filepath }))) {
    unformatted.push(filepath);
  }
}

if (unformatted.length > 0) {
  console.error("Prettier formatting is required for:");
  for (const filepath of unformatted) console.error(`- ${filepath}`);
  process.exitCode = 1;
} else {
  console.log(`Prettier check passed for ${files.length} project files.`);
}
