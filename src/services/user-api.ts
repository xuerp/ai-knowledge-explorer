import { expireAuthSession } from "@/services/auth-session";
import { authResponseError, AuthSessionExpiredError } from "@/services/auth-errors";
import { fetchReportBlob } from "@/services/report-export";
export { AuthSessionExpiredError } from "@/services/auth-errors";
import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";
import type { EntryRequestPayload, EntryRequestReceipt } from "./entry-request-types";
import type { Claim, Evidence } from "@/domain/types";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, "") ?? "";
const apiBaseUrl = import.meta.env.SSR
  ? (import.meta.env.VITE_API_UPSTREAM_URL?.trim()?.replace(/\/$/, "") ?? configuredApiBaseUrl)
  : configuredApiBaseUrl;

export interface SessionUser {
  id: string;
  email: string;
  role: "viewer" | "reviewer" | "admin";
  dailyDigestEnabled: boolean;
  digestHour: string;
}

export interface FollowItem {
  id: string;
  entityId: string;
  intensity: "silent" | "digest" | "instant";
  createdAt: string;
}

export interface UserNotification {
  id: string;
  entityId: string;
  changeId: string;
  title: string;
  priority: "normal" | "important";
  createdAt: string;
  readAt?: string;
}

export interface DecisionContext {
  workflowVersion?: 1 | 2;
  minimumContextTokens?: number;
  inputModalities?: Array<"text" | "image" | "audio" | "video">;
  commercialUseRequired?: boolean;
  serviceAccess?: { channel: string; tier: "paid" | "free" | "unknown"; region?: string };
  task: string;
  taskType?: "model-api" | "coding-product" | "agent-development" | "unspecified";
  region?: string;
  priority: "quality" | "cost" | "speed" | "privacy" | "control" | "balanced";
  budget: {
    mode: "cost-first" | "range" | "unknown";
    costScope?: "all-costs" | "standard-token-only";
    maximumInputTokensPerRequest?: number;
    min?: number;
    max?: number;
    currency?: string;
    period?: "month" | "per-million-tokens";
    monthlyInputTokens?: number;
    monthlyOutputTokens?: number;
    channel?: string;
  };
  deployment: "cloud-api" | "private" | "on-device" | "hybrid" | "undecided";
  exclusions: string[];
  candidateEntityIds: string[];
  notes?: string;
}

export interface DecisionResult {
  plan?: {
    state:
      | "needs-input"
      | "needs-evidence"
      | "conflict"
      | "all-excluded"
      | "no-candidates"
      | "ready-to-validate"
      | "failed";
    canDecide: string;
    trialCandidateIds: string[];
    actions: Array<{
      id: string;
      kind: "clarify" | "reconcile" | "source" | "test" | "change-scope";
      title: string;
      instruction: string;
      unlocks: string;
      candidateIds: string[];
      dimensions: string[];
      claimIds: string[];
    }>;
    trial?: {
      sample: string;
      procedure: string[];
      metrics: string[];
      acceptance: string[];
      executed: false;
    } | null;
  } | null;
  scenario?: {
    id: string;
    name: string;
    requiredFeatures: string[];
    clarificationChecks: string[];
  };
  scope?: {
    consideredEntityIds: string[];
    omittedEntityIds: string[];
    selectionBasis: string;
    explicit: boolean;
  };
  workflowState?:
    "ready" | "needs-input" | "insufficient-evidence" | "conflict" | "no-eligible-candidate";
  missingInputs?: string[];
  candidates?: Array<{
    entityId: string;
    eligibility: "eligible" | "excluded" | "unknown" | "conflict";
    reasons: string[];
    claimIds: string[];
    coveredDimensions: string[];
    requiredDimensions: string[];
    isConcreteVersion: boolean;
    strengths?: Array<{ dimension: string; finding: string; claimIds: string[] }>;
    gaps?: Array<{
      dimension: string;
      reason:
        | "not-recorded"
        | "not-structured"
        | "not-current"
        | "needs-input"
        | "conflicting"
        | "requires-poc";
      detail: string;
      claimIds: string[];
    }>;
    fitState?: "described" | "unverified";
  }>;
  status: "ready" | "insufficient-evidence" | "conflict" | "failed";
  asOf: string;
  recommendation: {
    primaryEntityId?: string;
    alternativeEntityIds: string[];
    summary: string;
    basis?: "sole-eligible" | "comparable-cost" | "validation-sequence" | "comparison-only";
    reasons?: Array<{ dimension: string; finding: string; claimIds: string[] }>;
    validationEntityIds?: string[];
  };
  conditions: string[];
  tradeoffs: Array<{ dimension: string; finding: string; claimIds: string[] }>;
  comparisons?: Array<{
    id: string;
    dimension: string;
    cells: Array<{
      entityId: string;
      state: "supported" | "unknown";
      facts: Array<{ dimension: string; finding: string; claimIds: string[] }>;
    }>;
  }>;
  risks: Array<{
    state: "verified" | "inferred" | "unknown" | "conflict";
    detail: string;
    claimIds: string[];
  }>;
  nextChecks: string[];
  claimIds: string[];
}

