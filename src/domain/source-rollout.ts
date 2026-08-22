import type { SourceView } from "@/services/admin-api";

export type RolloutOutcome =
  | {
      source: SourceView;
      enabled: true;
      firstCollection: "completed" | "scheduled" | "running";
      reason?: string;
    }
  | { source: SourceView; enabled: false; reason: string };

const rolloutPriority = [
  "s-openai-api-changelog",
  "s-openai-models",
  "s-openai-deprecations",
  "s-google-gemini-api-changelog",
  "s-mcp-architecture",
  "s-langchain-overview",
  "s-anthropic-company",
  "s-cursor-docs",
  "s-qwen-models",
  "s-swebench",
];

export function describeSourceAction(source: SourceView): string {
  if (source.healthState === "paused") {
    if (source.failureKind === "redirect") {
      return "更换为最终规范地址或官方 Markdown / RSS 入口，保存后重新预检；不要直接重复排队。";
    }
    if (source.failureKind === "blocked") {
      return "目标拒绝云服务器访问。寻找同厂商官方更新日志、RSS、JSON 或 GitHub Releases；找不到则保留人工采集。";
    }
    if (source.failureKind === "allowlist") {
      return "先核实入口确属官方域名，再加入后端白名单并重新预检；不要放行第三方跳转域名。";
    }
    if (source.failureKind === "content") {
      return "当前页面体积或正文结构不适合采集，请换用更小的官方机器入口。";
    }
    return "检查最近错误并更换稳定入口；修复并预检通过后再恢复采集。";
  }
  if (source.collectionStrategy === "manual") {
    return "作为人工证据页保留；由同厂商机器信源发现变化。若已有替代入口且内容重复，可停用此条。";
  }
  if (source.healthState === "retrying") {
    return "当前属于可恢复错误，系统会有限退避；若连续失败转为永久错误，将自动熔断。";
  }
  if (source.collectionStrategy === "unverified") {
    return "先完成连接预检。通过后才能启用；失败时按提示更换入口或转为人工证据。";
  }
  if (!source.fetchEnabled) {
    return "官方机器入口已登记但尚未启用，可通过批量安全接入完成预检和首次采集。";
  }
  return "入口运行正常；保留当前周期并观察快照是否真实产生变化。";
}

export function isVettedRolloutSource(source: SourceView): boolean {
  return source.collectionStrategy === "automatic";
}

export function isAllowlistedSource(source: SourceView, allowedHosts: string[]): boolean {
  const urls = [source.effectiveFetchUrl || source.url, ...(source.fallbackUrls ?? [])];
  return urls.every((url) => {
    try {
      const host = new URL(url).hostname.toLocaleLowerCase("en-US");
      return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    } catch {
      return false;
    }
  });
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

export function formatRolloutSummary(outcomes: RolloutOutcome[]): string {
  const enabled = outcomes.filter((outcome) => outcome.enabled);
  const failed = outcomes.filter((outcome) => !outcome.enabled);
  const collected = enabled.filter((outcome) => outcome.firstCollection === "completed");
  const running = enabled.filter((outcome) => outcome.firstCollection === "running");
  const scheduled = enabled.filter((outcome) => outcome.firstCollection === "scheduled");
  return `批量接入完成：检查 ${outcomes.length} 个，通过并启用 ${enabled.length} 个，首次采集完成 ${collected.length} 个，调度器正在处理 ${running.length} 个，等待自动重试 ${scheduled.length} 个，接入失败保持关闭 ${failed.length} 个。${
    failed.length > 0
      ? ` 失败项：${failed.map((item) => `${item.source.title}（${item.reason}）`).join("；")}`
      : ""
  }${
    scheduled.length > 0
      ? ` 自动重试项：${scheduled.map((item) => `${item.source.title}（${item.reason ?? "已安排重试"}）`).join("；")}`
      : ""
  }`;
}
