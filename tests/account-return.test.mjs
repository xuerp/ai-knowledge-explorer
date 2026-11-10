import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/domain/account-return.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { safeReturnTo } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const origin = "https://radar.example.com";

test("admin sign-in returns to user management, while other roles remain on their account", () => {
  assert.equal(safeReturnTo("/admin/users", origin, "admin"), "/admin/users");
  for (const role of ["viewer", "reviewer"]) {
    assert.equal(safeReturnTo("/admin/users", origin, role), "");
  }
});

test("return destinations retain existing research flows and reject external or unrelated paths", () => {
  assert.equal(safeReturnTo("/ask?task=one#result", origin, "viewer"), "/ask?task=one#result");
  assert.equal(safeReturnTo("/research/record-id", origin, "viewer"), "/research/record-id");
  for (const path of [
    null,
    "https://other.example.com/admin/users",
    "//other.example.com/ask",
    "/admin/users/extra",
    "/other",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeReturnTo(path, origin, "admin"), "");
  }
});
