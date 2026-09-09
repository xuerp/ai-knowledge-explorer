import { expireAuthSession } from "@/services/auth-session";
import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";

const apiBaseUrl =
  (import.meta.env.SSR ? import.meta.env.VITE_API_UPSTREAM_URL : import.meta.env.VITE_API_BASE_URL)
    ?.trim()
    ?.replace(/\/$/, "") ?? "";

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
  task: string;
  priority: "quality" | "cost" | "speed" | "privacy" | "control" | "balanced";
  budget: {
    mode: "cost-first" | "range" | "unknown";
    min?: number;
    max?: number;
    currency?: string;
  };
  deployment: "cloud-api" | "private" | "on-device" | "hybrid" | "undecided";
  exclusions: string[];
  candidateEntityIds: string[];
  notes?: string;
}

export interface DecisionResult {
  status: "ready" | "insufficient-evidence" | "conflict" | "failed";
  asOf: string;
  recommendation: {
    primaryEntityId?: string;
    alternativeEntityIds: string[];
    summary: string;
  };
  conditions: string[];
  tradeoffs: Array<{ dimension: string; finding: string; claimIds: string[] }>;
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

export interface ResearchResult {
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
    claim: {
      id: string;
      text: { zh: string; en: string };
      confidence: string;
    };
    evidence: Array<{
      id: string;
      title: { zh: string; en: string };
      publisher: string;
      url: string;
      publishedAt: string;
    }>;
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

export class AuthSessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in and try again.");
    this.name = "AuthSessionExpiredError";
  }
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
    if (response.status === 401) {
      throw new AuthSessionExpiredError();
    }
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
  configured: Boolean(apiBaseUrl),
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: SessionUser }>("/api/v2/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
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
  publishResearch: (token: string, id: string) =>
    request<ResearchResult>(
      `/api/v2/research/${encodeURIComponent(id)}/publish`,
      { method: "POST" },
      token,
    ),
  publicResearch: (slug: string) =>
    request<PublishedResearch>(`/api/v2/share/${encodeURIComponent(slug)}`),
};
