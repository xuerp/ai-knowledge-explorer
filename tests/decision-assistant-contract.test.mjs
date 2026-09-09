import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const askRoute = await readFile(new URL("../src/routes/ask.tsx", import.meta.url), "utf8");
const accountRoute = await readFile(new URL("../src/routes/account.tsx", import.meta.url), "utf8");
const userApi = await readFile(new URL("../src/services/user-api.ts", import.meta.url), "utf8");
const decisionBrief = await readFile(
  new URL("../src/components/research/DecisionBrief.tsx", import.meta.url),
  "utf8",
);
const privateRecord = await readFile(
  new URL("../src/routes/research.$id.tsx", import.meta.url),
  "utf8",
);
const publicRecord = await readFile(
  new URL("../src/routes/share.$id.tsx", import.meta.url),
  "utf8",
);

test("decision assistant collects task, priority, budget, deployment, and exclusions", () => {
  for (const field of ["task", "priority", "budget", "deployment", "exclusions"]) {
    assert.match(askRoute, new RegExp(field));
  }
  assert.match(askRoute, /decisionContext/);
  assert.match(askRoute, /useSyncExternalStore/);
});

test("decision output exposes conditions, trade-offs, risks, next checks, and evidence time", () => {
  for (const field of ["conditions", "tradeoffs", "risks", "nextChecks", "asOf"]) {
    assert.match(userApi, new RegExp(field));
    assert.match(`${askRoute}\n${decisionBrief}`, new RegExp(field));
  }
  assert.match(decisionBrief, /有条件建议/);
});

test("decision evidence links resolve and persisted records restore the same brief", () => {
  assert.match(askRoute, /id=\{`claim-\$\{id\}`\}/);
  assert.match(privateRecord, /<DecisionBrief/);
  assert.match(publicRecord, /<DecisionBrief/);
  assert.match(publicRecord, /id=\{`claim-\$\{citation\.claim\.id\}`\}/);
});

test("live submission is single-flight and preserves inputs after network failure", () => {
  assert.match(askRoute, /if \(submissionInFlight\.current\) return/);
  assert.match(askRoute, /submissionInFlight\.current = true/);
  assert.match(askRoute, /submissionInFlight\.current = false/);
  assert.doesNotMatch(askRoute, /catch[\s\S]{0,300}setTask\(""\)/);
});

test("expired sessions clear auth and resume the complete decision form after login", () => {
  assert.match(userApi, /expireAuthSession\(\)/);
  assert.match(userApi, /throw new AuthSessionExpiredError\(\)/);
  assert.match(askRoute, /authSessionExpiredEvent/);
  assert.match(askRoute, /重新登录并继续/);
  assert.match(accountRoute, /destination\.pathname !== "\/ask"/);
  assert.match(accountRoute, /window\.location\.assign\(returnTo\)/);
  for (const field of [
    "task",
    "priority",
    "budgetMode",
    "budgetMinimum",
    "budgetMaximum",
    "deployment",
    "exclusions",
    "notes",
    "candidateEntityIds",
  ]) {
    assert.match(askRoute, new RegExp(field));
  }
});