export interface ResearchRequest {
  question: string;
  language: "zh" | "en";
  decisionContext?: DecisionContext;
}

export interface DecisionEvidenceRequest {
  id: string;
  candidateId: string;
  dimensions: string[];
  sourceUrl: string;
  status: "pending" | "in-review" | "resolved" | "rejected";
  createdAt: string;
  verificationState: "awaiting-evidence" | "evidence-ready" | "candidate-unavailable";
  remainingDimensions: string[];
  verifiedDimensions: string[];
  currentEligibility: "eligible" | "unknown" | "excluded" | "conflict" | null;
  checkedAt: string;
}

export interface DecisionValidationItem {
  measurements?: {
    successfulSamples?: number | null;
    minimumSuccessfulSamples?: number | null;
    totalCost?: number | null;
    currency?: string | null;
    costBasis?: "actual-charge" | "estimate" | null;
    sourceNote?: string;
    p50Ms?: number | null;
    p95Ms?: number | null;
    privacyVerified?: boolean | null;
    controlVerified?: boolean | null;
  };
  suggestedProtocol?: {
    sample: string;
    procedure: string[];
    metrics: string[];
    acceptance: string[];
    executed: false;
  };
  testConditions?: {
    modelVersion: string;
    configuration: string;
    sampleCount?: number | null;
    testedAt: string;
    scope: string;
  };
  id: string;
  title: string;
  candidateId?: string | null;
  status: "pending" | "passed" | "failed" | "blocked";
  result: string;
}

export interface DecisionValidationReview {
  sourceRevision: number;
  basis: "user-records";
  conclusion?: {
    measuredChoices?: Array<{
      minimumSuccessfulSamples?: number;
      priority: "quality" | "cost" | "speed";
      candidateIds: string[];
      itemIds: string[];
      metric: "successful-samples" | "total-cost" | "p95-ms";
      unit: string;
      values: Record<string, number>;
      configuration: string;
      scope: string;
      sampleCount: number;
      testDate: string;
      basis: "user-declared-actual-measurements";
    }>;
    status:
      | "limited-fit"
      | "no-tested-fit"
      | "validation-blocked"
      | "insufficient-tests"
      | "priority-unverified";
    trialCandidateIds: string[];
    findings: Array<{
      candidateId: string;
      outcome:
        | "limited-fit"
        | "tested-fail"
        | "testing-blocked"
        | "record-incomplete"
        | "unverified"
        | "entry-unverified"
        | "eligibility-unverified";
      itemIds: string[];
      scope: string;
      modelVersion: string;
    }>;
  };
  candidates: Array<{
    candidateId: string | null;
    recordedChecks: number;
    completedChecks: number;
    requiredChecks: number;
    checks: Array<{
      dimension: "quality" | "latency" | "cost" | "terms";
      itemIds: string[];
      complete: boolean;
      reason: "missing" | "pending" | "blocked" | "conditions-missing" | "ambiguous" | "complete";
      missingConditions: string[];
    }>;
  }>;
  comparableGroups: Array<{
    measurementUnit?: string;
    minimumSuccessfulSamples?: number;
    costBasis?: "actual-charge" | "estimate";
    dimension: "quality" | "latency" | "cost" | "terms";
    candidateIds: string[];
    itemIds: string[];
    configuration: string;
    scope: string;
    sampleCount: number;
    testDate: string;
  }>;
}

export interface DecisionValidation {
  researchId: string;
  revision: number;
  items: DecisionValidationItem[];
  updatedAt?: string;
  review?: DecisionValidationReview | null;
}

export interface ResearchResult {
  citationStates?: Record<string, "current" | "updated" | "unavailable">;
  id: string;
  question: string;
  summary: string;
  claimIds: string[];
  steps: Array<{
    id: string;
    label: { zh: string; en: string };
    status: "pending" | "running" | "complete" | "failed" | "cancelled";
    detail?: { zh: string; en: string };
  }>;
  status: "ready" | "insufficient-evidence" | "failed" | "cancelled";
  citations?: Array<{
    claim: Claim;
    evidence: Evidence[];
  }>;
  retrievalMode: "lexical" | "hybrid";
  answerMode: "extractive" | "generated";
  retrievalDiagnostics: {
    candidateCount: number;
    returnedCount: number;
    filteredCount: number;
    elapsedMs: number;
    matchedEntityIds: string[];
    fallbackReason?: string;
    generationFallbackReason?: string;
  };
  decisionContext?: DecisionContext;
  decision?: DecisionResult;
  publishedSlug?: string;
  createdAt: string;
  publishedAt?: string;
}

