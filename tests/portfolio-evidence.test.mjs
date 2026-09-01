import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("作品集包含六份已接受且可追溯的架构决策", async () => {
  const adrs = await Promise.all(
    [
      "0001-why-lexical-before-vector-search.md",
      "0002-why-relation-extraction-after-claim-threshold.md",
      "0003-candidate-verified-claim-separation.md",
      "0004-risk-tiered-review.md",
      "0005-embedding-model-selection.md",
      "0006-relation-gap-is-not-a-kpi.md",
    ].map((name) => readProjectFile(`docs/adr/${name}`)),
  );

  assert.equal(adrs.length, 6);
  for (const adr of adrs) {
    assert.match(adr, /状态：接受/);
    assert.match(adr, /## (决策|背景)/);
    assert.match(adr, /## 后果/);
  }
});

test("Case Study 的检索曲线与固定评估证据一致", async () => {
  const caseStudy = await readProjectFile("docs/PORTFOLIO_CASE_STUDY.md");

  assert.match(caseStudy, /Golden Set v1\.0\.0（80 条）/);
  assert.match(caseStudy, /PostgreSQL lexical FTS baseline\s*\|\s*99\.38%\s*\|\s*14\.06%/);
  assert.match(caseStudy, /Alias v1\.0\.0 \+ lexical[\s\S]*16\/24 → 24\/24/);
  assert.match(caseStudy, /Cloudflare BGE-M3 \+ lexical RRF\s*\|\s*100\.00%\s*\|\s*14\.22%/);
  assert.match(caseStudy, /49 个实体、197 条 Claim、219 条 Evidence、76 条 Relation/);
});

test("公开材料不回退到过时的演示快照计数", async () => {
  const materials = (
    await Promise.all([
      readProjectFile("docs/PORTFOLIO_CASE_STUDY.md"),
      readProjectFile("docs/RESUME_AND_INTERVIEW.md"),
    ])
  ).join("\n");

  assert.doesNotMatch(materials, /23 条 Claim|40 条(?:证据| Evidence)|71 条(?:关系| Relation)/);
});
