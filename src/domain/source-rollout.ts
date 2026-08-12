import type { SourceView } from "@/services/admin-api";

const rolloutPriority = [
  "s-mcp-architecture",
  "s-langchain-overview",
  "s-anthropic-company",
  "s-cursor-docs",
  "s-qwen-models",
  "s-swebench",
];

export function isVettedRolloutSource(source: SourceView): boolean {
  return source.collectionStrategy === "automatic";
}

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
        source.active &&
        !source.fetchEnabled &&
        isVettedRolloutSource(source) &&
        isAllowlistedSource(source, allowedHosts),
    )
    .sort(
      (left, right) =>
        (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.title.localeCompare(right.title, "zh-CN"),
    )
    .slice(0, Math.max(0, limit));
}

export function describeProbeFailure(message: string | undefined): string {
  const detail = message ?? "未返回具体原因。";
  if (/403 Forbidden/i.test(detail)) {
    return "目标官网拒绝云服务器访问，已保留为手动信源，不会继续自动重试。";
  }
  if (/not in AI_RADAR_FETCH_ALLOWED_HOSTS/i.test(detail)) {
    return "该域名尚未进入后端采集白名单，已保持关闭。";
  }
  if (/exceeds AI_RADAR_FETCH_MAX_BYTES/i.test(detail)) {
    return "页面体积超过安全采集上限，需改用更小的官方数据入口。";
  }
  if (/timed out|timeout/i.test(detail)) {
    return "目标站点响应超时，本次保持关闭，可稍后重新预检。";
  }
  if (/redirect/i.test(detail)) {
    return "目标地址发生了未通过安全校验的跳转，需登记规范网址。";
  }
  return detail;
}