export interface PublishedResearch extends ResearchResult {
  citations: NonNullable<ResearchResult["citations"]>;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!apiBaseUrl) throw new Error("VITE_API_BASE_URL is not configured.");
  const response = await fetchWithNetworkRetry(`${apiBaseUrl}${path}`, {
    ...options,
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
    }
    const body = (await response.json().catch(() => null)) as {
      detail?: string | Array<{ loc?: Array<string | number>; msg?: string }>;
    } | null;
    const detail = Array.isArray(body?.detail)
      ? body.detail
          .map((item) => `${item.loc?.slice(1).join(".") || "input"}: ${item.msg || "invalid"}`)
          .join("; ")
      : body?.detail;
    const authError = authResponseError(response.status, Boolean(token), path);
    if (authError) throw authError;
    const fallback =
      response.status === 429
        ? "Too many requests. Wait briefly and try again."
        : response.status >= 500
          ? "The research service is temporarily unavailable. Your inputs were preserved; try again."
          : `Request failed (${response.status}).`;
    throw new Error(detail || fallback);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const userApi = {
  reportFile: async (
    id: string,
    format: "pdf" | "md",
    language: "zh" | "en",
    token = "",
    publicSlug?: string,
  ) => {
    const path = publicSlug
      ? `/api/v2/share/${encodeURIComponent(publicSlug)}/report`
      : `/api/v2/research/${encodeURIComponent(id)}/report`;
    try {
      return await fetchReportBlob(
        `${apiBaseUrl}${path}?format=${format}&language=${language}`,
        format,
        token,
      );
    } catch (error) {
      if (error instanceof AuthSessionExpiredError) expireAuthSession();
      throw error;
    }
  },
  configured: Boolean(apiBaseUrl),
  submitEntryRequest: (payload: EntryRequestPayload) =>
    request<EntryRequestReceipt>("/api/v2/entry-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  register: (email: string, password: string) =>
    request<{ accessToken: string; user: SessionUser }>("/api/v2/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string, rememberMe = false) =>
    request<{ accessToken: string; expiresIn: number; user: SessionUser }>("/api/v2/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberMe }),
    }),
  logout: (token: string) => request<void>("/api/v2/auth/logout", { method: "POST" }, token),
  me: (token: string) => request<SessionUser>("/api/v2/auth/me", {}, token),
  following: (token: string) => request<FollowItem[]>("/api/v2/following", {}, token),
  follow: (token: string, entityId: string, intensity: FollowItem["intensity"]) =>
    request<FollowItem>(
      "/api/v2/following",
      { method: "POST", body: JSON.stringify({ entityId, intensity }) },
      token,
    ),
  unfollow: (token: string, id: string) =>
    request<void>(`/api/v2/following/${encodeURIComponent(id)}`, { method: "DELETE" }, token),
  notifications: (token: string) => request<UserNotification[]>("/api/v2/notifications", {}, token),
  markRead: (token: string, id: string) =>
    request<UserNotification>(
      `/api/v2/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST" },
      token,
    ),
  preferences: (token: string, enabled: boolean, hour: string) =>
    request<SessionUser>(
      "/api/v2/notification-preferences",
      { method: "POST", body: JSON.stringify({ enabled, hour }) },
      token,
    ),
  research: (token: string, payload: ResearchRequest) =>
    request<ResearchResult>(
      "/api/v2/research",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  researchDetail: (token: string, id: string) =>
    request<ResearchResult>(`/api/v2/research/${encodeURIComponent(id)}`, {}, token),
  decisionValidation: (token: string, id: string) =>
    request<DecisionValidation>(`/api/v2/research/${encodeURIComponent(id)}/validation`, {}, token),
  decisionEvidenceRequests: (token: string, id: string) =>
    request<DecisionEvidenceRequest[]>(
      `/api/v2/research/${encodeURIComponent(id)}/evidence-requests`,
      {},
      token,
    ),
  requestDecisionEvidence: (token: string, id: string, candidateId: string, requestId: string) =>
    request<DecisionEvidenceRequest>(
      `/api/v2/research/${encodeURIComponent(id)}/evidence-requests`,
      { method: "POST", body: JSON.stringify({ candidateId, requestId }) },
      token,
    ),
  saveDecisionValidation: (
    token: string,
    id: string,
    expectedRevision: number,
    items: DecisionValidationItem[],
  ) =>
    request<DecisionValidation>(
      `/api/v2/research/${encodeURIComponent(id)}/validation`,
      { method: "PUT", body: JSON.stringify({ expectedRevision, items }) },
      token,
    ),
  publishResearch: (token: string, id: string) =>
    request<ResearchResult>(
      `/api/v2/research/${encodeURIComponent(id)}/publish`,
      { method: "POST" },
      token,
    ),
  publicResearch: (slug: string) =>
    request<PublishedResearch>(`/api/v2/share/${encodeURIComponent(slug)}`),
};
