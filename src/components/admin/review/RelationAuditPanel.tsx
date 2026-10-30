import { Button } from "@/components/ui/button";

import { Metric } from "./shared";

import type { ReviewViewModel } from "./review-view-model";
export function RelationAuditPanel({ context }: { context: ReviewViewModel }) {
  const { busy, relationRepairReport, runRelationRepair, user, workspace } = context;
  return (
    <>
      {workspace.relationClaimAudit &&
        (workspace.relationClaimAudit.repairableCount > 0 ||
          workspace.relationClaimAudit.manualReviewCount > 0) && (
          <section className="rounded-lg border border-sky-400/40 bg-sky-400/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-semibold">历史关系 Claim 审计</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  检查已审核关系事实是否已经生成图谱边；Dry Run
                  不修改数据，目标不唯一的记录继续保留人工判断。
                </p>
              </div>
              <span className="rounded-full border border-sky-400/50 px-2.5 py-1 text-xs">
                {workspace.relationClaimAudit.repairableCount} 条可确定性修复
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Metric
                label="关系型 Claim"
                value={workspace.relationClaimAudit.totalRelationClaims}
              />
              <Metric label="已发布关系" value={workspace.relationClaimAudit.linkedCount} />
              <Metric label="可确定性修复" value={workspace.relationClaimAudit.repairableCount} />
              <Metric label="需人工判断" value={workspace.relationClaimAudit.manualReviewCount} />
            </div>
            <details className="mt-4 rounded-md border border-border bg-background/60 p-3">
              <summary className="cursor-pointer text-sm font-medium">查看历史关系缺口</summary>
              <div className="mt-3 space-y-2">
                {workspace.relationClaimAudit.items
                  .filter((item) => item.status !== "linked")
                  .slice(0, 50)
                  .map((item) => (
                    <div
                      key={item.claimId}
                      className="grid gap-1 rounded border border-border px-3 py-2 text-xs md:grid-cols-[1fr_1.3fr_2fr]"
                    >
                      <span className="font-mono">{item.claimId}</span>
                      <span>
                        {item.sourceEntityId || "无源实体"} · {item.relationKind || item.predicate}{" "}
                        → {item.proposedTargetEntityId || item.targetReference || "未解析"}
                      </span>
                      <span className="text-muted-foreground">{item.reason}</span>
                    </div>
                  ))}
              </div>
            </details>
            {user.role === "admin" && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => runRelationRepair("dry-run")}
                >
                  运行历史关系 Dry Run
                </Button>
                <Button
                  type="button"
                  disabled={busy || !relationRepairReport?.repairableCount}
                  onClick={() => runRelationRepair("apply")}
                >
                  修复 {relationRepairReport?.repairableCount ?? 0} 条历史关系
                </Button>
                {relationRepairReport && (
                  <span className="text-xs text-muted-foreground">
                    本次扫描 {relationRepairReport.total} 条；已修复{" "}
                    {relationRepairReport.repairedCount} 条。
                  </span>
                )}
              </div>
            )}
          </section>
        )}
    </>
  );
}
