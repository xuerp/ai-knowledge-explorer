import type { Entity, EntityType } from "@/domain/types";
import type { SearchSchemaInput } from "@tanstack/react-router";

export type KnowledgeCategory = "model" | "ecosystem" | "research" | "organizations" | "all";
export type KnowledgeRegion = "all" | "domestic" | "overseas";
export type KnowledgeSignal = "all" | "multimodal" | "context" | "open";
export type KnowledgeSearch = {
  category: KnowledgeCategory;
  region: KnowledgeRegion;
  signal: KnowledgeSignal;
  q: string;
};

export const CATEGORY_TYPES: Record<Exclude<KnowledgeCategory, "all">, EntityType[]> = {
  model: ["model"],
  ecosystem: ["agent", "application", "tool", "api", "framework"],
  research: ["dataset", "benchmark", "paper"],
  organizations: ["company"],
};

export function validateKnowledgeSearch(
  search: Record<string, unknown> & SearchSchemaInput,
): KnowledgeSearch {
  return parseKnowledgeSearch(search);
}

export function parseKnowledgeSearch(search: Record<string, unknown>): KnowledgeSearch {
  const category = ["model", "ecosystem", "research", "organizations", "all"].includes(
    String(search.category),
  )
    ? (search.category as KnowledgeCategory)
    : "model";
  return {
    category,
    region: ["domestic", "overseas"].includes(String(search.region))
      ? (search.region as KnowledgeRegion)
      : "all",
    signal:
      category === "model" && ["multimodal", "context", "open"].includes(String(search.signal))
        ? (search.signal as KnowledgeSignal)
        : "all",
    q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
  };
}

export function categoryForEntity(type: EntityType): KnowledgeCategory {
  return type === "model"
    ? "model"
    : CATEGORY_TYPES.organizations.includes(type)
      ? "organizations"
      : CATEGORY_TYPES.research.includes(type)
        ? "research"
        : "ecosystem";
}

/** Browse by primary purpose; Agent, IDE and CLI remain descriptive tags. */
export function knowledgePurpose(
  entity: Entity,
): "models" | "coding" | "work" | "infrastructure" | "evaluation" | "research" | "organizations" {
  if (entity.type === "model") return "models";
  if (entity.type === "company") return "organizations";
  if (entity.type === "benchmark") return "evaluation";
  if (entity.type === "paper" || entity.type === "dataset") return "research";
  if (entity.type === "framework" || entity.tags.some((tag) => /^(SDK|协议|框架)$/i.test(tag)))
    return "infrastructure";
  if (entity.tags.some((tag) => /^(代码|编程|软件工程|coding|IDE|CLI)$/i.test(tag)))
    return "coding";
  return "work";
}

export function knowledgeBrowseHref(search: KnowledgeSearch): string {
  return `/knowledge?${new URLSearchParams(search).toString()}`;
}

export function parseEntitySearch(search: Record<string, unknown>): { browse?: string } {
  return typeof search.browse === "string" && search.browse.length < 1600
    ? { browse: search.browse }
    : {};
}

export function knowledgeReturnSearch(type: EntityType, browse?: string): KnowledgeSearch {
  const fallback = parseKnowledgeSearch({ category: categoryForEntity(type) });
  if (!browse) return fallback;
  try {
    const url = new URL(browse, "https://knowledge.invalid");
    if (url.origin !== "https://knowledge.invalid" || url.pathname !== "/knowledge")
      return fallback;
    return parseKnowledgeSearch(Object.fromEntries(url.searchParams));
  } catch {
    return fallback;
  }
}
