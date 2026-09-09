import { pathToFileURL } from "node:url";

const DEFAULT_STAGING_API = "https://ai-radar-api-staging.onrender.com";

const endpoints = Object.freeze({
  ready: "/ready",
  relationBackfill: "/api/v2/public/relation-backfill-status",
  reviewStats: "/api/v2/review/stats",
  integrations: "/api/v2/admin/integrations",
  reviewInventory: "/api/v2/admin/review-queue-inventory",
  dataQuality: "/api/v2/admin/data-quality",
  releaseBaseline: "/api/v2/admin/release-baseline",
});

export function normalizeStagingApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AI_RADAR_STAGING_API_URL 不是有效 URL。");
  }
  if (url.protocol !== "https:") {
    throw new Error("staging 管理审计只允许 HTTPS API 地址。");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url;
}

export function buildReadonlyAuthHeaders({ bearerToken, adminToken }) {
  const headers = { Accept: "application/json" };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
    return headers;
  }
  if (adminToken) {
    headers["X-Admin-Token"] = adminToken;
    return headers;
  }
  throw new Error(
    "缺少只读审计凭据。请安全设置 AI_RADAR_STAGING_BEARER_TOKEN 或 AI_RADAR_STAGING_ADMIN_TOKEN。",
  );
}

async function readJson(fetchImpl, apiRoot, path, headers) {
  const response = await fetchImpl(`${apiRoot}${path}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GET ${path} 返回 ${response.status}。`);
  }
  return response.json();
}

export async function runReadonlyStagingAudit({
  apiBaseUrl = DEFAULT_STAGING_API,
  bearerToken,
  adminToken,
  fetchImpl = fetch,
}) {
  const api = normalizeStagingApiUrl(apiBaseUrl);
  const apiRoot = api.href.replace(/\/$/, "");
  const headers = buildReadonlyAuthHeaders({ bearerToken, adminToken });
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([name, path]) => [
      name,
      await readJson(fetchImpl, apiRoot, path, headers),
    ]),
  );
  const result = Object.fromEntries(entries);

  return {
    api: api.origin,
    readOnly: true,
    build: {
      ok: result.ready.ok,
      commit: result.ready.buildCommit,
      schemaRevision: result.ready.schemaRevision,
      environment: result.ready.environment,
      dataMode: result.ready.dataMode,
      authEnabled: result.ready.authEnabled,
      adminWritesEnabled: result.ready.adminWritesEnabled,
    },
    extraction: {
      configured: result.integrations.extractionConfigured,
      automaticEnabled: result.integrations.automaticExtractionEnabled,
      maxSnapshotsPerCycle: result.integrations.automaticExtractionMaxSnapshotsPerCycle,
      relationAutoApprovalEnabled: result.integrations.automaticRelationApprovalEnabled,
    },
    relationBackfill: result.relationBackfill,
    review: {
      stats: result.reviewStats,
      inventory: result.reviewInventory,
    },
    quality: {
      liveReady: result.dataQuality.liveReady,
      entityCount: result.dataQuality.entityCount,
      claimCount: result.dataQuality.claimCount,
      evidenceCount: result.dataQuality.evidenceCount,
      relationCount: result.dataQuality.relationCount,
      timelineEntryCount: result.dataQuality.timelineEntryCount,
      evidenceReferenceCoverage: result.dataQuality.evidenceReferenceCoverage,
      coreRelationDeficit: result.dataQuality.coreRelationDeficit,
      issues: result.dataQuality.issues,
    },
    release: {
      commit: result.releaseBaseline.build?.buildCommit,
      claims: result.releaseBaseline.claims,
      sourceHealth: result.releaseBaseline.sourceHealth,
      readiness: result.releaseBaseline.readiness,
    },
  };
}

async function main() {
  const report = await runReadonlyStagingAudit({
    apiBaseUrl: process.env.AI_RADAR_STAGING_API_URL ?? DEFAULT_STAGING_API,
    bearerToken: process.env.AI_RADAR_STAGING_BEARER_TOKEN,
    adminToken: process.env.AI_RADAR_STAGING_ADMIN_TOKEN,
  });
  console.log(JSON.stringify(report, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
