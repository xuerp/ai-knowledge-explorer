import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeLoader, makeTestLoader } from "./coding-benchmark.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = path.join(project, "artifacts/decision-coding-benchmark");
const audit = path.join(pack, "audit");
mkdirSync(audit, { recursive: true });
const root = mkdtempSync(path.join(audit, "realm-control-"));
writeFileSync(
  path.join(root, "data.ts"),
  `export const data = { nested: [0, null, "3.1"] };
export function values(input) { return [{ value: input[0] }, null, 0]; }
export function bad() { throw new TypeError("Invalid duration"); }
export function forbidden() { return require("node:fs"); }
`,
);
writeFileSync(path.join(root, "alias.ts"), 'export { values } from "./data";\n');
const raw = makeLoader(root)("data.ts");
assert.throws(() => assert.deepEqual(raw.values(["x"]), [{ value: "x" }, null, 0]));
const load = makeTestLoader(root);
const data = load("data.ts");
const input = ["x"];
assert.deepEqual(data.values(input), [{ value: "x" }, null, 0]);
assert.deepEqual(input, ["x"]);
assert.deepEqual(data.data, { nested: [0, null, "3.1"] });
assert.throws(data.bad, TypeError);
assert.throws(data.forbidden, /Runtime dependencies and network modules are not allowed/);
assert.throws(() => load("../support/load.mjs"), /Outside test root/);
assert.equal(load("alias.ts").values, data.values);
assert.equal(load("data.ts"), data);

const modelRoot = path.join(pack, "tasks/01-fix");
const testPath = path.join(modelRoot, "tests/solution.test.mjs");
const before = readFileSync(testPath);
const run = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", "tests/solution.test.mjs"],
  {
    cwd: modelRoot,
    encoding: "utf8",
    timeout: 30000,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "PATHEXT"].includes(
          key.toUpperCase(),
        ),
      ),
    ),
  },
);
assert(!run.error, run.error?.message);
assert.equal(run.status, 0, run.stdout + run.stderr);
assert.match(run.stdout, /# pass 5/);
assert.match(run.stdout, /# fail 0/);
assert.deepEqual(readFileSync(testPath), before, "Do not alter model's test file");
writeFileSync(path.join(audit, "model-tests-after-loader-fix.txt"), run.stdout + run.stderr);

// The adapter must preserve the original defect, not make incorrect code pass.
let source = readFileSync(path.join(modelRoot, "src/domain/decision-reading.ts"), "utf8");
const marker = "group.claimIds.some((id) => item.claimIds.includes(id)),\n    );";
assert(source.includes(marker));
source = source.replace(marker, marker.replace(");", ").slice(0, 1);"));
mkdirSync(path.join(root, "src/domain"), { recursive: true });
writeFileSync(path.join(root, "src/domain/decision-reading.ts"), source);
const seeded = makeTestLoader(root)("src/domain/decision-reading.ts");
const findings = seeded.compactFindings([
  { finding: "Alpha.", claimIds: ["a"] },
  { finding: "Beta.", claimIds: ["b"] },
  { finding: "Bridge.", claimIds: ["a", "b"] },
]);
assert.equal(findings.length, 2, "Seeded defect must remain observable");
const receipt = {
  controlChecksPassed: 10,
  modelTestsAfterHarnessCorrection: { passed: 5, failed: 0, sourceEdits: 0, testEdits: 0 },
  originalPaidRunAcceptanceChanged: false,
  providerCalls: 0,
  retainsDependencyAndPathRestrictions: true,
};
writeFileSync(
  path.join(audit, "loader-correction-recheck.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt));
