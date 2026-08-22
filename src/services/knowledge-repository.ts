import type {
  DataMode,
  Claim,
  Entity,
  EntityType,
  KnowledgeSnapshot,
  TimelineEvent,
} from "@/domain/types";
import type { Source } from "@/domain/types";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";

export interface EntityQuery {
  type?: EntityType;
  query?: string;
}

export interface EntityClaimPage {
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
  ) => Promise<EntityClaimPage>;
}

function filterDemoEntities(query: EntityQuery = {}) {
  const needle = query.query?.trim().toLocaleLowerCase();
  return DEMO_KNOWLEDGE_SNAPSHOT.entities.filter((entity) => {
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
    return DEMO_KNOWLEDGE_SNAPSHOT;
  }

  async getEntities(query: EntityQuery = {}) {
    return filterDemoEntities(query);
  }

  async getEntityBySlug(slug: string, type?: EntityType) {
    return (
      DEMO_KNOWLEDGE_SNAPSHOT.entities.find(
        (entity) => entity.slug === slug && (!type || entity.type === type),
      ) ?? null
    );
  }

  async getEntityTimeline(entityId: string) {
    return DEMO_KNOWLEDGE_SNAPSHOT.timeline[entityId] ?? [];
  }

  async getModelFamilies() {
    return DEMO_KNOWLEDGE_SNAPSHOT.entities.filter(
      (entity) => entity.type === "model" && !entity.familyId,
    );
  }

  async getFamilyVersions(familyId: string) {
    return DEMO_KNOWLEDGE_SNAPSHOT.entities
      .filter((entity) => entity.familyId === familyId)
      .sort((a, b) => (a.firstReleasedAt ?? "").localeCompare(b.firstReleasedAt ?? ""));
  }

  async compareModelVersions(versionIds: string[]) {
    const entityById = new Map(
      DEMO_KNOWLEDGE_SNAPSHOT.entities.map((entity) => [entity.id, entity]),
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
  ) {
    const ordered = DEMO_KNOWLEDGE_SNAPSHOT.claims
      .filter((claim) => claim.entityId === entityId)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      );
    const scoped = scope === "history" ? ordered.slice(5) : ordered;
    const remaining = cursor
      ? scoped.filter((claim) => `${claim.updatedAt}|${claim.id}` < cursor)
      : scoped;
    const items = remaining.slice(0, limit);
    const sourceIds = new Set(items.flatMap((claim) => claim.sourceIds));
    return {
      items,
      evidence: DEMO_KNOWLEDGE_SNAPSHOT.evidence.filter((item) => sourceIds.has(item.id)),
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

  private async request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const response = await fetchWithNetworkRetry(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal,
    });

    if (!response.ok) {
      if (response.status === 404) return null as T;
      throw new Error(`Knowledge API request failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }

  getSnapshot(signal?: AbortSignal) {
    return this.request<KnowledgeSnapshot>("/api/v2/snapshot", {}, signal);
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
  ) {
    const params = new URLSearchParams({ scope, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
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
  import.meta.env.SSR ? import.meta.env.VITE_API_UPSTREAM_URL : import.meta.env.VITE_API_BASE_URL
)?.trim();

export const knowledgeRepository: KnowledgeRepository = apiBaseUrl
  ? new HttpKnowledgeRepository(apiBaseUrl.replace(/\/$/, ""))
  : new DemoKnowledgeRepository();
