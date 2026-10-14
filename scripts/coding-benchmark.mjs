import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = path.join(project, "artifacts/decision-coding-benchmark");
const files = [
  "src/domain/decision-reading.ts",
  "src/domain/decision-workflow.ts",
  "src/domain/decision-presentation.ts",
  "src/domain/decision-report-html.ts",
  "backend/data/decision_scenarios.v1.json",
];
const tasks = ["01-fix", "02-feature", "03-refactor"];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "PATHEXT"].includes(
      key.toUpperCase(),
    ),
  ),
);
const write = (name, value) => {
  mkdirSync(path.dirname(name), { recursive: true });
  writeFileSync(name, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
};
const read = (name) => JSON.parse(readFileSync(name, "utf8"));
const inside = (root, target) => {
  const relative = path.relative(root, target);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Outside test root");
  return target;
};
function inventory(root) {
  const found = {};
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      assert(!entry.isSymbolicLink(), "Symlinks are not permitted in the test pack");
      if (entry.isDirectory()) visit(target);
      else found[path.relative(root, target).replaceAll("\\", "/")] = digest(readFileSync(target));
    }
  }
  visit(root);
  return found;
}
const prompts = {
  "01-fix": `修复引用合并缺陷。src/domain/decision-reading.ts 的 compactFindings 在最后一项同时连接两个已有引用组时，未能将它们全部合并。保留全部不同句子、限制、引用和首次出现顺序，不修改输入；英文版本号 3.1 不能被截断。仅修改此文件，并新增 tests/solution.test.mjs 回归用例。这是人为植入的基准缺陷，不是现有线上故障。`,
  "02-feature": `为私人编码实测新增 src/domain/decision-benchmark.ts，导出 summarizeCodingRuns(runs)。输入每项含 id、candidateId、taskId（fix/feature/refactor）、status（pending/passed/failed/blocked）、verified（boolean）、elapsedMs（number|null）、cost（null 或 {amount:number,currency:string,channel:string}）。返回按 candidateId 首次出现顺序的数组，每项 {candidateId, verifiedRuns, passedRuns, failedRuns, medianElapsedMs, costs}。只统计 verified===true 且 status 为 passed/failed 的完成记录；按 id 去重，完全相同重复只统计一次，同 id 不同记录抛异常；缺少 id/candidateId、非法 taskId/status/verified、负数或非有限的 elapsedMs/amount、非三位大写币种或空渠道均抛异常。有效耗时取中位数，包括0；缺失全部耗时返回null。costs 按 currency+channel 分组保留首次出现顺序，条目 {currency,channel,amount,knownRuns,unknownRuns}；unknownRuns 是此候选已核验完成记录中 cost===null 的数量，不能把未知费用当0。没有任何已核验完成记录的候选仍返回0计数、null耗时、空costs。不得排名或写入公开Claim。新增 tests/solution.test.mjs 包含未知成本、混合渠道/币种、重复和失败记录。`,
  "03-refactor": `跨文件重构引用处理。把 compactFindings 及其句子分割逻辑移至新的 src/domain/decision-findings.ts；decision-reading.ts 必须继续导出 compactFindings 兼容旧调用，并复用同一处句子分割。decision-workflow.ts 和 decision-report-html.ts 改为直接从新模块导入 compactFindings，decisionReading 仍从 reading 导入。保持中文/英文报告、引用限制、HTML转义、覆盖统计和未实测状态行为不变，不复制第二份合并算法。新增 tests/solution.test.mjs 覆盖兼容导出、句子限制和报告。`,
};

