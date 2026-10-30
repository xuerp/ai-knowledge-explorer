import type {
  DataMode,
  Claim,
  Entity,
  EntityType,
  KnowledgeSnapshot,
  TimelineEvent,
} from "@/domain/types";
import type { Source } from "@/domain/types";
import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";
import { snapshotFetchedAtHeader, withSnapshotCopyTime } from "@/lib/edge-copy";
// Offline data is an explicit async boundary; API mode never loads this chunk.
let offlineSnapshot: Promise<KnowledgeSnapshot> | undefined;
function loadOfflineSnapshot() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return Promise.reject(new Error("Offline snapshots are not included in an API build."));
  } else {
    // Vite eliminates this branch, including its data chunk, in API-configured builds.
    return (offlineSnapshot ??= import("@/data/generated/snapshot.json").then(
      (module) => module.default as unknown as KnowledgeSnapshot,
    ));
  }
}

export interface EntityQuery {
  type?: EntityType;
  query?: string;
}

export interface EntityClaimPage {
  total: number;
  items: Claim[];
  evidence: Source[];
  nextCursor?: string;
}

export interface KnowledgeRepository {
  mode: DataMode;
  getSnapshot: (signal?: AbortSignal) => Promise<KnowledgeSnapshot>;
  getEntities: (query?: EntityQuery, signal?: AbortSignal) => Promise<Entity[]>;
  getEntityBySlug: (
    slug: string,
    type?: EntityType,
    signal?: AbortSignal,
  ) => Promise<Entity | null>;
  getEntityTimeline: (entityId: string, signal?: AbortSignal) => Promise<TimelineEvent[]>;
  getModelFamilies: (signal?: AbortSignal) => Promise<Entity[]>;
  getFamilyVersions: (familyId: string, signal?: AbortSignal) => Promise<Entity[]>;
  compareModelVersions: (versionIds: string[], signal?: AbortSignal) => Promise<Entity[]>;
  getEntityClaims: (
    entityId: string,
    scope: "current" | "history" | "all",
    cursor?: string,
    limit?: number,
    signal?: AbortSignal,
    filters?: { q?: string; topic?: string },
  ) => Promise<EntityClaimPage>;
}

function filterDemoEntities(snapshot: KnowledgeSnapshot, query: EntityQuery = {}) {
  const needle = query.query?.trim().toLocaleLowerCase();
  return snapshot.entities.filter((entity) => {
    if (query.type && entity.type !== query.type) return false;
    if (!needle) return true;
    return [entity.name.zh, entity.name.en, entity.slug, ...(entity.aliases ?? [])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle);
  });
}

class DemoKnowledgeRepository implements KnowledgeRepository {
  readonly mode = "demo" as const;

  async getSnapshot() {
    return loadOfflineSnapshot();
  }

  async getEntities(query: EntityQuery = {}) {
    return filterDemoEntities(await this.getSnapshot(), query);
  }

  async getEntityBySlug(slug: string, type?: EntityType) {
    return (
      (await this.getSnapshot()).entities.find(
        (entity) => entity.slug === slug && (!type || entity.type === type),
      ) ?? null
    );
  }

  async getEntityTimeline(entityId: string) {
    return (await this.getSnapshot()).timeline[entityId] ?? [];
  }

  async getModelFamilies() {
    return (await this.getSnapshot()).entities.filter(
      (entity) => entity.type === "model" && !entity.familyId,
    );
  }

  async getFamilyVersions(familyId: string) {
    return (await this.getSnapshot()).entities
      .filter((entity) => entity.familyId === familyId)
      .sort((a, b) =>
        (a.release?.releasedAt ?? a.firstReleasedAt ?? "").localeCompare(
          b.release?.releasedAt ?? b.firstReleasedAt ?? "",
        ),
      );
  }

  async compareModelVersions(versionIds: string[]) {
    const entityById = new Map(
      (await this.getSnapshot()).entities.map((entity) => [entity.id, entity]),
    );
    return versionIds
      .map((id) => entityById.get(id))
      .filter((entity): entity is Entity => Boolean(entity?.familyId));
  }

