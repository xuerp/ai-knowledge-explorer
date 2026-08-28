import type { Entity, Evidence, GraphEdge, TimelineEntry } from "@/domain/types";
import type { CandidateCreateRequest } from "@/domain/manual-candidate";
import { expireAuthSession } from "@/services/auth-session";
import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, "") ?? "";

export interface AdminUser {
  email: string;
  role: "viewer" | "reviewer" | "admin";
}

export interface HealthStatus {
  ok: boolean;
  release: string;
  buildCommit: string;
  schemaRevision: string;
  builtAt?: string | null;
  environment: string;
  dataMode: "demo" | "live";
  database: string;
  adminWritesEnabled: boolean;
  authEnabled: boolean;
}

export interface ClaimEntityAuditReport {
  generatedAt: string;
  publicClaimCount: number;
  linkedClaimCount: number;
  missingOrInvalidCount: number;
  deterministicRepairCount: number;
  manualReviewCount: number;
  items: Array<{
    claimId: string;
    reviewJobId?: string | null;
    version?: number | null;
    currentEntityId?: string | null;
    subject?: string | null;
    resolution: "deterministic" | "review-required" | "ambiguous" | "unresolved" | "invalid";
    proposedEntityId?: string | null;
    candidateEntityIds: string[];
    reason: string;
    recommendedAction?: "assign" | "retract" | null;
    recommendedEntityId?: string | null;
    recommendationReason?: string | null;
  }>;
}

export interface ClaimEntityRepairReport {
  generatedAt: string;
  mode: "dry-run" | "apply";
  total: number;
  repairableCount: number;
  repairedCount: number;
  items: Array<{
    reviewJobId: string;
    claimId: string;
    previousEntityId?: string | null;
    proposedEntityId?: string | null;
    status: "repairable" | "repaired" | "skipped";
    reason: string;
  }>;
}

export interface ClaimEntityResolutionResult {
  reviewJobId: string;
  claimId: string;
  status: "assigned" | "retracted";
  previousEntityId?: string | null;
  entityId?: string | null;
  lifecycleStatus: "current" | "retracted";
  version: number;
}

export interface RelationClaimAuditReport {
  generatedAt: string;
  totalRelationClaims: number;
  linkedCount: number;
  repairableCount: number;
  manualReviewCount: number;
  items: Array<{
    reviewJobId: string;
    claimId: string;
    sourceEntityId?: string | null;
    predicate?: string | null;
    targetReference?: string | null;
    proposedTargetEntityId?: string | null;
    relationId?: string | null;
    relationKind?: string | null;
    status: "repairable" | "linked" | "review-required" | "invalid";
    reason: string;
  }>;
}

export interface RelationClaimRepairReport {
  generatedAt: string;
  mode: "dry-run" | "apply";
  total: number;
  repairableCount: number;
  repairedCount: number;
  items: Array<{
    reviewJobId: string;
    claimId: string;
    relationId?: string | null;
    status: "repairable" | "repaired" | "skipped";
    reason: string;
  }>;
}

export interface ReviewQueueItem {
  id: string;
  entityId?: string;
  claim: {
    id: string;
    text: { zh: string; en: string };
    confidence: string;
    subject?: string;
    predicate?: string;
    objectOrValue?: string;
    sourceIds?: string[];
    validFrom?: string;
    validTo?: string;
  };
  evidenceIds: string[];
  evidenceItems: Evidence[];
  conflictClaimIds: string[];
  status: "pending" | "approved" | "rejected" | "needs-more-evidence";
  createdAt: string;
  reviewedAt?: string;
  version: number;
  reviewReason?: string;
  reviewMethod?: "human" | "automation";
  lifecycleStatus?: "current" | "superseded" | "historical" | "retracted";
  publicationAction?: "new" | "merged-evidence" | "superseding";
  targetClaimId?: string;
  supersededByClaimId?: string;
}

