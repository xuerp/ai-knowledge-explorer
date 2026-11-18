import assert from "node:assert/strict";
import test from "node:test";

import { deploymentUrl, deployRenderStaging } from "../scripts/deploy-render-staging.mjs";

const commit = "a".repeat(40);
const hook = "https://api.render.com/deploy/srv-d9s7ljvavr4c73al2kjg?key=test-only-secret";

test("Render deployment pins the verified commit and targets the existing service", async () => {
  let observed;
  const result = await deployRenderStaging({
    hook,
    commit,
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return new Response('{"private":"not returned"}', { status: 202 });
    },
  });
  assert.equal(observed.url.searchParams.get("ref"), commit);
  assert.equal(observed.url.searchParams.get("key"), "test-only-secret");
  assert.equal(observed.init.method, "POST");
  assert.equal(observed.init.redirect, "error");
  assert.ok(observed.init.signal instanceof AbortSignal);
  assert.deepEqual(result, { service: "srv-d9s7ljvavr4c73al2kjg", commit, accepted: true });
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("invalid credentials or commit cannot issue a deployment request", async () => {
  const invalid = [
    [undefined, commit],
    ["not-a-url-test-only-secret", commit],
    [hook.replace("https:", "http:"), commit],
    [hook.replace("api.render.com", "api.render.com.attacker.example"), commit],
    [hook.replace("/srv-d9s7ljvavr4c73al2kjg", "/srv-other"), commit],
    [hook.replace("https://", "https://user:password@"), commit],
    [hook.replace("api.render.com", "api.render.com:8443"), commit],
    [hook + "#secret", commit],
    [hook + "&ref=" + "b".repeat(40), commit],
    [hook + "&key=duplicate", commit],
    [hook.replace("test-only-secret", ""), commit],
    [hook, "a".repeat(7)],
    [hook, undefined],
  ];
  for (const [candidate, sha] of invalid) {
    let calls = 0;
    await assert.rejects(
      deployRenderStaging({
        hook: candidate,
        commit: sha,
        fetchImpl: async () => {
          calls++;
          throw new Error("must not be called");
        },
      }),
      (error) => !error.message.includes("test-only-secret"),
    );
    assert.equal(calls, 0);
  }
});

test("network and redirect errors cannot leak the deployment key", async () => {
  await assert.rejects(
    deployRenderStaging({
      hook,
      commit,
      fetchImpl: async () => {
        throw new Error("Failed to fetch " + hook);
      },
    }),
    (error) => error.message.includes("credential details hidden") && !error.message.includes(hook),
  );
});

test("a rejected deployment fails without exposing its response body", async () => {
  await assert.rejects(
    deployRenderStaging({
      hook,
      commit,
      fetchImpl: async () => new Response(hook, { status: 401 }),
    }),
    (error) => error.message.endsWith("(HTTP 401).") && !error.message.includes("secret"),
  );
});

test("the helper never accepts a caller-selected revision from the secret", () => {
  assert.throws(() => deploymentUrl(hook + "&ref=main", commit));
  assert.equal(deploymentUrl(hook, commit).searchParams.get("ref"), commit);
});
