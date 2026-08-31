import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const userApiSource = await readFile(
  new URL("../src/services/user-api.ts", import.meta.url),
  "utf8",
);
const statusSource = await readFile(
  new URL("../src/components/research/RetrievalStatus.tsx", import.meta.url),
  "utf8",
);
const askSource = await readFile(new URL("../src/routes/ask.tsx", import.meta.url), "utf8");
const recordSource = await readFile(
  new URL("../src/routes/research.$id.tsx", import.meta.url),
  "utf8",
);

test("live research preserves retrieval diagnostics from the API", () => {
  assert.match(userApiSource, /retrievalMode: "lexical" \| "hybrid"/);
  assert.match(userApiSource, /retrievalDiagnostics:/);
  assert.match(userApiSource, /fallbackReason\?: string/);
});

test("private research surfaces hybrid and safe fallback state", () => {
  assert.match(statusSource, /data-testid="research-retrieval-status"/);
  assert.match(statusSource, /research\.retrievalMode === "hybrid"/);
  assert.match(statusSource, /diagnostics\.fallbackReason/);
  assert.match(askSource, /<RetrievalStatus research=\{research\} \/>/);
  assert.match(recordSource, /<RetrievalStatus research=\{liveResearch\} \/>/);
});
