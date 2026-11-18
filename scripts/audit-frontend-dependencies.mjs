import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PATCH = Object.freeze({
  version: "4.0.7",
  path: "patches/picomatch@4.0.7.patch",
  sha256: "2db247426baa2d0b1fbc543c7e83a658e56c864082517fd8e491863f144efc5b",
  sourceSha256: "7bee7d0e6e8b77f02c74512497155d11a728a150248190c5ce3454daf97ce854",
  advisory: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizedHash(source) {
  return createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
}

function installedPicomatchCopies(root) {
  const copies = new Set();
  const visited = new Set();
  function visitModules(modules) {
    if (!existsSync(modules)) return;
    const actual = realpathSync(modules);
    if (visited.has(actual)) return;
    visited.add(actual);
    for (const entry of readdirSync(actual, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith("@")) {
        for (const scoped of readdirSync(join(actual, entry.name))) {
          visitPackage(join(actual, entry.name, scoped));
        }
      } else {
        visitPackage(join(actual, entry.name));
      }
    }
  }
  function visitPackage(directory) {
    const manifest = join(directory, "package.json");
    if (!existsSync(manifest)) return;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (pkg.name === "picomatch") copies.add(realpathSync(directory));
    visitModules(join(directory, "node_modules"));
  }
  visitModules(join(root, "node_modules"));
  return [...copies];
}

export function verifyPicomatchPatch(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  requireCondition(pkg.overrides?.picomatch === PATCH.version, "picomatch pin changed");
  requireCondition(
    pkg.patchedDependencies?.[`picomatch@${PATCH.version}`] === PATCH.path,
    "picomatch patch declaration is missing",
  );
  requireCondition(
    normalizedHash(readFileSync(join(root, PATCH.path), "utf8")) === PATCH.sha256,
    "picomatch patch file integrity failed",
  );
  const lock = readFileSync(join(root, "bun.lock"), "utf8");
  requireCondition(
    lock.includes(`"picomatch@${PATCH.version}": "${PATCH.path}"`),
    "lockfile patch declaration is missing",
  );
  const locked = [...lock.matchAll(/^\s*"[^"]+": \["picomatch@([^"]+)"/gm)];
  requireCondition(
    locked.length > 0 && locked.every((match) => match[1] === PATCH.version),
    "lockfile contains an unexpected picomatch version",
  );
  const copies = installedPicomatchCopies(root);
  requireCondition(copies.length > 0, "no installed picomatch copy was verified");
  for (const directory of copies) {
    const installed = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    requireCondition(installed.version === PATCH.version, "installed picomatch version changed");
    requireCondition(
      normalizedHash(readFileSync(join(directory, "lib/parse.js"), "utf8")) === PATCH.sourceSha256,
      "installed picomatch source integrity failed",
    );
  }
  return copies;
}

export function verifyGlobBehavior(directory) {
  // A child process bounds a regression that could otherwise hang CI's event loop.
  const probe = `
    const assert = require("node:assert/strict");
    const pm = require(process.argv[1]);
    const attacks = [
      "+(*)b", "+(*a)b", "*(*)b", "*(a*)b", "+(?*)b", "+([ab]*)c",
      "+(*a|b)c", "*(a*|b)c", "+({a*,b*})c", "+(@(*a))b"
    ];
    let checks = 0;
    for (const pattern of attacks) {
      for (const options of [{}, {capture:true}, {windows:true}, {dot:true}]) {
        const re = pm.makeRe(pattern, options);
        for (const length of [60, 256, 4096]) {
          assert.equal(re.test("a".repeat(length) + "z"), false);
          checks++;
        }
      }
      assert.equal(pm.isMatch(pattern, pattern), true);
      checks++;
    }
    for (const [input, pattern, expected] of [
      ["src/a.ts", "**/*.{ts,tsx}", true],
      ["src/a.css", "**/*.{ts,tsx}", false],
      ["src/a.tsx", "src/**/@(a|b).tsx", true],
      ["src/c.tsx", "src/**/@(a|b).tsx", false],
      ["src/file.ts", "src/**/!(index).ts", true],
      ["src/index.ts", "src/**/!(index).ts", false],
      ["abab", "+(ab)", true],
      ["aaab", "+(ab)", false],
      ["foobarfoo", "+(foo|bar)", true],
      ["aaabbb", "+(*(a)|*(b))", true],
      ["a*", "+(a\\\\*)", true]
    ]) {
      assert.equal(pm.isMatch(input, pattern), expected, input + " " + pattern);
      checks++;
    }
    console.log(JSON.stringify({checks}));
  `;
  const result = spawnSync(process.execPath, ["-e", probe, directory], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  requireCondition(
    !result.error && result.status === 0 && !result.signal,
    `picomatch security/compatibility probe failed: ${result.error?.message || result.stderr}`,
  );
  return JSON.parse(result.stdout).checks;
}

export function assessAudit(report, exitCode, patchVerified) {
  requireCondition(exitCode === 0 || exitCode === 1, "dependency audit did not complete");
  requireCondition(
    report !== null && typeof report === "object" && !Array.isArray(report),
    "invalid dependency audit response",
  );
  const blocked = [];
  let mitigated = 0;
  let findings = 0;
  for (const [name, advisories] of Object.entries(report)) {
    requireCondition(Array.isArray(advisories), "invalid advisory list");
    for (const advisory of advisories) {
      requireCondition(
        advisory &&
          typeof advisory.url === "string" &&
          ["low", "moderate", "high", "critical"].includes(advisory.severity) &&
          typeof advisory.vulnerable_versions === "string",
        "invalid advisory entry",
      );
      findings++;
      if (
        patchVerified === true &&
        name === "picomatch" &&
        advisory.id === 1247710 &&
        advisory.url === PATCH.advisory &&
        advisory.severity === "high" &&
        advisory.vulnerable_versions === "<=4.0.7"
      ) {
        mitigated++;
      } else {
        blocked.push(`${name}: ${advisory.url}`);
      }
    }
  }
  requireCondition(mitigated <= 1, "duplicate mitigation entries require review");
  requireCondition(!(exitCode === 1 && findings === 0), "audit failed without advisory data");
  requireCondition(blocked.length === 0, `unmitigated advisories:\n${blocked.join("\n")}`);
  return { findings, mitigated };
}

export function main() {
  const copies = verifyPicomatchPatch();
  const behaviorChecks = copies.reduce((sum, directory) => sum + verifyGlobBehavior(directory), 0);
  console.log(
    `Verified ${copies.length} patched picomatch copy/copies; ${behaviorChecks} bounded behavior checks.`,
  );
  const audit = spawnSync(process.env.npm_execpath || "bun", ["audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  requireCondition(!audit.error && !audit.signal, "dependency audit process failed");
  const result = assessAudit(JSON.parse(audit.stdout), audit.status, true);
  console.log(
    `Dependency audit passed: ${result.findings} reported, ${result.mitigated} locally mitigated, 0 unmitigated. Upstream metadata still reports ${PATCH.advisory}; local patch integrity and behavior were verified.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
