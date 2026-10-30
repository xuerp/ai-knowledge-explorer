import type { SourceView } from "@/services/admin-api";

export function statusLabel(status: "running" | "succeeded" | "partial" | "failed"): string {
  return status === "running"
    ? "运行中"
    : status === "succeeded"
      ? "成功"
      : status === "partial"
        ? "部分失败"
        : "失败";
}

export function workerStateLabel(
  state: "starting" | "running" | "idle" | "failed" | "stopped",
): string {
  return state === "starting"
    ? "启动中"
    : state === "running"
      ? "运行中"
      : state === "idle"
        ? "空闲"
        : state === "failed"
          ? "失败"
          : "已停止";
}

export function isFuture(value?: string): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

export function isRecentProbePassed(source: SourceView): boolean {
  if (source.lastProbeStatus !== "passed" || !source.lastProbeAt) return false;
  const probedAt = new Date(source.lastProbeAt).getTime();
  return Number.isFinite(probedAt) && probedAt >= Date.now() - 24 * 60 * 60 * 1000;
}
