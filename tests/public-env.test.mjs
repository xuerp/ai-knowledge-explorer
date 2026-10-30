import assert from "node:assert/strict";
import test from "node:test";
import { validatePublicEnvironment } from "../scripts/check-public-env.mjs";

const valid =
  "VITE_API_BASE_URL=https://app.example.com/backend\nVITE_API_UPSTREAM_URL=https://api.example.com\n";

test("tracked staging configuration accepts the documented public URL contract", () => {
  assert.doesNotThrow(() => validatePublicEnvironment(valid));
});

test("new secret-like keys cannot enter the tracked staging environment", () => {
  assert.throws(() => validatePublicEnvironment(`${valid}API_KEY=test-placeholder\n`));
  assert.throws(() => validatePublicEnvironment(`${valid}VITE_PROVIDER_TOKEN=test-placeholder\n`));
});

test("URLs cannot carry embedded credentials or secret query parameters", () => {
  for (const url of [
    "https://user:password@example.com",
    "https://example.com?token=test",
    "http://example.com",
  ]) {
    assert.throws(() => validatePublicEnvironment(valid.replace("https://api.example.com", url)));
  }
});