export interface ReviewInventoryReport {
  generatedAt: string;
  openTotal: number;
  byEntity: Record<string, number>;
  bySource: Record<string, number>;
  byMonth: Record<string, number>;
  riskCounts: Record<string, number>;
  deterministicDuplicateGroups: number;
  possibleUpdateGroups: number;
  conflictItems: number;
  missingEvidenceItems: number;
  invalidAnchorItems: number;
  staleItems: number;
  duplicateWithPublishedItems: number;
}

export interface SourceView {
  id: string;
  title: string;
  publisher: string;
  url: string;
  fetchUrl?: string;
  effectiveFetchUrl: string;
  fallbackUrls: string[];
  lastSuccessfulFetchUrl?: string;
  active: boolean;
  fetchEnabled: boolean;
  fetchIntervalMinutes: number;
  nextFetchAt?: string;
  lastSeenAt?: string;
  consecutiveFailures: number;
  lastFetchError?: string;
  failureKind?:
    | "network"
    | "timeout"
    | "rate-limited"
    | "upstream"
    | "blocked"
    | "redirect"
    | "allowlist"
    | "content"
    | "unknown";
  autoPausedAt?: string;
  healthState: "healthy" | "retrying" | "paused" | "manual" | "unverified";
  fetchLeaseExpiresAt?: string;
  lastProbeAt?: string;
  lastProbeStatus?: "passed" | "failed";
  lastProbeError?: string;
  lastProbeContentType?: string;
  lastProbeReadableCharacters?: number;
  collectionStrategy: "automatic" | "manual" | "unverified";
  collectionReason: string;
}

export interface SourceProbeResult {
  sourceId: string;
  url: string;
  contentType: string;
  readableCharacters: number;
  etag?: string;
  lastModified?: string;
}

export interface IngestionRun {
  id: string;
  sourceId: string;
  status: string;
  changeType: string;
  startedAt: string;
  finishedAt: string;
  snapshotId?: string;
  error?: string;
}

export interface DocumentSnapshotView {
  id: string;
  sourceId: string;
  contentHash: string;
  contentPreview: string;
  readableCharacters: number;
  observedAt: string;
  publishedAt?: string;
  previousSnapshotId?: string;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
}

export interface OutboxEntry {
  id: string;
  toEmail: string;
  subject: string;
  status: "queued" | "retrying" | "sending" | "sent" | "failed";
  createdAt: string;
  sentAt?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  deliveryLeaseExpiresAt?: string;
  error?: string;
}

