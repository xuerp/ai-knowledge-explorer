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
  nextFetchAt?: string;
  lastSeenAt?: string;
}

export interface IngestionRun {
  id: string;
  sourceId: string;
  status: string;
  changeType: string;
  startedAt: string;
  error?: string;
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
  status: string;
  createdAt: string;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(detail?.detail || `Request failed (${response.status}).`);
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

  async workspace(token: string, role: AdminUser["role"]) {
    const queue = await request<ReviewQueueItem[]>("/api/v2/admin/review-queue", {}, token);
    if (role !== "admin") {
      return { queue, sources: [], runs: [], audit: [], outbox: [] };
    }
    const [sources, runs, audit, outbox] = await Promise.all([
      request<SourceView[]>("/api/v2/admin/sources", {}, token),
      request<IngestionRun[]>("/api/v2/admin/ingestion-runs", {}, token),
      request<AuditEntry[]>("/api/v2/admin/audit-log", {}, token),
      request<OutboxEntry[]>("/api/v2/admin/email-outbox", {}, token),
    ]);
    return { queue, sources, runs, audit, outbox };
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
};
