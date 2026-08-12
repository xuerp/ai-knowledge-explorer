import type { SourceView } from "@/services/admin-api";

const rolloutPriority = [
  "s-langchain-overview",
  "s-openai-about",
  "s-anthropic-company",
  "s-cursor-docs",
  "s-openai-gpt5",
  "s-anthropic-claude",
];

export function isAllowlistedSource(source: SourceView, allowedHosts: string[]): boolean {
  try {
    const host = new URL(source.url).hostname.toLocaleLowerCase("en-US");
    return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export function selectRolloutSources(
  sources: SourceView[],
  allowedHosts: string[],
  limit = 5,
): SourceView[] {
  const priority = new Map(rolloutPriority.map((id, index) => [id, index]));
  return sources
    .filter(
      (source) =>
        source.active && !source.fetchEnabled && isAllowlistedSource(source, allowedHosts),
    )
    .sort(
      (left, right) =>
        (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.title.localeCompare(right.title, "zh-CN"),
    )
    .slice(0, Math.max(0, limit));
}
