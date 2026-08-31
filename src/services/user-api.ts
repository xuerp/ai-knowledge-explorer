import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, "") ?? "";

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
  publishedSlug?: string;
  createdAt: string;
  publishedAt?: string;
}

export interface PublishedResearch extends ResearchResult {
  citations: Array<{
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
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Request failed (${response.status}).`);
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
  research: (token: string, question: string, language: "zh" | "en") =>
    request<ResearchResult>(
      "/api/v2/research",
      { method: "POST", body: JSON.stringify({ question, language }) },
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
