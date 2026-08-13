import assert from "node:assert/strict";
import test from "node:test";
import { buildStagingWranglerConfig } from "../scripts/prepare-cloudflare-deploy.mjs";

const base = {
  name: "generated-name",
  main: "index.mjs",
  compatibility_date: "2026-08-09",
  assets: { binding: "ASSETS", directory: "../public" },
};

test("Cloudflare staging config keeps workers.dev when no domain is selected", () => {
  const result = buildStagingWranglerConfig(base);
  assert.equal(result.name, "ai-radar-staging");
  assert.equal(result.workers_dev, true);
  assert.equal(result.preview_urls, true);
  assert.equal(result.routes, undefined);
  assert.equal(result.observability.enabled, true);
  assert.equal(result.compatibility_date, "2026-08-13");
});

test("Cloudflare staging config never inherits a locally generated future date", () => {
  const result = buildStagingWranglerConfig({
    ...base,
    compatibility_date: "2099-01-01",
  });
  assert.equal(result.compatibility_date, "2026-08-13");
});

test("Cloudflare staging config enables an explicit custom domain", () => {
  const result = buildStagingWranglerConfig(base, {
    workerName: "ai-radar-staging-cn",
    domain: "staging.radar.example.com",
  });
  assert.equal(result.workers_dev, false);
  assert.deepEqual(result.routes, [{ pattern: "staging.radar.example.com", custom_domain: true }]);
  assert.throws(
    () => buildStagingWranglerConfig(base, { domain: "https://bad.example.com/path" }),
    /完整主机名/,
  );
});