function prepare() {
  assert(!existsSync(pack), "Pack already exists; do not overwrite an existing run");
  const sourceFiles = files.map((file) => ({
    file,
    sha256: digest(readFileSync(path.join(project, file))),
  }));
  for (const task of tasks) {
    const root = path.join(pack, "tasks", task);
    for (const file of files)
      write(path.join(root, file), readFileSync(path.join(project, file), "utf8"));
    if (task === "01-fix") {
      const name = path.join(root, files[0]);
      const source = readFileSync(name, "utf8");
      const marker = "group.claimIds.some((id) => item.claimIds.includes(id)),\n    );";
      const normalized = source.replaceAll("\r\n", "\n");
      assert(normalized.includes(marker), "Seed marker changed; review instead of guessing");
      write(
        name,
        normalized.replace(
          marker,
          "group.claimIds.some((id) => item.claimIds.includes(id)),\n    ).slice(0, 1);",
        ),
      );
    }
    write(
      path.join(root, "AGENTS.md"),
      `# Local coding benchmark\n\nOnly this task folder may be edited. Do not read sibling tasks, evaluator, answers, original repository, settings, secrets or credentials. No network, dependency installation, provider calls, git commits, deployment or permission changes. This is a deliberately small source snapshot of AI Radar, not a full application checkout. Type-only imports are omitted by the local TypeScript loader; do not install dependencies to resolve them.\n\nAdd tests/solution.test.mjs using node:test and node:assert/strict. Import { load } from '../../../support/load.mjs', then load('src/domain/...ts'). This support loader is the only allowed reference outside the task folder; do not inspect its evaluator implementation. Run node --test tests/solution.test.mjs from this task directory. Report edits, commands, exit codes and unresolved issues. Never modify evaluator results.\n`,
    );
    write(path.join(root, "TASK.md"), prompts[task] + "\n");
    write(path.join(root, "package.json"), {
      private: true,
      type: "module",
      scripts: { test: "node --test tests/solution.test.mjs" },
    });
  }
  write(
    path.join(pack, "support/load.mjs"),
    `import { makeTestLoader } from '../../../scripts/coding-benchmark.mjs';\nexport const load = makeTestLoader(process.cwd());\n`,
  );
  const initial = Object.fromEntries(
    tasks.map((task) => [task, inventory(path.join(pack, "tasks", task))]),
  );
  write(path.join(pack, "manifest.json"), {
    version: 1,
    preparedAt: new Date().toISOString(),
    userTimezone: "Asia/Shanghai",
    product: "Claude Code",
    interface: "IDE",
    route: ["CC Switch", "gateway", "CCSub"],
    routeSource: "user statement; no live provider verification",
    modelVersion: null,
    accountQuota: null,
    spendingAuthorization: false,
    providerRequests: 0,
    sourceFiles,
    initial,
    evaluationScope:
      "Five-file AI Radar source snapshot; three task categories, no business-quality ranking",
    excluded: [
      ".env",
      ".claude",
      "credentials",
      "databases",
      "user records",
      "provider CSV",
      "node_modules",
      "git history",
    ],
  });
  write(path.join(pack, "run-template.json"), {
    product: "Claude Code",
    interface: "IDE",
    routing: "CC Switch -> gateway -> CCSub",
    modelRequested: null,
    modelReported: null,
    modelExecutionVerified: false,
    pluginVersion: null,
    gatewayVersion: null,
    subscriptionOrQuota: null,
    budget: { authorized: false, maximum: null, currency: null },
    task: null,
    status: "pending",
    humanEditLines: null,
    retries: null,
    approvalCount: null,
    cost: null,
    costProof: null,
    errors: [],
    privateNotes: "Do not add tokens, keys or raw headers",
  });
  console.log(
    JSON.stringify({
      prepared: true,
      sourceFileCount: files.length,
      taskCount: 3,
      providerRequests: 0,
      pack,
    }),
  );
}

export function makeLoader(root) {
  const resolvedRoot = path.resolve(root);
  const cache = new Map();
  function load(file) {
    const full = inside(resolvedRoot, path.resolve(resolvedRoot, file));
    if (cache.has(full)) return cache.get(full).exports;
    if (full.endsWith(".json")) return read(full);
    assert(full.endsWith(".ts"), "Only snapshot TypeScript/JSON modules are allowed");
    const source = readFileSync(full, "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: full,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });
    assert(
      !compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error),
      "TypeScript syntax error",
    );
    const module = { exports: {} };
    cache.set(full, module);
    const require = (specifier) => {
      assert(specifier.startsWith("."), "Runtime dependencies and network modules are not allowed");
      const requested = path.resolve(path.dirname(full), specifier);
      return load(
        path.relative(resolvedRoot, existsSync(requested) ? requested : requested + ".ts"),
      );
    };
    const context = vm.createContext({ module, exports: module.exports, require, URLSearchParams });
    vm.runInContext(compiled.outputText, context, { filename: full, timeout: 2000 });
    return module.exports;
  }
  return load;
}

