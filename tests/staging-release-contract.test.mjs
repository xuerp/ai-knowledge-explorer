import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildReleaseMarkerUrl,
  normalizeExpectedCommit,
  waitForStagingRelease,
} from "../scripts/wait-staging-release.mjs";
import { normalizeBuildCommit, stampBuildVersion } from "../scripts/stamp-build-version.mjs";

const expectedCommit = "0123456789abcdef0123456789abcdef01234567";

test("quality uploads the hidden staging build and pins its Python formatter", async () => {
  const [workflow, requirements] = await Promise.all([
    readFile(path.resolve(process.cwd(), ".github/workflows/quality.yml"), "utf8"),
    readFile(path.resolve(process.cwd(), "backend/requirements.txt"), "utf8"),
  ]);

  assert.match(workflow, /path: \.output\s+include-hidden-files: true/);
  assert.match(workflow, /stamp-build-version\.mjs \"\$GITHUB_SHA\"/);
  assert.match(requirements, /^ruff==0\.16\.0$/m);
});

test("staging build stamp writes the exact full commit", async (context) => {
  const outputDirectory = path.resolve(
    process.cwd(),
    ".test-output",
    `stamp-${process.pid}-${Date.now()}`,
  );
  const outputPath = path.join(outputDirectory, "version.txt");
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(outputDirectory, { force: true, recursive: true });
  });

  assert.equal(normalizeBuildCommit(expectedCommit.toUpperCase()), expectedCommit);
  assert.throws(() => normalizeBuildCommit("0123456"), /完整的 40 位 Git commit/);
  await stampBuildVersion(expectedCommit.toUpperCase(), outputPath);
  assert.equal(await readFile(outputPath, "utf8"), `${expectedCommit}\n`);
  assert.equal(
    await readFile(
      path.join(path.dirname(outputPath), "releases", `${expectedCommit}.txt`),
      "utf8",
    ),
    `${expectedCommit}\n`,
  );
});

test("staging release gate uses a commit-addressed frontend marker", () => {
  assert.equal(
    buildReleaseMarkerUrl(new URL("https://app.example/version.txt?stale=true"), expectedCommit)
      .href,
    `https://app.example/releases/${expectedCommit}.txt`,
  );
});

test("staging release gate requires a full commit", () => {
  assert.equal(normalizeExpectedCommit(expectedCommit.toUpperCase()), expectedCommit);
  assert.throws(() => normalizeExpectedCommit("0123456"), /完整的 40 位 Git commit/);
});

test("staging release gate waits until both deployments match the expected commit", async () => {
  const observations = [
    { backend: "a".repeat(40), frontend: expectedCommit },
    { backend: expectedCommit, frontend: expectedCommit },
  ];
  let requestIndex = 0;
  const fetchImpl = async (url) => {
    const observation = observations[Math.floor(requestIndex / 2)];
    requestIndex += 1;
    if (String(url).includes("ready")) {
      return new Response(JSON.stringify({ ok: true, buildCommit: observation.backend }), {
        status: 200,
      });
    }
    return new Response(observation.frontend, { status: 200 });
  };

  const result = await waitForStagingRelease({
    expectedCommit,
    apiReadyUrl: new URL("https://api.example/ready"),
    frontendVersionUrl: new URL("https://app.example/version.txt"),
    fetchImpl,
    maxAttempts: 2,
    intervalMs: 0,
    sleep: async () => {},
  });

  assert.equal(result.backendCommit, expectedCommit);
  assert.equal(result.frontendCommit, expectedCommit);
  assert.equal(requestIndex, 4);
});

test("staging release gate fails when either deployment stays stale", async () => {
  const fetchImpl = async (url) =>
    String(url).includes("ready")
      ? new Response(JSON.stringify({ ok: true, buildCommit: expectedCommit }), { status: 200 })
      : new Response("f".repeat(40), { status: 200 });

  await assert.rejects(
    waitForStagingRelease({
      expectedCommit,
      apiReadyUrl: new URL("https://api.example/ready"),
      frontendVersionUrl: new URL("https://app.example/version.txt"),
      fetchImpl,
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => {},
    }),
    /staging 未在等待窗口内运行预期提交/,
  );
});