export interface AutomationRun {
  id: string;
  workerId: string;
  trigger: "scheduled" | "manual";
  status: "running" | "succeeded" | "partial" | "failed";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface OperationsDiagnostics {
  generatedAt: string;
  heartbeatStatus: "healthy" | "stale" | "missing";
  staleAfterSeconds: number;
  worker?: {
    workerId: string;
    state: "starting" | "running" | "idle" | "failed" | "stopped";
    startedAt: string;
    heartbeatAt: string;
    heartbeatAgeSeconds: number;
    nextCycleAt?: string;
    lastCycleId?: string;
    lastCycleStartedAt?: string;
    lastCycleFinishedAt?: string;
    lastCycleStatus?: "running" | "succeeded" | "partial" | "failed";
    consecutiveFailures: number;
    lastError?: string;
  };
  recentRuns: AutomationRun[];
  queues: {
    automaticSources: number;
    sourcesDue: number;
    sourcesRetrying: number;
    sourcesPaused: number;
    extractionReady: number;
    extractionRetrying: number;
    emailQueued: number;
    emailRetrying: number;
    emailSending: number;
    emailFailed: number;
  };
}

export interface DataQualityReport {
  evaluationScope: "overview" | "full";
  entityCount: number;
  claimCount: number;
  evidenceCount: number;
  relationCount: number;
  timelineEntryCount: number;
  officialEvidenceCount: number;
  reviewedEvidenceCount: number;
  freshEvidenceCount: number;
  evidenceDomainCount: number;
  verifiedContentCount: number;
  conflictContentCount: number;
  evidenceReferenceCoverage: number;
  officialEvidenceRatio: number;
  reviewedEvidenceRatio: number;
  freshEvidenceRatio: number;
  verifiedContentRatio: number;
  claimsRequired: number;
  claimsRemaining: number;
  coreEntitiesBelowFiveRelations: string[];
  coreEntityRelationCounts: Record<string, number>;
  coreEntityRelationLabels: Record<string, { zh: string; en: string }>;
  coreRelationDeficit: number;
  goldenQuestions?: GoldenQuestionReport;
  claimsWithMissingEvidence: string[];
  claimsWithMissingEntity: string[];
  claimsWithMissingFactDate: string[];
  relationsWithMissingEvidence: string[];
  timelineEntriesWithMissingEvidence: string[];
  liveReady: boolean;
  issues: string[];
}

export interface GoldenQuestionReport {
  total: number;
  passed: number;
  failed: number;
  passRatio: number;
  requiredRatio: number;
  ready: boolean;
  results: Array<{
    id: string;
    question: string;
    passed: boolean;
    matchedEntityIds: string[];
    missingEntityIds: string[];
    reason: string;
  }>;
}

export interface IntegrationStatus {
  extractionConfigured: boolean;
  extractionPipelineVersion: string;
  extractionEndpointHost?: string;
  extractionModel?: string;
  automaticExtractionEnabled: boolean;
  automaticExtractionMaxSnapshotsPerCycle: number;
  automaticExtractionMaxCandidatesPerSnapshot: number;
  automaticExtractionRetryMinutes: number;
  automaticRelationApprovalEnabled: boolean;
  smtpConfigured: boolean;
  smtpHost?: string;
  smtpFrom?: string;
  fetchAllowedHosts: string[];
  registeredSources: number;
  automaticSources: number;
  digestTimezone: string;
}

export interface ExtractionProbeResult {
  configured: boolean;
  passed: boolean;
  checkedAt: string;
  latencyMs: number;
  endpointHost?: string;
  model?: string;
  errorCode?: string;
  detail: string;
}

export interface ExtractionPlanItem {
  sourceId: string;
  sourceTitle: string;
  snapshotId: string;
  observedAt: string;
  readableCharacters: number;
}

export interface ProductionReadinessCheck {
  code: string;
  title: string;
  status: "ready" | "blocked" | "warning" | "manual";
  detail: string;
  action?: string;
}

export interface ProductionReadiness {
  generatedAt: string;
  automatedReady: boolean;
  blockingCount: number;
  warningCount: number;
  checks: ProductionReadinessCheck[];
  manualChecks: ProductionReadinessCheck[];
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
  timeoutMs = 30_000,
): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }
  const response = await fetchWithNetworkRetry(
    `${apiBaseUrl}${path}`,
    {
      ...options,
      cache: options.cache ?? (token ? "no-store" : undefined),
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    },
    { timeoutMs },
  );
  if (!response.ok) {
    if (response.status === 401 && token) {
      expireAuthSession();
      throw new Error("登录已过期，请重新登录。");
    }
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(`${path}：${detail?.detail || `请求失败（${response.status}）`}`);
  }
  return (await response.json()) as T;
}