/** Keep the VM boundary, but expose domain data in the test runner's realm. */
export function makeTestLoader(root) {
  const load = makeLoader(root);
  const modules = new WeakMap();
  const functions = new WeakMap();
  return (file) => {
    const exported = load(file);
    if (modules.has(exported)) return modules.get(exported);
    const adapted = {};
    for (const [name, value] of Object.entries(exported)) {
      if (typeof value !== "function") {
        adapted[name] = structuredClone(value);
        continue;
      }
      if (!functions.has(value)) {
        functions.set(value, (...args) => {
          try {
            return structuredClone(value(...args));
          } catch (error) {
            const errors = { Error, TypeError, RangeError, SyntaxError, ReferenceError };
            const ErrorType = errors[error?.name] ?? Error;
            throw new ErrorType(error?.message ?? String(error), { cause: error });
          }
        });
      }
      adapted[name] = functions.get(value);
    }
    modules.set(exported, adapted);
    return adapted;
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const fixture = () => {
  const fact = { finding: "编辑文件。须批准。", claimIds: ["c1"], dimension: "file-editing" };
  const candidate = (id) => ({
    entityId: id,
    eligibility: "unknown",
    reasons: ["部署方式未核验"],
    strengths: [fact],
    gaps: [],
    requiredDimensions: ["deployment", "task-quality"],
    coveredDimensions: [],
  });
  return {
    id: "benchmark-private",
    question: "编辑文件、运行测试 <script>x</script>",
    createdAt: "2026-10-11T00:00:00Z",
    summary: "未实测",
    citations: [],
    decision: {
      status: "insufficient",
      asOf: "2026-10-11T00:00:00Z",
      conditions: [],
      candidates: [candidate("a"), candidate("b")],
      scenario: {
        id: "coding-workspace",
        name: "编码",
        requiredFeatures: ["file-editing", "test-execution"],
        clarificationChecks: [],
      },
      comparisons: [
        {
          id: "context",
          dimension: "上下文",
          cells: [
            { entityId: "a", state: "unknown", facts: [] },
            { entityId: "b", state: "unknown", facts: [] },
          ],
        },
      ],
      tradeoffs: [
        { ...fact, finding: "A: 编辑文件。须批准。" },
        { ...fact, finding: "A: 须付费账户。" },
      ],
      nextChecks: ["核验", "核验"],
      risks: [],
      recommendation: { primaryEntityId: null, summary: "没有同口径实测，不判定赢家", reasons: [] },
    },
  };
};

function evaluate(root, task) {
  const load = makeLoader(root);
  const reading = load(files[0]);
  const workflow = load(files[1]);
  const html = load(files[3]);
  const results = [];
  const check = (name, fn) => {
    try {
      fn();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, message: String(error.message).slice(0, 1200) });
    }
  };
  check("citation bridge retains distinct restrictions and IDs", () => {
    const input = [
      { finding: "编辑文件。须批准。", claimIds: ["a"] },
      { finding: "运行测试。须联网。", claimIds: ["b"] },
      { finding: "编辑文件。运行测试。", claimIds: ["a", "b"] },
    ];
    const before = JSON.stringify(input);
    assert.deepEqual(plain(reading.compactFindings(input)), [
      { finding: "编辑文件。 须批准。 运行测试。 须联网。", claimIds: ["a", "b"] },
    ]);
    assert.equal(JSON.stringify(input), before);
  });
  check("decimal versions and unrelated citations stay separate", () => {
    assert.deepEqual(
      plain(
        reading.compactFindings([
          { finding: "Gemini 3.1 Pro. CLI only.", claimIds: ["a"] },
          { finding: "Other.", claimIds: ["b"] },
        ]),
      ),
      [
        { finding: "Gemini 3.1 Pro. CLI only.", claimIds: ["a"] },
        { finding: "Other.", claimIds: ["b"] },
      ],
    );
  });
  check("common unknowns consolidated; unique caveat retained", () => {
    const research = fixture(),
      before = JSON.stringify(research);
    const projection = reading.decisionReading(research.decision, (id) => id.toUpperCase());
    assert.deepEqual(plain(projection.commonReasons), [["部署方式未核验", ["a", "b"]]]);
    assert.deepEqual(plain(projection.extraEvidence.map((item) => item.finding)), [
      "A: 须付费账户。",
    ]);
    assert.deepEqual(plain(projection.coverage("a")), {
      features: 2,
      described: 1,
      hard: 1,
      verified: 0,
    });
    assert.equal(JSON.stringify(research), before);
  });
  check("specific file/test requirements supersede generic features", () => {
    const scenario = workflow.decisionScenario(
      { task: "为现有代码仓库选择编码工具，需要编辑文件、运行测试", taskType: "coding-product" },
      "zh",
    );
    assert.deepEqual(plain(scenario.requiredFeatures), ["file-editing", "test-execution"]);
  });
  check("pending validation plan never invents outcomes", () => {
    const plan = workflow.createValidationPlan(fixture());
    assert.equal(plan.length, 8);
    assert(plan.every((item) => item.status === "pending" && item.result === ""));
    assert(plan.some((item) => item.title.includes("跨文件重构")));
  });
  check("Markdown keeps citations and unique qualifications", () => {
    const output = workflow.decisionMarkdown(fixture(), (id) => id.toUpperCase());
    assert(output.includes("[c1]"));
    assert(output.includes("须批准"));
    assert(output.includes("没有同口径实测"));
  });
  check("HTML escapes inputs and is a self-contained private report", () => {
    const output = html.decisionReportHtml(fixture(), [], (id) => id.toUpperCase(), true, "zh");
    assert(output.includes("&lt;script&gt;"));
    assert(!output.includes("<script>"));
    assert(output.includes("须付费账户"));
    assert(!output.includes("<br>"));
  });
  if (task === "02-feature") {
    const run = (id, overrides = {}) => ({
      id,
      candidateId: "claude",
      taskId: "fix",
      status: "passed",
      verified: true,
      elapsedMs: 100,
      cost: null,
      ...overrides,
    });
    const summarize = () => load("src/domain/decision-benchmark.ts").summarizeCodingRuns;
    check("empty run list", () => assert.deepEqual(plain(summarize()([])), []));
    check("verified passes, failures, median and unknown cost", () => {
      const rows = [
        run("a", { elapsedMs: 0, cost: { amount: 1, currency: "USD", channel: "CCSub" } }),
        run("b", { status: "failed", elapsedMs: 200 }),
        run("c", { verified: false }),
        run("d", { status: "pending" }),
      ];
      const before = JSON.stringify(rows);
      assert.deepEqual(plain(summarize()(rows)), [
        {
          candidateId: "claude",
          verifiedRuns: 2,
          passedRuns: 1,
          failedRuns: 1,
          medianElapsedMs: 100,
          costs: [{ currency: "USD", channel: "CCSub", amount: 1, knownRuns: 1, unknownRuns: 1 }],
        },
      ]);
      assert.equal(JSON.stringify(rows), before);
    });
    check("identical IDs deduplicated, conflicting IDs rejected", () => {
      assert.equal(summarize()([run("a"), run("a")])[0].verifiedRuns, 1);
      assert.throws(() => summarize()([run("a"), run("a", { status: "failed" })]));
    });
    check("currency/channel never mixed and all-unknown cost stays empty", () => {
      const rows = [
        run("a", { cost: { amount: 0, currency: "USD", channel: "CCSub" } }),
        run("b", { cost: { amount: 2, currency: "CNY", channel: "CCSub" } }),
        run("c", { cost: { amount: 3, currency: "USD", channel: "official" } }),
        run("d", { candidateId: "other", elapsedMs: null }),
        run("e", { candidateId: "pending", status: "blocked" }),
      ];
      const values = summarize()(rows);
      assert.equal(values[0].costs.length, 3);
      assert.deepEqual(plain(values[1]), {
        candidateId: "other",
        verifiedRuns: 1,
        passedRuns: 1,
        failedRuns: 0,
        medianElapsedMs: null,
        costs: [],
      });
      assert.deepEqual(plain(values[2]), {
        candidateId: "pending",
        verifiedRuns: 0,
        passedRuns: 0,
        failedRuns: 0,
        medianElapsedMs: null,
        costs: [],
      });
    });
    check("odd median, same-channel sums and unverified records ignored", () => {
      const rows = [
        run("a", { elapsedMs: 10, cost: { amount: 1, currency: "USD", channel: "CCSub" } }),
        run("b", { elapsedMs: 50, cost: { amount: 2, currency: "USD", channel: "CCSub" } }),
        run("c", { elapsedMs: 30 }),
        run("d", {
          verified: false,
          elapsedMs: 9000,
          cost: { amount: 99, currency: "USD", channel: "CCSub" },
        }),
      ];
      assert.deepEqual(plain(summarize()(rows)), [
        {
          candidateId: "claude",
          verifiedRuns: 3,
          passedRuns: 3,
          failedRuns: 0,
          medianElapsedMs: 30,
          costs: [{ currency: "USD", channel: "CCSub", amount: 3, knownRuns: 2, unknownRuns: 1 }],
        },
      ]);
    });
    check("invalid identity, status, duration and costs rejected", () => {
      const summarizeRuns = summarize();
      assert.equal(typeof summarizeRuns, "function", "Required export is missing");
      for (const overrides of [
        { id: "" },
        { candidateId: "" },
        { taskId: "other" },
        { status: "complete" },
        { verified: "true" },
        { elapsedMs: -1 },
        { elapsedMs: Infinity },
        { cost: { amount: -1, currency: "USD", channel: "CCSub" } },
        { cost: { amount: 1, currency: "usd", channel: "CCSub" } },
        { cost: { amount: 1, currency: "USD", channel: "" } },
      ])
        assert.throws(() => summarizeRuns([run("a", overrides)]));
    });
  }
  if (task === "03-refactor")
    check("single shared implementation and backward-compatible export", () => {
      const common = load("src/domain/decision-findings.ts");
      assert.equal(reading.compactFindings, common.compactFindings);
      for (const file of [files[1], files[3]]) {
        const source = readFileSync(path.join(root, file), "utf8");
        assert(
          /import\s*\{\s*compactFindings\s*\}\s*from\s*["']\.\/decision-findings["']/.test(source),
        );
      }
      assert(
        !/function compactFindings|const sentences\s*=/.test(
          readFileSync(path.join(root, files[0]), "utf8"),
        ),
      );
    });
  return { task, passed: results.every((item) => item.passed), checks: results };
}

function childCheck(root, task) {
  const output = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "--evaluate", root, task],
    { encoding: "utf8", timeout: 30000, maxBuffer: 200000, env: childEnvironment },
  );
  if (output.error || !output.stdout.trim())
    return {
      task,
      passed: false,
      checks: [],
      error: output.error?.message ?? output.stderr.slice(0, 1500),
    };
  try {
    return JSON.parse(output.stdout);
  } catch {
    return { task, passed: false, checks: [], error: "Invalid evaluator result" };
  }
}

