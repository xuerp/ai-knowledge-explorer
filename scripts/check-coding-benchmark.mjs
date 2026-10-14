import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assessTask } from "./coding-benchmark.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = path.join(project, "artifacts/decision-coding-benchmark");
const manifest = JSON.parse(readFileSync(path.join(pack, "manifest.json"), "utf8"));
const audit = path.join(
  pack,
  "audit",
  "local-selfcheck-" + new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(audit, { recursive: true });
const script = path.join(project, "scripts/coding-benchmark.mjs");
const sourceHashesBefore = manifest.sourceFiles.map(({ file }) =>
  createHash("sha256")
    .update(readFileSync(path.join(project, file)))
    .digest("hex"),
);
const evaluate = (root, task) => {
  const run = spawnSync(process.execPath, [script, "--evaluate", root, task], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 200000,
  });
  assert(!run.error, run.error?.message);
  return JSON.parse(run.stdout);
};
const featureReference = `
export function summarizeCodingRuns(runs) {
  const ids = new Map(), groups = new Map();
  const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
  for (const run of runs) {
    if (typeof run.id !== 'string' || !run.id.trim() || typeof run.candidateId !== 'string' || !run.candidateId.trim() || !['fix','feature','refactor'].includes(run.taskId) || !['pending','passed','failed','blocked'].includes(run.status) || typeof run.verified !== 'boolean') throw new Error('Invalid identity/status');
    if (run.elapsedMs !== null && (typeof run.elapsedMs !== 'number' || !Number.isFinite(run.elapsedMs) || run.elapsedMs < 0)) throw new Error('Invalid duration');
    if (run.cost !== null && (!run.cost || typeof run.cost.amount !== 'number' || !Number.isFinite(run.cost.amount) || run.cost.amount < 0 || !/^[A-Z]{3}$/.test(run.cost.currency) || typeof run.cost.channel !== 'string' || !run.cost.channel.trim())) throw new Error('Invalid cost');
    const encoded = canonical(run);
    if (ids.has(run.id)) { if (ids.get(run.id) !== encoded) throw new Error('Conflicting duplicate'); continue; }
    ids.set(run.id, encoded);
    if (!groups.has(run.candidateId)) groups.set(run.candidateId, {candidateId:run.candidateId, verifiedRuns:0, passedRuns:0, failedRuns:0, times:[], costs:new Map(), unknown:0});
    const group = groups.get(run.candidateId);
    if (!run.verified || !['passed','failed'].includes(run.status)) continue;
    group.verifiedRuns++; group[run.status === 'passed' ? 'passedRuns' : 'failedRuns']++;
    if (run.elapsedMs !== null) group.times.push(run.elapsedMs);
    if (run.cost === null) group.unknown++;
    else {
      const key = JSON.stringify([run.cost.currency, run.cost.channel]);
      if (!group.costs.has(key)) group.costs.set(key, {currency:run.cost.currency, channel:run.cost.channel, amount:0, knownRuns:0, unknownRuns:0});
      const cost = group.costs.get(key); cost.amount += run.cost.amount; cost.knownRuns++;
    }
  }
  return [...groups.values()].map(group => {
    const times = group.times.sort((a,b) => a-b), middle = Math.floor(times.length/2);
    return {candidateId:group.candidateId, verifiedRuns:group.verifiedRuns, passedRuns:group.passedRuns, failedRuns:group.failedRuns, medianElapsedMs:times.length ? times.length%2 ? times[middle] : (times[middle-1]+times[middle])/2 : null, costs:[...group.costs.values()].map(cost => ({...cost, unknownRuns:group.unknown}))};
  });
}
`;
const checks = [];
for (const task of ["01-fix", "02-feature", "03-refactor"]) {
  const baseline = evaluate(path.join(pack, "tasks", task), task);
  assert.equal(baseline.passed, false, "Unsolved task must fail acceptance");
  const root = path.join(audit, task);
  for (const file of Object.keys(manifest.initial[task])) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), readFileSync(path.join(pack, "tasks", task, file)));
  }
  for (const { file } of manifest.sourceFiles) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), readFileSync(path.join(project, file)));
  }
  if (task === "02-feature")
    writeFileSync(path.join(root, "src/domain/decision-benchmark.ts"), featureReference);
  if (task === "03-refactor") {
    const name = path.join(root, "src/domain/decision-reading.ts");
    let reading = readFileSync(name, "utf8").replaceAll("\r\n", "\n");
    const start = reading.indexOf("type CitedFinding"),
      end = reading.indexOf("/** Reading projection");
    assert(start > 0 && end > start);
    const common = reading
      .slice(start, end)
      .replace("const sentences =", "export const sentences =");
    writeFileSync(path.join(root, "src/domain/decision-findings.ts"), common);
    reading =
      reading.slice(0, start) +
      'import { compactFindings, sentences } from "./decision-findings";\nexport { compactFindings } from "./decision-findings";\n\n' +
      reading.slice(end);
    writeFileSync(name, reading);
    for (const file of ["src/domain/decision-workflow.ts", "src/domain/decision-report-html.ts"]) {
      const filename = path.join(root, file);
      const source = readFileSync(filename, "utf8").replace(
        'import { compactFindings, decisionReading } from "./decision-reading";',
        'import { compactFindings } from "./decision-findings";\nimport { decisionReading } from "./decision-reading";',
      );
      writeFileSync(filename, source);
    }
  }
  const reference = evaluate(root, task);
  assert.equal(reference.passed, true, JSON.stringify(reference));
  const testPath = path.join(root, "tests/solution.test.mjs");
  mkdirSync(path.dirname(testPath), { recursive: true });
  const helper = new URL("./coding-benchmark.mjs", import.meta.url).href;
  const testSource =
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { makeLoader } from '${helper}';\nconst load = makeLoader(process.cwd());\ntest('empty citation input stays empty', () => assert.equal(load('src/domain/decision-reading.ts').compactFindings([]).length, 0));\ntest('private plan keeps pending status', () => assert(load('src/domain/decision-workflow.ts').createValidationPlan({}).every(row => row.status === 'pending' && row.result === '')));\n` +
    (task === "02-feature"
      ? `test('empty observed runs stay empty', () => assert.equal(load('src/domain/decision-benchmark.ts').summarizeCodingRuns([]).length, 0));\n`
      : "");
  writeFileSync(testPath, testSource);
  const accepted = assessTask(root, task, manifest.initial[task]).receipt;
  assert.equal(accepted.verified, true, JSON.stringify(accepted));
  writeFileSync(testPath, "// Empty tests must not pass acceptance\n");
  const emptyTests = assessTask(root, task, manifest.initial[task]).receipt;
  assert.equal(emptyTests.verified, false);
  assert(emptyTests.solutionTests.executedTests < emptyTests.solutionTests.minimumTests);
  writeFileSync(testPath, testSource + "test.skip('skipped coverage must fail', () => {});\n");
  const skippedTests = assessTask(root, task, manifest.initial[task]).receipt;
  assert.equal(skippedTests.verified, false);
  writeFileSync(testPath, testSource);
  const packageFile = path.join(root, "package.json"),
    originalPackage = readFileSync(packageFile);
  writeFileSync(packageFile, JSON.stringify({ private: true, type: "module", tampered: true }));
  const outsideScope = assessTask(root, task, manifest.initial[task]).receipt;
  assert.equal(outsideScope.verified, false);
  assert.equal(outsideScope.scopePass, false);
  writeFileSync(packageFile, originalPackage);
  const testOutput = spawnSync(process.execPath, ["--test", "tests/solution.test.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(testOutput.status, 0);
  writeFileSync(
    path.join(root, "local-reference.tests.txt"),
    testOutput.stdout + testOutput.stderr,
  );
  checks.push({
    task,
    unsolvedRejected: true,
    referenceAccepted: true,
    checks: reference.checks.length,
    emptyTestsRejected: true,
    skippedTestsRejected: true,
    scopeViolationRejected: true,
    baseline,
    reference,
    accepted,
  });
}
const sourceHashesAfter = manifest.sourceFiles.map(({ file }) =>
  createHash("sha256")
    .update(readFileSync(path.join(project, file)))
    .digest("hex"),
);
assert.deepEqual(sourceHashesAfter, sourceHashesBefore);
assert.deepEqual(
  sourceHashesAfter,
  manifest.sourceFiles.map(({ sha256 }) => sha256),
);
const receipt = {
  checkedAt: new Date().toISOString(),
  checks,
  sourceSnapshotUnchanged: true,
  liveApplicationUnchanged: true,
  paidCalls: 0,
  providerRequests: 0,
  actualClaudeCodeRuns: 0,
  actualBusinessResults: false,
  referenceSolutionsLocation: path.relative(project, audit).replaceAll("\\", "/"),
  testScope: "Local evaluator controls only, not model performance",
};
writeFileSync(path.join(pack, "selfcheck.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(
  JSON.stringify({
    checks: checks.map(({ task, checks }) => ({ task, checks })),
    sourceSnapshotUnchanged: true,
    actualClaudeCodeRuns: 0,
    paidCalls: 0,
  }),
);
