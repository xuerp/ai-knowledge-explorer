import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Metric } from "./shared";

import type { ReviewViewModel } from "./review-view-model";
export function ClaimEntityAuditPanel({ context }: { context: ReviewViewModel }) {
  const {
    busy,
    entityRepairReport,
    manualEntityReasons,
    manualEntitySelections,
    resolveUnlinkedClaim,
    resolvingClaimIds,
    runEntityRepair,
    setManualEntityReasons,
    setManualEntitySelections,
    user,
    workspace,
  } = context;
  return (
    <>
      {workspace.claimEntityAudit && workspace.claimEntityAudit.missingOrInvalidCount > 0 && (
        <section className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl font-semibold">Claim 实体关联审计</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                只读报告不会修改数据；无合法实体的候选已经无法批准发布。
              </p>
            </div>
            <span className="rounded-full border border-amber-400/50 px-2.5 py-1 text-xs">
              {workspace.claimEntityAudit.missingOrInvalidCount} 条待处理
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Metric label="公开 Claim" value={workspace.claimEntityAudit.publicClaimCount} />
            <Metric
              label="可确定性回填"
              value={workspace.claimEntityAudit.deterministicRepairCount}
            />
            <Metric label="需人工判断" value={workspace.claimEntityAudit.manualReviewCount} />
            <Metric
              label="已有处置建议"
              value={
                workspace.claimEntityAudit.items.filter((item) => item.recommendedAction).length
              }
            />
          </div>
          <details className="mt-4 rounded-md border border-border bg-background/60 p-3">
            <summary className="cursor-pointer text-sm font-medium">查看关联问题明细</summary>
            <div className="mt-3 space-y-3">
              {workspace.claimEntityAudit.items.slice(0, 50).map((item) => (
                <div key={item.claimId} className="rounded border border-border px-3 py-3 text-xs">
                  <div className="grid gap-1 md:grid-cols-[1fr_1fr_2fr]">
                    <span className="font-mono">{item.claimId}</span>
                    <span>
                      {item.subject || "无主体"} → {item.proposedEntityId || "未解析"}
                    </span>
                    <span className="text-muted-foreground">{item.reason}</span>
                  </div>
                  {item.recommendedAction && item.recommendationReason && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                      <div>
                        <div className="font-medium text-emerald-700 dark:text-emerald-300">
                          {item.recommendedAction === "assign"
                            ? `建议关联：${item.recommendedEntityId}`
                            : "建议撤回：网页模板噪声"}
                        </div>
                        <p className="mt-1 text-muted-foreground">{item.recommendationReason}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={item.recommendedAction === "retract" ? "destructive" : "outline"}
                        disabled={
                          user.role !== "admin" ||
                          !item.reviewJobId ||
                          resolvingClaimIds.has(item.claimId)
                        }
                        onClick={() => resolveUnlinkedClaim(item, item.recommendedAction!)}
                      >
                        {item.recommendedAction === "assign" ? "采纳关联建议" : "确认撤回噪声"}
                      </Button>
                    </div>
                  )}
                  {user.role === "admin" && item.resolution !== "deterministic" && (
                    <div className="mt-3 grid gap-2 border-t border-border pt-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_auto_auto]">
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground"
                        aria-label={`${item.claimId} 目标实体`}
                        value={
                          manualEntitySelections[item.claimId] ?? item.recommendedEntityId ?? ""
                        }
                        disabled={!item.reviewJobId || resolvingClaimIds.has(item.claimId)}
                        onChange={(event) =>
                          setManualEntitySelections((current) => ({
                            ...current,
                            [item.claimId]: event.target.value,
                          }))
                        }
                      >
                        <option value="">选择目标实体</option>
                        {workspace.entities.map((entity) => (
                          <option key={entity.id} value={entity.id}>
                            {entity.name.zh}（{entity.id}）
                          </option>
                        ))}
                      </select>
                      <Input
                        aria-label={`${item.claimId} 处理理由`}
                        placeholder="处理理由（至少 8 个字符）"
                        value={manualEntityReasons[item.claimId] ?? item.recommendationReason ?? ""}
                        disabled={!item.reviewJobId || resolvingClaimIds.has(item.claimId)}
                        onChange={(event) =>
                          setManualEntityReasons((current) => ({
                            ...current,
                            [item.claimId]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={!item.reviewJobId || resolvingClaimIds.has(item.claimId)}
                        onClick={() => resolveUnlinkedClaim(item, "assign")}
                      >
                        人工关联实体
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={!item.reviewJobId || resolvingClaimIds.has(item.claimId)}
                        onClick={() => resolveUnlinkedClaim(item, "retract")}
                      >
                        撤回抽取噪声
                      </Button>
                      {!item.reviewJobId && (
                        <p className="text-muted-foreground lg:col-span-4">
                          这条记录来自静态种子目录，需通过版本化数据修正处理。
                        </p>
                      )}
                    </div>
                  )}
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
                onClick={() => runEntityRepair("dry-run")}
              >
                运行确定性 Dry Run
              </Button>
              <Button
                type="button"
                disabled={busy || !entityRepairReport?.repairableCount}
                onClick={() => runEntityRepair("apply")}
              >
                回填 {entityRepairReport?.repairableCount ?? 0} 条确定性关联
              </Button>
              {entityRepairReport && (
                <span className="text-xs text-muted-foreground">
                  本次扫描 {entityRepairReport.total} 条；已修复 {entityRepairReport.repairedCount}{" "}
                  条。
                </span>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
