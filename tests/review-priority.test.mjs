import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { assessReviewItem, orderReviewItems } = await vite.ssrLoadModule(
  "/src/domain/review-priority.ts",
);
const { classifyReviewLane, reviewLaneCounts } = await vite.ssrLoadModule(
  "/src/domain/review-lanes.ts",
);

test.after(async () => vite.close());

function item(overrides = {}) {
  return {
    id: "review",
    entityId: "e-gpt",
    status: "pending",
    version: 1,
    createdAt: "2026-08-20T00:00:00Z",
    claim: {
      id: "claim",
      text: { zh: "事实", en: "Fact" },
      confidence: "unverified",
      subject: "GPT",
      predicate: "has-capability",
      objectOrValue: "MCP",
    },
    evidenceIds: ["evidence"],
    evidenceItems: [
      {
        id: "evidence",
        title: { zh: "官方文档", en: "Official docs" },
        url: "https://example.com",
        publisher: "Example",
        publishedAt: "2026-08-20",
        collectedAt: "2026-08-20",
        type: "official",
        sourceExcerpt: "GPT uses MCP.",
      },
    ],
    conflictClaimIds: [],
    ...overrides,
  };
}

test("审核候选会区分批量安全、新鲜度和高风险", () => {
  const now = new Date("2026-08-22T00:00:00Z");
  const safe = assessReviewItem(item(), now);
  assert.equal(safe.risk, "standard");
  assert.equal(safe.freshness, "fresh");
  assert.equal(safe.batchSafe, true);

  const community = item({
    id: "community",
    evidenceItems: [{ ...item().evidenceItems[0], type: "community" }],
  });
  assert.equal(assessReviewItem(community, now).risk, "high");

  const stale = item({
    id: "stale",
    createdAt: "2024-01-01T00:00:00Z",
    evidenceItems: [
      {
        ...item().evidenceItems[0],
        publishedAt: "2024-01-01",
        collectedAt: "2024-01-01",
      },
    ],
  });
  assert.equal(assessReviewItem(stale, now).freshness, "stale");
  assert.deepEqual(
    orderReviewItems([stale, community], now).map((candidate) => candidate.id),
    ["community", "stale"],
  );
});

test("审核队列按六条互斥工作通道分类", () => {
  const now = new Date("2026-08-22T00:00:00Z");
  const approved = item({
    id: "approved",
    status: "approved",
    lifecycleStatus: "current",
    publicationAction: "new",
  });
  const duplicate = item({ id: "duplicate" });
  const update = item({
    id: "update",
    claim: {
      ...item().claim,
      objectOrValue: "2M",
    },
    evidenceItems: [
      {
        ...item().evidenceItems[0],
        sourceExcerpt: "GPT uses MCP with 2M.",
      },
    ],
  });
  const highRisk = item({
    id: "high-risk",
    claim: {
      ...item().claim,
      predicate: "benchmark",
      objectOrValue: "90",
    },
    evidenceItems: [
      {
        ...item().evidenceItems[0],
        type: "community",
        sourceExcerpt: "GPT benchmark 90.",
      },
    ],
  });
  const invalid = item({ id: "invalid", entityId: undefined });
  const safe = item({
    id: "safe",
    claim: {
      ...item().claim,
      predicate: "capability",
      objectOrValue: "Tools",
    },
    evidenceItems: [
      {
        ...item().evidenceItems[0],
        sourceExcerpt: "GPT capability Tools.",
      },
    ],
  });

  assert.equal(classifyReviewLane(duplicate, [approved], now), "duplicate");
  assert.equal(classifyReviewLane(update, [approved], now), "possible-update");
  assert.equal(classifyReviewLane(highRisk, [], now), "high-risk");
  assert.equal(classifyReviewLane(invalid, [], now), "invalid");
  assert.equal(classifyReviewLane(safe, [], now), "fresh-safe");
  assert.deepEqual(
    reviewLaneCounts([duplicate, update, highRisk, invalid, safe], [approved], now),
    {
      "fresh-safe": 1,
      duplicate: 1,
      "possible-update": 1,
      "high-risk": 1,
      invalid: 1,
      stale: 0,
    },
  );
});
