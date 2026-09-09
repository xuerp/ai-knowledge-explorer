import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReadonlyAuthHeaders,
  normalizeStagingApiUrl,
  runReadonlyStagingAudit,
} from "../scripts/audit-staging-readonly.mjs";

const secret = "secret-that-must-never-appear-in-the-report";

test("readonly staging audit requires HTTPS and an explicit credential", async () => {
  assert.throws(() => normalizeStagingApiUrl("http://api.example"), /只允许 HTTPS/);
  assert.throws(() => buildReadonlyAuthHeaders({}), /缺少只读审计凭据/);
  await assert.rejects(
    runReadonlyStagingAudit({ apiBaseUrl: "https://api.example", fetchImpl: async () => {} }),
    /缺少只读审计凭据/,
  );
});

test("readonly staging audit only performs allowlisted GET requests and redacts credentials", async () => {
  const requests = [];
  const payloads = {
    "/ready": {
      ok: true,
      buildCommit: "a".repeat(40),
      schemaRevision: "20260905_0023",
      environment: "production",
      dataMode: "demo",
      authEnabled: true,
      adminWritesEnabled: true,
    },
    "/api/v2/public/relation-backfill-status": { status: "complete", candidatesCreated: 1 },
    "/api/v2/review/stats": { openCount: 34, approvedCount: 195, rejectedCount: 397 },
    "/api/v2/admin/integrations": {
      extractionConfigured: true,
      automaticExtractionEnabled: false,
      automaticExtractionMaxSnapshotsPerCycle: 0,
      automaticRelationApprovalEnabled: false,
    },
    "/api/v2/admin/review-queue-inventory": { openTotal: 34, conflictItems: 0 },
    "/api/v2/admin/data-quality": {
      liveReady: false,
      entityCount: 49,
      claimCount: 198,
      evidenceCount: 220,
      relationCount: 77,
      timelineEntryCount: 55,
      evidenceReferenceCoverage: 1,
      coreRelationDeficit: 42,
      issues: ["relation gap"],
    },
    "/api/v2/admin/release-baseline": {
      build: { buildCommit: "a".repeat(40) },
      claims: { publicClaimCount: 198 },
      sourceHealth: { active: 1 },
      readiness: { automatedReady: false, blockingCount: 1 },
    },
  };
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    requests.push({ path, init });
    return new Response(JSON.stringify(payloads[path]), { status: 200 });
  };

  const report = await runReadonlyStagingAudit({
    apiBaseUrl: "https://api.example/base-that-is-normalized-away",
    adminToken: secret,
    fetchImpl,
  });

  assert.equal(requests.length, 7);
  assert.ok(requests.every(({ init }) => init.method === "GET"));
  assert.ok(requests.every(({ init }) => init.headers["X-Admin-Token"] === secret));
  assert.equal(report.readOnly, true);
  assert.equal(report.extraction.automaticEnabled, false);
  assert.equal(report.extraction.maxSnapshotsPerCycle, 0);
  assert.equal(report.extraction.relationAutoApprovalEnabled, false);
  assert.equal(report.review.inventory.openTotal, 34);
  assert.equal(report.quality.liveReady, false);
  assert.equal(JSON.stringify(report).includes(secret), false);
});