export function assessTask(root, task, initial) {
  assert(tasks.includes(task), "Choose 01-fix, 02-feature or 03-refactor");
  const current = inventory(root);
  const allowed = new Set(
    task === "01-fix"
      ? [files[0], "tests/solution.test.mjs"]
      : task === "02-feature"
        ? ["src/domain/decision-benchmark.ts", "tests/solution.test.mjs"]
        : [
            files[0],
            files[1],
            files[3],
            "src/domain/decision-findings.ts",
            "tests/solution.test.mjs",
          ],
  );
  const changed = [...new Set([...Object.keys(current), ...Object.keys(initial)])].filter(
    (file) => current[file] !== initial[file],
  );
  const scopePass = changed.every((file) => allowed.has(file));
  const behavioral = childCheck(root, task);
  const userTest = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "tests/solution.test.mjs"],
    { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 200000, env: childEnvironment },
  );
  const executedTests = Number(userTest.stdout?.match(/^# tests (\d+)$/m)?.[1] ?? 0);
  const minimumTests = task === "02-feature" ? 3 : 2;
  const testsComplete =
    executedTests >= minimumTests &&
    ["cancelled", "skipped", "todo"].every((key) =>
      /^0$/.test(userTest.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, "m"))?.[1] ?? "unknown"),
    );
  const receipt = {
    task,
    evaluatedAt: new Date().toISOString(),
    scopePass,
    changed,
    behavioral,
    solutionTests: {
      exitCode: userTest.status,
      executedTests,
      minimumTests,
      complete: testsComplete,
      error: userTest.error?.message ?? null,
    },
    verified: scopePass && behavioral.passed && userTest.status === 0 && testsComplete,
    providerRequestsByEvaluator: 0,
    businessBenchmark: false,
    currentHashes: current,
  };
  return { receipt, testOutput: (userTest.stdout ?? "") + (userTest.stderr ?? "") };
}