  async getEntityClaims(
    entityId: string,
    scope: "current" | "history" | "all",
    cursor?: string,
    limit = 10,
    _signal?: AbortSignal,
    filters?: { q?: string; topic?: string },
  ) {
    const ordered = (await this.getSnapshot()).claims
      .filter((claim) => claim.entityId === entityId)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      );
    const scoped = (scope === "history" ? ordered.slice(5) : ordered).filter((claim) => {
      if (filters?.topic && claim.predicate !== filters.topic) return false;
      const text = [
        claim.text.zh,
        claim.text.en,
        claim.text.technical?.zh,
        claim.text.technical?.en,
        claim.subject,
        claim.predicate,
        claim.objectOrValue,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !filters?.q?.trim() || text.includes(filters.q.trim().toLowerCase());
    });
    const remaining = cursor
      ? scoped.filter((claim) => `${claim.updatedAt}|${claim.id}` < cursor)
      : scoped;
    const items = remaining.slice(0, limit);
    const sourceIds = new Set(items.flatMap((claim) => claim.sourceIds));
    return {
      total: scoped.length,
      items,
      evidence: (await this.getSnapshot()).evidence.filter((item) => sourceIds.has(item.id)),
      nextCursor:
        remaining.length > limit && items.length
          ? `${items.at(-1)?.updatedAt}|${items.at(-1)?.id}`
          : undefined,
    };
  }
}

class HttpKnowledgeRepository implements KnowledgeRepository {
  readonly mode = "live" as const;

  constructor(private readonly baseUrl: string) {}

  private send(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    return fetchWithNetworkRetry(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal,
    });
  }

  private async parse<T>(response: Response) {
    if (!response.ok) {
      if (response.status === 404) return null as T;
      throw new Error(`Knowledge API request failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private async request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    return this.parse<T>(await this.send(path, init, signal));
  }

  async getSnapshot(signal?: AbortSignal) {
    const response = await this.send("/api/v2/snapshot", {}, signal);
    const snapshot = await this.parse<KnowledgeSnapshot | null>(response);
    if (!snapshot) throw new Error("Knowledge snapshot is unavailable");
    return withSnapshotCopyTime(snapshot, response.headers.get(snapshotFetchedAtHeader));
  }

  getEntities(query: EntityQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (query.type) params.set("type", query.type);
    if (query.query) params.set("query", query.query);
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.request<Entity[]>(`/api/v2/entities${suffix}`, {}, signal);
  }

  getEntityBySlug(slug: string, type: EntityType = "model", signal?: AbortSignal) {
    return this.request<Entity | null>(
      `/api/v2/entities/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`,
      {},
      signal,
    );
  }

  getEntityTimeline(entityId: string, signal?: AbortSignal) {
    return this.request<TimelineEvent[]>(
      `/api/v2/entities/${encodeURIComponent(entityId)}/timeline`,
      {},
      signal,
    );
  }

  getModelFamilies(signal?: AbortSignal) {
    return this.request<Entity[]>("/api/v2/model-families", {}, signal);
  }

  getFamilyVersions(familyId: string, signal?: AbortSignal) {
    return this.request<Entity[]>(
      `/api/v2/model-families/${encodeURIComponent(familyId)}/versions`,
      {},
      signal,
    );
  }

  compareModelVersions(versionIds: string[], signal?: AbortSignal) {
    return this.request<Entity[]>(
      "/api/v2/model-versions/compare",
      {
        method: "POST",
        body: JSON.stringify({ versionIds }),
      },
      signal,
    );
  }

  getEntityClaims(
    entityId: string,
    scope: "current" | "history" | "all",
    cursor?: string,
    limit = 10,
    signal?: AbortSignal,
    filters?: { q?: string; topic?: string },
  ) {
    const params = new URLSearchParams({ scope, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    if (filters?.q?.trim()) params.set("q", filters.q.trim());
    if (filters?.topic) params.set("topic", filters.topic);
    return this.request<EntityClaimPage>(
      `/api/v2/entities/${encodeURIComponent(entityId)}/claims?${params.toString()}`,
      {},
      signal,
    );
  }
}

// 浏览器通过 Cloudflare 同域代理访问 API；SSR 若回调同一个 Worker 会被
// Cloudflare 拒绝，因此服务端直接使用公开的 Render 上游地址。
const apiBaseUrl = (
  import.meta.env.SSR
    ? (import.meta.env.VITE_API_UPSTREAM_URL ?? import.meta.env.VITE_API_BASE_URL)
    : import.meta.env.VITE_API_BASE_URL
)?.trim();

export function createKnowledgeRepository(baseUrl?: string): KnowledgeRepository {
  return baseUrl?.trim()
    ? new HttpKnowledgeRepository(baseUrl.trim().replace(/\/$/, ""))
    : new DemoKnowledgeRepository();
}

export const knowledgeRepository = createKnowledgeRepository(apiBaseUrl);