export const adminApi = {
  configured: Boolean(apiBaseUrl),

  async login(email: string, password: string) {
    return request<{
      accessToken: string;
      user: AdminUser;
    }>(
      "/api/v2/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
      undefined,
      90_000,
    );
  },

  me: (token: string) => request<AdminUser>("/api/v2/auth/me", {}, token),

  operations: (token: string) =>
    request<OperationsDiagnostics>("/api/v2/admin/operations", {}, token),

  productionReadiness: (token: string) =>
    request<ProductionReadiness>("/api/v2/admin/production-readiness", {}, token),

  claimEntityRepair: (token: string, mode: "dry-run" | "apply", claimIds: string[] = []) =>
    request<ClaimEntityRepairReport>(
      "/api/v2/admin/claim-entity-repair",
      {
        method: "POST",
        body: JSON.stringify({ mode, claimIds }),
      },
      token,
    ),

  claimEntityResolution: (
    token: string,
    payload: {
      claimId: string;
      action: "assign" | "retract";
      entityId?: string;
      expectedVersion: number;
      reason: string;
    },
  ) =>
    request<ClaimEntityResolutionResult>(
      "/api/v2/admin/claim-entity-resolution",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    ),

  relationClaimRepair: (token: string, mode: "dry-run" | "apply", claimIds: string[] = []) =>
    request<RelationClaimRepairReport>(
      "/api/v2/admin/relation-claim-repair",
      {
        method: "POST",
        body: JSON.stringify({ mode, claimIds }),
      },
      token,
    ),

  async workspace(token: string, role: AdminUser["role"]) {
    const [
      openQueueResult,
      historyQueueResult,
      inventoryResult,
      healthResult,
      entityAuditResult,
      relationAuditResult,
      entitiesResult,
    ] = await Promise.all([
      settle(
        "开放审核队列",
        request<ReviewQueueItem[]>("/api/v2/admin/review-queue?scope=open&limit=500", {}, token),
        [],
      ),
      settle(
        "最近审核历史",
        request<ReviewQueueItem[]>("/api/v2/admin/review-queue?scope=history&limit=100", {}, token),
        [],
      ),
      settle(
        "审核盘点",
        request<ReviewInventoryReport>("/api/v2/admin/review-queue-inventory", {}, token),
        null,
      ),
      settle("构建信息", request<HealthStatus>("/health", {}, token), null),
      settle(
        "Claim 实体审计",
        request<ClaimEntityAuditReport>("/api/v2/admin/claim-entity-audit", {}, token),
        null,
      ),
      settle(
        "历史关系审计",
        request<RelationClaimAuditReport>("/api/v2/admin/relation-claim-audit", {}, token),
        null,
      ),
      settle("实体目录", request<Entity[]>("/api/v2/entities", {}, token), []),
    ]);
    const queueResult = {
      value: [...openQueueResult.value, ...historyQueueResult.value],
      warning: [openQueueResult.warning, historyQueueResult.warning].filter(Boolean).join("；"),
    };
    if (role !== "admin") {
      return {
        queue: queueResult.value,
        entities: entitiesResult.value,
        extractionPlan: [],
        sources: [],
        runs: [],
        audit: [],
        outbox: [],
        quality: null,
        integrations: null,
        operations: null,
        productionReadiness: null,
        reviewInventory: inventoryResult.value,
        build: healthResult.value,
        claimEntityAudit: entityAuditResult.value,
        relationClaimAudit: relationAuditResult.value,
        loadWarnings: [
          queueResult.warning,
          inventoryResult.warning,
          healthResult.warning,
          entityAuditResult.warning,
          relationAuditResult.warning,
          entitiesResult.warning,
        ].filter(Boolean) as string[],
      };
    }
    const [extractionPlan, sources, runs, audit, outbox, quality, integrations, operations] =
      await Promise.all([
        settle(
          "批量抽取计划",
          request<ExtractionPlanItem[]>("/api/v2/admin/extraction-plan?limit=30", {}, token),
          [],
        ),
        settle("信源", request<SourceView[]>("/api/v2/admin/sources", {}, token), []),
        settle("采集记录", request<IngestionRun[]>("/api/v2/admin/ingestion-runs", {}, token), []),
        settle("审计日志", request<AuditEntry[]>("/api/v2/admin/audit-log", {}, token), []),
        settle("邮件 Outbox", request<OutboxEntry[]>("/api/v2/admin/email-outbox", {}, token), []),
        settle(
          "数据质量",
          request<DataQualityReport>("/api/v2/admin/data-quality", {}, token),
          null,
        ),
        settle(
          "外部集成",
          request<IntegrationStatus>("/api/v2/admin/integrations", {}, token),
          null,
        ),
        settle(
          "运行诊断",
          request<OperationsDiagnostics>("/api/v2/admin/operations", {}, token),
          null,
        ),
      ]);
    const sections = [
      queueResult,
      extractionPlan,
      sources,
      runs,
      audit,
      outbox,
      quality,
      integrations,
      operations,
      inventoryResult,
      healthResult,
      entityAuditResult,
      relationAuditResult,
      entitiesResult,
    ];
    return {
      queue: queueResult.value,
      entities: entitiesResult.value,
      extractionPlan: extractionPlan.value,
      sources: sources.value,
      runs: runs.value,
      audit: audit.value,
      outbox: outbox.value,
      quality: quality.value,
      integrations: integrations.value,
      operations: operations.value,
      productionReadiness: null,
      reviewInventory: inventoryResult.value,
      build: healthResult.value,
      claimEntityAudit: entityAuditResult.value,
      relationClaimAudit: relationAuditResult.value,
      loadWarnings: sections.flatMap((section) => (section.warning ? [section.warning] : [])),
    };
  },

  decide: (
    token: string,
    id: string,
    action: "approve" | "reject",
    expectedVersion: number,
    reason: string,
  ) =>
    request<ReviewQueueItem>(
      `/api/v2/admin/review-queue/${encodeURIComponent(id)}/${action}`,
      {
        method: "POST",
        body: JSON.stringify({ expectedVersion, reason }),
      },
      token,
    ),

  decideLifecycle: (
    token: string,
    id: string,
    action: "merged-evidence" | "superseding",
    target: ReviewQueueItem,
    expectedVersion: number,
    idempotencyKey: string,
    reason: string,
  ) =>
    request<ReviewQueueItem>(
      `/api/v2/admin/review-queue/${encodeURIComponent(id)}/${
        action === "merged-evidence" ? "merge-evidence" : "approve-superseding"
      }`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedVersion,
          targetClaimId: target.claim.id,
          expectedTargetVersion: target.version,
          idempotencyKey,
          reason,
        }),
      },
      token,
    ),

  batchApprove: (
    token: string,
    items: Array<{ id: string; expectedVersion: number; reason: string }>,
  ) =>
    request<ReviewQueueItem[]>(
      "/api/v2/admin/review-queue/batch-approve",
      {
        method: "POST",
        body: JSON.stringify({ items }),
      },
      token,
    ),

  batchMergeDuplicates: (token: string, limit = 50) =>
    request<ReviewQueueItem[]>(
      `/api/v2/admin/review-queue/batch-merge-duplicates?limit=${limit}`,
      { method: "POST" },
      token,
    ),

  batchRejectInvalid: (token: string, limit = 50) =>
    request<ReviewQueueItem[]>(
      `/api/v2/admin/review-queue/batch-reject-invalid?limit=${limit}`,
      { method: "POST" },
      token,
    ),

  batchVerifyAutomation: (
    token: string,
    items: Array<{ id: string; expectedVersion: number; reason: string }>,
  ) =>
    request<ReviewQueueItem[]>(
      "/api/v2/admin/review-queue/batch-verify-automation",
      {
        method: "POST",
        body: JSON.stringify({ items }),
      },
      token,
    ),

  runIngestion: (token: string) =>
    request<{ due: number; succeeded: number; unchanged: number; failed: number }>(
      "/api/v2/admin/ingestion/run",
      { method: "POST" },
      token,
    ),

  updateSource: (
    token: string,
    id: string,
    changes: Partial<
      Pick<SourceView, "active" | "fetchEnabled" | "fetchIntervalMinutes" | "fallbackUrls">
    > & { fetchUrl?: string | null },
  ) =>
    request<SourceView>(
      `/api/v2/admin/sources/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(changes) },
      token,
    ),

  retrySource: (token: string, id: string, expectedFailureCount: number) =>
    request<SourceView>(
      `/api/v2/admin/sources/${encodeURIComponent(id)}/retry`,
      { method: "POST", body: JSON.stringify({ expectedFailureCount }) },
      token,
    ),

  probeSource: (token: string, id: string) =>
    request<SourceProbeResult>(
      `/api/v2/admin/sources/${encodeURIComponent(id)}/probe`,
      { method: "POST" },
      token,
    ),

  probeExtraction: (token: string) =>
    request<ExtractionProbeResult>(
      "/api/v2/admin/integrations/extraction/probe",
      { method: "POST" },
      token,
    ),

  collectSource: (token: string, id: string) =>
    request<{ due: number; succeeded: number; unchanged: number; failed: number }>(
      `/api/v2/admin/sources/${encodeURIComponent(id)}/collect`,
      { method: "POST" },
      token,
    ),

  sourceSnapshots: (token: string, id: string) =>
    request<DocumentSnapshotView[]>(
      `/api/v2/admin/sources/${encodeURIComponent(id)}/snapshots?limit=5`,
      {},
      token,
    ),

  createSource: (
    token: string,
    source: Pick<SourceView, "id" | "title" | "publisher" | "url"> & {
      fetchUrl?: string;
      fallbackUrls?: string[];
    },
  ) =>
    request<SourceView>(
      "/api/v2/admin/sources",
      { method: "POST", body: JSON.stringify(source) },
      token,
    ),

  extractSource: (token: string, id: string, maxCandidates = 10, snapshotId?: string) =>
    request<ReviewQueueItem[]>(
      `/api/v2/admin/sources/${encodeURIComponent(id)}/extract`,
      { method: "POST", body: JSON.stringify({ maxCandidates, snapshotId }) },
      token,
    ),

  submitCandidate: (token: string, candidate: CandidateCreateRequest) =>
    request<ReviewQueueItem>(
      "/api/v2/admin/review-candidates",
      { method: "POST", body: JSON.stringify(candidate) },
      token,
    ),

  runDigest: (token: string) =>
    request<{ recipients: number; messagesQueued: number }>(
      "/api/v2/admin/digests/run",
      { method: "POST" },
      token,
    ),

  sendOutbox: (token: string) =>
    request<{ attempted: number; sent: number; failed: number }>(
      "/api/v2/admin/email-outbox/send",
      { method: "POST" },
      token,
    ),

  retryOutbox: (token: string, id: string, expectedAttemptCount: number) =>
    request<OutboxEntry>(
      `/api/v2/admin/email-outbox/${encodeURIComponent(id)}/retry`,
      { method: "POST", body: JSON.stringify({ expectedAttemptCount }) },
      token,
    ),

  upsertEntity: (token: string, entity: Entity) =>
    request<Entity>(
      "/api/v2/admin/entities",
      { method: "POST", body: JSON.stringify(entity) },
      token,
    ),

  upsertRelation: (token: string, relation: GraphEdge) =>
    request<GraphEdge>(
      "/api/v2/admin/relations",
      { method: "POST", body: JSON.stringify(relation) },
      token,
    ),

  upsertTimeline: (token: string, entityId: string, entry: TimelineEntry) =>
    request<TimelineEntry>(
      `/api/v2/admin/entities/${encodeURIComponent(entityId)}/timeline`,
      { method: "POST", body: JSON.stringify(entry) },
      token,
    ),
};

async function settle<T>(label: string, promise: Promise<T>, fallback: T) {
  try {
    return { value: await promise, warning: null as string | null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    return { value: fallback, warning: `${label}加载失败：${detail}` };
  }
}
