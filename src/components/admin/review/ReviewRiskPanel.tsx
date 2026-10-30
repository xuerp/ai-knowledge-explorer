import { Metric } from "./shared";

import type { ReviewViewModel } from "./review-view-model";
export function ReviewRiskPanel({ context }: { context: ReviewViewModel }) {
  const { workspace } = context;
  return (
    <>
      {workspace.reviewInventory && (
        <section className="paper-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl font-semibold">跨通道风险标记</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                以下指标可彼此重叠，也可能与下方主通道同时命中；它们只提示复核重点，不代表候选可批准。
              </p>
            </div>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
              共 {workspace.reviewInventory.openTotal} 条开放候选
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="与已发布事实重复"
              value={workspace.reviewInventory.duplicateWithPublishedItems}
            />
            <Metric
              label="队列内重复组"
              value={workspace.reviewInventory.deterministicDuplicateGroups}
            />
            <Metric label="可能更新标记" value={workspace.reviewInventory.possibleUpdateGroups} />
            <Metric label="冲突标记" value={workspace.reviewInventory.conflictItems} />
            <Metric label="陈旧标记（>90 天）" value={workspace.reviewInventory.staleItems} />
            <Metric label="无效原文锚点" value={workspace.reviewInventory.invalidAnchorItems} />
            <Metric label="缺少证据标记" value={workspace.reviewInventory.missingEvidenceItems} />
            <Metric label="高风险标记" value={workspace.reviewInventory.riskCounts.high ?? 0} />
          </div>
        </section>
      )}
    </>
  );
}
