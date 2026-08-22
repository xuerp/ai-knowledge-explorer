import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("前端质量门禁串行隔离会加载 Vite 原生模块的测试文件", async () => {
  const packageJson = JSON.parse(
    await readFile(path.resolve(process.cwd(), "package.json"), "utf8"),
  );

  assert.match(packageJson.scripts.test, /--test-concurrency=1/);
  assert.match(packageJson.scripts.check, /--test-concurrency=1/);
});
