import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessAudit,
  normalizedHash,
  PATCH,
  verifyGlobBehavior,
  verifyPicomatchPatch,
} from "../scripts/audit-frontend-dependencies.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const advisory = {
  id: 1247710,
  url: PATCH.advisory,
  severity: "high",
  vulnerable_versions: "<=4.0.7",
};
const report = () => ({ picomatch: [{ ...advisory }] });

function fixture(t) {
  const prefix = join(tmpdir(), "ai-radar-dependency-audit-");
  const root = mkdtempSync(prefix);
  t.after(() => {
    assert.ok(root.startsWith(prefix));
    rmSync(root, { recursive: true, force: true });
  });
  for (const file of ["package.json", "bun.lock", PATCH.path]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(ROOT, file), join(root, file));
  }
  cpSync(join(ROOT, "node_modules/picomatch"), join(root, "node_modules/picomatch"), {
    recursive: true,
  });
  return root;
}

function editJson(file, change) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  change(data);
  writeFileSync(file, JSON.stringify(data));
}

test("installed mitigation passes bounded attack and ordinary build-glob checks", () => {
  const copies = verifyPicomatchPatch();
  assert.ok(copies.length > 0);
  for (const copy of copies) assert.equal(verifyGlobBehavior(copy), 141);
});

test("an absent patch cannot qualify for mitigation", (t) => {
  const root = fixture(t);
  rmSync(join(root, PATCH.path));
  assert.throws(() => verifyPicomatchPatch(root), /ENOENT/);
});

test("a tampered patch cannot qualify for mitigation", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, PATCH.path), "unexpected patch");
  assert.throws(() => verifyPicomatchPatch(root), /patch file integrity/);
});

test("an absent installation declaration cannot qualify", (t) => {
  const root = fixture(t);
  editJson(join(root, "package.json"), (pkg) => delete pkg.patchedDependencies);
  assert.throws(() => verifyPicomatchPatch(root), /patch declaration/);
});

test("a changed dependency pin cannot qualify", (t) => {
  const root = fixture(t);
  editJson(join(root, "package.json"), (pkg) => (pkg.overrides.picomatch = "4.0.4"));
  assert.throws(() => verifyPicomatchPatch(root), /pin changed/);
});

test("an unpatched version in the lockfile is rejected", (t) => {
  const root = fixture(t);
  const lock = join(root, "bun.lock");
  writeFileSync(
    lock,
    readFileSync(lock, "utf8").replace('["picomatch@4.0.7"', '["picomatch@4.0.4"'),
  );
  assert.throws(() => verifyPicomatchPatch(root), /unexpected picomatch version/);
});

test("an unpatched installed parser is rejected even with unchanged version metadata", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "node_modules/picomatch/lib/parse.js"), "unpatched source");
  assert.throws(() => verifyPicomatchPatch(root), /source integrity/);
});

test("a nested stale picomatch copy is rejected", (t) => {
  const root = fixture(t);
  const nested = join(root, "node_modules/fixture/node_modules/picomatch");
  mkdirSync(dirname(nested), { recursive: true });
  writeFileSync(join(root, "node_modules/fixture/package.json"), '{"name":"fixture"}');
  cpSync(join(root, "node_modules/picomatch"), nested, { recursive: true });
  editJson(join(nested, "package.json"), (pkg) => (pkg.version = "4.0.4"));
  assert.throws(() => verifyPicomatchPatch(root), /installed picomatch version/);
});

test("a nested tampered parser is rejected", (t) => {
  const root = fixture(t);
  const nested = join(root, "node_modules/fixture/node_modules/picomatch");
  mkdirSync(dirname(nested), { recursive: true });
  writeFileSync(join(root, "node_modules/fixture/package.json"), '{"name":"fixture"}');
  cpSync(join(root, "node_modules/picomatch"), nested, { recursive: true });
  writeFileSync(join(nested, "lib/parse.js"), "unpatched source");
  assert.throws(() => verifyPicomatchPatch(root), /source integrity/);
});

test("only the verified local patch qualifies the exact reported advisory", () => {
  assert.deepEqual(assessAudit(report(), 1, true), { findings: 1, mitigated: 1 });
  assert.throws(() => assessAudit(report(), 1, false), /unmitigated/);
});

test("another advisory on picomatch still blocks publication", () => {
  const findings = report();
  findings.picomatch.push({ ...advisory, id: 999, url: "https://github.com/advisories/GHSA-new" });
  assert.throws(() => assessAudit(findings, 1, true), /unmitigated/);
});

test("an advisory on any other dependency still blocks publication", () => {
  const findings = report();
  findings.other = [{ ...advisory }];
  assert.throws(() => assessAudit(findings, 1, true), /other:/);
});

test("changed advisory identity, severity or affected range requires review", () => {
  for (const update of [
    { id: 999 },
    { url: "https://github.com/advisories/GHSA-other" },
    { severity: "critical" },
    { vulnerable_versions: "<=4.0.8" },
  ]) {
    assert.throws(
      () => assessAudit({ picomatch: [{ ...advisory, ...update }] }, 1, true),
      /unmitigated/,
    );
  }
});

test("invalid audit responses fail closed", () => {
  for (const invalid of [null, [], { picomatch: {} }, { picomatch: [{}] }]) {
    assert.throws(() => assessAudit(invalid, 1, true), /invalid/);
  }
  assert.throws(() => assessAudit({}, 1, true), /without advisory data/);
  assert.throws(() => assessAudit({}, 2, true), /did not complete/);
  assert.throws(() => assessAudit({}, null, true), /did not complete/);
});

test("a zero exit code cannot hide an unmitigated advisory", () => {
  assert.throws(() => assessAudit({ other: [{ ...advisory }] }, 0, true), /unmitigated/);
  assert.deepEqual(assessAudit({}, 0, true), { findings: 0, mitigated: 0 });
});

test("duplicate mitigation entries fail closed", () => {
  assert.throws(
    () => assessAudit({ picomatch: [{ ...advisory }, { ...advisory }] }, 1, true),
    /duplicate/,
  );
});

test("integrity checks normalize Windows line endings only", () => {
  assert.equal(normalizedHash("a\nb\n"), normalizedHash("a\r\nb\r\n"));
  assert.notEqual(normalizedHash("a\nb\n"), normalizedHash("a\nb!\n"));
});
