import {
  freshnessAgeLabel,
  freshnessBudgetLabel,
  freshnessTrackLabels,
  type KnowledgeFreshness,
} from "@/domain/knowledge-freshness";

import { StatusBadge } from "./shared";

export function FreshnessPanel({ freshness }: { freshness?: KnowledgeFreshness | null }) {
  if (!freshness) return null;
  const overdue = freshness.status === "overdue";
  return (
    <div
      className={`mt-4 rounded-lg border p-4 ${overdue ? "border-conflict/40 bg-conflict/5" : "border-border"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">审核时限</h3>
        <StatusBadge
          label={overdue ? `${freshness.overdueCount} 条超时` : "全部在时限内"}
          status={overdue ? "failed" : "succeeded"}
        />
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        从候选进入审核队列开始计时。“近 {freshness.recentWindowDays}{" "}
        天”统计已完成审核中超过时限的条数。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {freshness.tracks.map((track) => {
          const late = track.overdueCount > 0;
          return (
            <div
              key={track.track}
              className={`rounded-md border p-3 text-sm ${late ? "border-conflict/40" : "border-border"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{freshnessTrackLabels[track.track]}</span>
                <span className="text-xs text-muted-foreground">
                  时限 {freshnessBudgetLabel(track.budgetHours)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>待审 {track.openCount}</span>
                <span className={late ? "font-medium text-conflict" : ""}>
                  超时 {track.overdueCount}
                </span>
                <span>最久等待 {freshnessAgeLabel(track.oldestOpenAgeHours)}</span>
                <span>
                  近 {freshness.recentWindowDays} 天超时完成 {track.recentDecidedLateCount} /{" "}
                  {track.recentDecidedCount}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
