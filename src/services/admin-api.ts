import type { Entity, GraphEdge, TimelineEntry } from "@/domain/types";
import type { CandidateCreateRequest } from "@/domain/manual-candidate";
import { expireAuthSession } from "@/services/auth-session";
import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, "") ?? "";

export interface AdminUser {
  email: string;
  role: "viewer" | "reviewer" | "admin";
}

export interface ReviewQueueItem {
  id: string;
  entityId?: string;
  claim: {
    id: string;
    text: { zh: string; en: string };
    confidence: string;
  };
  evidenceIds: string[];
  conflictClaimIds: string[];
  status: "pending" | "approved" | "rejected" | "needs-more-evidence";
  createdAt: string;
  reviewedAt?: string;
  version: number;
  reviewReason?: string;
}

export interface SourceView {
  id: string;
  title: string;
  publisher: string;
  url: string;
  active: boolean;
  fetchEnabled: boolean;
  fetchIntervalMinutes: number;
  nextFetchAt?: string;
  lastSeenAt?: string;
  consecutiveFailures: number;
  lastFetchError?: string;
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
    emailQueued: number;
    emailRetrying: number;
    emailSending: number;
    emailFailed: number;
  };
}

export interface DataQualityReport {
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
  goldenQuestions?: GoldenQuestionReport;
  claimsWithMissingEvidence: string[];
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
  extractionEndpointHost?: string;
  extractionModel?: string;
  automaticExtractionEnabled: boolean;
  automaticExtractionMaxSnapshotsPerCycle: number;
  automaticExtractionMaxCandidatesPerSnapshot: number;
  automaticExtractionRetryMinutes: number;
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

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }
  const response = await fetchWithNetworkRetry(`${apiBaseUrl}${path}`, {
    ...options,
    cache: options.cache ?? (token ? "no-store" : undefined),
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
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
    }>("/api/v2/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  me: (token: string) => request<AdminUser>("/api/v2/auth/me", {}, token),

  operations: (token: string) =>
    request<OperationsDiagnostics>("/api/v2/admin/operations", {}, token),

  productionReadiness: (token: string) =>
    request<ProductionReadiness>("/api/v2/admin/production-readiness", {}, token),

  async workspace(token: string, role: AdminUser["role"]) {
    const queueResult = await settle(
      "审核队列",
      request<ReviewQueueItem[]>("/api/v2/admin/review-queue", {}, token),
      [],
    );
    if (role !== "admin") {
      return {
        queue: queueResult.value,
        extractionPlan: [],
        sources: [],
        runs: [],
        audit: [],
        outbox: [],
        quality: null,
        integrations: null,
        operations: null,
        productionReadiness: null,
        loadWarnings: queueResult.warning ? [queueResult.warning] : [],
      };
    }
    const [
      extractionPlan,
      sources,
      runs,
      audit,
      outbox,
      quality,
      integrations,
      operations,
      productionReadiness,
    ] = await Promise.all([
      settle(
        "批量抽取计划",
        request<ExtractionPlanItem[]>("/api/v2/admin/extraction-plan?limit=30", {}, token),
        [],
      ),
      settle("信源", request<SourceView[]>("/api/v2/admin/sources", {}, token), []),
      settle("采集记录", request<IngestionRun[]>("/api/v2/admin/ingestion-runs", {}, token), []),
      settle("审计日志", request<AuditEntry[]>("/api/v2/admin/audit-log", {}, token), []),
      settle("邮件 Outbox", request<OutboxEntry[]>("/api/v2/admin/email-outbox", {}, token), []),
      settle("数据质量", request<DataQualityReport>("/api/v2/admin/data-quality", {}, token), null),
      settle("外部集成", request<IntegrationStatus>("/api/v2/admin/integrations", {}, token), null),
      settle(
        "运行诊断",
        request<OperationsDiagnostics>("/api/v2/admin/operations", {}, token),
        null,
      ),
      settle(
        "生产预检",
        request<ProductionReadiness>("/api/v2/admin/production-readiness", {}, token),
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
      productionReadiness,
    ];
    return {
      queue: queueResult.value,
      extractionPlan: extractionPlan.value,
      sources: sources.value,
      runs: runs.value,
      audit: audit.value,
      outbox: outbox.value,
      quality: quality.value,
      integrations: integrations.value,
      operations: operations.value,
      productionReadiness: productionReadiness.value,
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

  runIngestion: (token: string) =>
    request<{ due: number; succeeded: number; unchanged: number; failed: number }>(
      "/api/v2/admin/ingestion/run",
      { method: "POST" },
      token,
    ),

  updateSource: (
    token: string,
    id: string,
    changes: Partial<Pick<SourceView, "active" | "fetchEnabled" | "fetchIntervalMinutes">>,
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

  createSource: (token: string, source: Pick<SourceView, "id" | "title" | "publisher" | "url">) =>
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
