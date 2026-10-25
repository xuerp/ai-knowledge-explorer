import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { publicCatalogSnapshot } from "../src/data/catalog-overlay.mjs";

test("public catalog preserves knowledge and prompts without invented visitor activity", () => {
  const base = JSON.parse(
    readFileSync(new URL("../backend/data/demo_snapshot.json", import.meta.url), "utf8"),
  );
  const original = structuredClone(base);
  const result = publicCatalogSnapshot(base);
  assert.deepEqual(base, original);
  assert.deepEqual(result.entities, base.entities);
  assert.deepEqual(result.claims, base.claims);
  assert.deepEqual(result.evidence, base.evidence);
  assert.deepEqual(result.researchQuestions, base.researchQuestions);
  for (const key of [
    "following",
    "interestProfile",
    "researchAnswers",
    "notifications",
    "reviewCandidates",
    "syncRuns",
  ]) {
    assert.deepEqual(result[key], [], key);
  }
});