function verify(task) {
  const manifest = read(path.join(pack, "manifest.json"));
  const { receipt, testOutput } = assessTask(
    path.join(pack, "tasks", task),
    task,
    manifest.initial[task],
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  write(path.join(pack, "receipts", `${task}-${stamp}.json`), receipt);
  write(path.join(pack, "receipts", `${task}-${stamp}.tests.txt`), testOutput);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.verified) process.exitCode = 1;
}

async function main() {
  const [command, arg, task] = process.argv.slice(2);
  if (command === "prepare") prepare();
  else if (command === "verify") verify(arg);
  else if (command === "--evaluate") {
    try {
      const result = evaluate(arg, task);
      console.log(JSON.stringify(result));
      process.exitCode = result.passed ? 0 : 1;
    } catch (error) {
      console.log(
        JSON.stringify({
          task,
          passed: false,
          checks: [],
          error: String(error.message).slice(0, 1500),
        }),
      );
      process.exitCode = 1;
    }
  } else if (command === "start") {
    assert(tasks.includes(arg), "Unknown task");
    const filename = path.join(pack, "runs", `${arg}.json`);
    assert(!existsSync(filename), "Run already started; preserve prior evidence");
    const manifest = read(path.join(pack, "manifest.json"));
    assert.deepEqual(
      inventory(path.join(pack, "tasks", arg)),
      manifest.initial[arg],
      "Start must use unchanged task baseline",
    );
    write(filename, {
      ...read(path.join(pack, "run-template.json")),
      task: arg,
      startedAt: new Date().toISOString(),
      startedMonotonic: null,
      status: "started",
      initialHashes: manifest.initial[arg],
    });
    console.log(JSON.stringify({ started: arg, filename, providerRequests: 0 }));
  } else if (command === "finish") {
    assert(tasks.includes(arg), "Unknown task");
    const filename = path.join(pack, "runs", `${arg}.json`),
      run = read(filename);
    assert(run.status === "started", "Run is not open");
    const result = childCheck(path.join(pack, "tasks", arg), arg);
    const endedAt = new Date().toISOString();
    write(filename, {
      ...run,
      endedAt,
      wallElapsedMs: Date.parse(endedAt) - Date.parse(run.startedAt),
      elapsedIncludesHumanWaiting: true,
      status: result.passed ? "checks-passed" : "checks-failed",
      actualQualityVerified: false,
      behavioralReceipt: result,
    });
    console.log(
      JSON.stringify({ endedAt, task: arg, checksPassed: result.passed, providerRequests: 0 }),
    );
  } else throw new Error("Use prepare | start TASK | verify TASK | finish TASK");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
