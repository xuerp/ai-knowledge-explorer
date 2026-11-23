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

test("an expired session returns to the saved research record", () => {
  // /ask links here when a session expires with a result on screen.
  const id = "2c577477-0ac5-4090-9e54-a5d70010305c";
  const returnTo = `/research/${encodeURIComponent(id)}`;
  for (const role of ["viewer", "admin"]) {
    assert.equal(safeReturnTo(returnTo, origin, role), returnTo);
  }
});
