import type { DataMode, KnowledgeSnapshot } from "@/domain/types";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";

export interface KnowledgeRepository {
  mode: DataMode;
  getSnapshot: (signal?: AbortSignal) => Promise<KnowledgeSnapshot>;
}

class DemoKnowledgeRepository implements KnowledgeRepository {
  readonly mode = "demo" as const;

  async getSnapshot() {
    return DEMO_KNOWLEDGE_SNAPSHOT;
  }
}

class HttpKnowledgeRepository implements KnowledgeRepository {
  readonly mode = "live" as const;

  constructor(private readonly baseUrl: string) {}

  async getSnapshot(signal?: AbortSignal) {
    const response = await fetch(`${this.baseUrl}/api/snapshot`, {
      headers: { Accept: "application/json" },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Knowledge API request failed with status ${response.status}`);
    }

    return (await response.json()) as KnowledgeSnapshot;
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const knowledgeRepository: KnowledgeRepository = apiBaseUrl
  ? new HttpKnowledgeRepository(apiBaseUrl.replace(/\/$/, ""))
  : new DemoKnowledgeRepository();
