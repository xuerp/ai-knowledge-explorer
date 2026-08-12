import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyStagingBuild } from "../scripts/verify-staging-build.mjs";

test("预发构建拒绝本机 API 地址", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-radar-staging-build-"));
  try {
    await mkdir(join(root, "server"));
    await writeFile(join(root, "server", "index.mjs"), 'const api = "http://127.0.0.1:8001";');
    await assert.rejects(() => verifyStagingBuild(root), /未包含预期 API 地址/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("预发构建确认 Render API 地址", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-radar-staging-build-"));
  try {
    await mkdir(join(root, "public"));
    await writeFile(
      join(root, "public", "app.js"),
      'const api = "https://ai-radar-api-staging.onrender.com";',
    );
    const result = await verifyStagingBuild(root);
    assert.equal(result.filesChecked, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
