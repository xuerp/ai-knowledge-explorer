import { ReviewRevisionForm } from "@/components/knowledge/ReviewRevisionForm";
import { Braces, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { findClaimLifecycleMatches } from "@/domain/claim-lifecycle";
import { reviewReasonCategoryLabels } from "@/domain/review-decision";
import { assessReviewItem } from "@/domain/review-priority";
import { type ReviewLane } from "@/domain/review-lanes";

import type { ReviewViewModel } from "./review-view-model";
export function ReviewQueuePanel({ context }: { context: ReviewViewModel }) {
  const {
    addRevision,
    allBatchApprovable,
    automationApprovals,
    batchApproveCandidates,
    batchApproveRecentCandidates,
    batchExtractCandidates,
    batchMergeDeterministicDuplicates,
    batchRejectDeterministicallyInvalid,
    busy,
    changePublicationState,
    decide,
    decideLifecycle,
    laneCounts,
    orderedPendingQueue,
    pendingQueue,
    publicationReasons,
    reasonCategories,
    reasons,
    recentBatchApprovable,
    recentCandidateIds,
    recentExtraction,
    reviewErrors,
    reviewFilter,
    reviewHistory,
    reviewingIds,
    setPublicationReasons,
    setReasonCategories,
    setReasons,
    setReviewFilter,
    token,
    user,
    verifyAutomationApprovals,
    workspace,
  } = context;
  return (
    <>
      <section id="review-queue" className="scroll-mt-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold">待审核队列</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              当前待处理 {pendingQueue.length}{" "}
              条。以下主通道互斥且每条候选只归入一个；安全校验优先，
              因此无效候选即使带有更新、冲突或高风险标记，仍归入“确定性无效”。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              aria-label="审核队列筛选"
              value={reviewFilter}
              onChange={(event) => setReviewFilter(event.target.value as "all" | ReviewLane)}
            >
              <option value="all">全部待审（{pendingQueue.length}）</option>
              <option value="fresh-safe">新鲜安全候选（{laneCounts["fresh-safe"]}）</option>
              <option value="duplicate">确定性重复（{laneCounts.duplicate}）</option>
              <option value="possible-update">可能更新（{laneCounts["possible-update"]}）</option>
              <option value="high-risk">高风险与冲突（{laneCounts["high-risk"]}）</option>
              <option value="invalid">确定性无效（{laneCounts.invalid}）</option>
              <option value="stale">陈旧但待判断（{laneCounts.stale}）</option>
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={busy || laneCounts.duplicate === 0}
              onClick={batchMergeDeterministicDuplicates}
            >
              合并确定性重复（{laneCounts.duplicate}）
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || laneCounts.invalid === 0}
              onClick={batchRejectDeterministicallyInvalid}
            >
              清理确定性无效（{laneCounts.invalid}）
            </Button>
            <Button
              type="button"
              disabled={busy || allBatchApprovable.length === 0}
              onClick={() => batchApproveCandidates(pendingQueue.map((item) => item.id))}
            >
              <Check />
              批准新鲜安全候选（{allBatchApprovable.length}）
            </Button>
            {user.role === "admin" && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || workspace.extractionPlan.length === 0}
                onClick={batchExtractCandidates}
              >
                <Braces />
                批量生成质量候选（{Math.min(10, workspace.extractionPlan.length)}）
              </Button>
            )}
          </div>
        </div>
        {pendingQueue.length === 0 && (
          <div className="paper-card p-5 text-sm text-muted-foreground">当前没有待审核候选。</div>
        )}
        {pendingQueue.length > 0 && orderedPendingQueue.length === 0 && (
          <div className="paper-card p-5 text-sm text-muted-foreground">
            当前筛选条件下没有候选；切换为“全部待审”可查看完整开放队列。
          </div>
        )}
        {recentExtraction && recentExtraction.candidateIds.length > 0 && (
          <div className="rounded-lg border border-signal/30 bg-signal/5 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">本次抽取：{recentExtraction.sourceTitle}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {`蓝色边框标记的是刚生成的 ${recentExtraction.candidateIds.length} 条候选；批量批准只处理具备可定位原文锚点且无冲突的待审项，其余条目会自动保留。`}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={busy || recentBatchApprovable.length === 0}
                onClick={batchApproveRecentCandidates}
              >
                <Check />
                批准本批安全候选（{recentBatchApprovable.length}）
              </Button>
            </div>
          </div>
        )}
        {orderedPendingQueue.map((item) => {
          const reviewing = reviewingIds.has(item.id);
          const assessment = assessReviewItem(item);
          const lifecycleMatches = findClaimLifecycleMatches(item, reviewHistory);
          return (
            <article
              key={item.id}
              className={`paper-card p-5 ${recentCandidateIds.has(item.id) ? "border-signal/50 ring-1 ring-signal/20" : ""}`}
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
                  <h3 className="mt-2 font-medium">{item.claim.text.zh}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.claim.text.en}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <span className="h-fit rounded-full border border-border px-2.5 py-1 text-xs">
                    {recentCandidateIds.has(item.id) ? "本次抽取" : item.status}
                  </span>
                  <span
                    className={`h-fit rounded-full px-2.5 py-1 text-xs ${
                      assessment.risk === "high"
                        ? "bg-conflict/10 text-conflict"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {assessment.risk === "high" ? "高风险" : "标准审核"}
                  </span>
                  <span className="h-fit rounded-full bg-signal/10 px-2.5 py-1 text-xs text-signal">
                    {assessment.freshness === "fresh"
                      ? "近期"
                      : assessment.freshness === "aging"
                        ? "较早"
                        : "历史"}
                  </span>
                  {assessment.batchSafe && (
                    <span className="h-fit rounded-full bg-verified/10 px-2.5 py-1 text-xs text-verified">
                      可批量
                    </span>
                  )}
                </div>
              </div>
              {(item.conflictClaimIds.length > 0 || item.reasonNote || item.reviewReason) && (
                <div className="mt-3 rounded-md border border-conflict/30 bg-conflict/10 p-3 text-sm">
                  {item.reasonNote ?? item.reviewReason}
                  {item.conflictClaimIds.length > 0 && (
                    <div className="mt-1 font-mono text-xs">{item.conflictClaimIds.join(", ")}</div>
                  )}
                </div>
              )}
              <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  核验依据（{item.evidenceItems.length}）
                </div>
                {item.evidenceItems.length === 0 ? (
                  <p className="text-sm text-conflict">当前候选缺少可查看的证据，不能批准。</p>
                ) : (
                  item.evidenceItems.map((evidence) => (
                    <div
                      key={evidence.id}
                      className="flex flex-col gap-1 border-t border-border pt-2 first:border-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{evidence.title.zh}</div>
                        <div className="text-xs text-muted-foreground">
                          {evidence.publisher} · {evidence.type} · 采集于 {evidence.collectedAt}
                        </div>
                        {evidence.sourceExcerpt && (
                          <blockquote className="mt-2 border-l-2 border-signal/40 pl-3 text-xs leading-relaxed text-muted-foreground">
                            {evidence.sourceExcerpt}
                          </blockquote>
                        )}
                      </div>
                      <a
                        className="shrink-0 text-sm text-signal underline underline-offset-4"
                        href={evidence.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开原文
                      </a>
                    </div>
                  ))
                )}
              </div>
              {lifecycleMatches.length > 0 && (
                <div className="mt-4 rounded-md border border-signal/30 bg-signal/5 p-3">
                  <div className="text-sm font-medium">可能关联的已发布事实</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    系统只按实体、谓词、标准化值和有效期做确定性提示，最终动作仍由审核员确认。
                  </p>
                  <div className="mt-3 space-y-2">
                    {lifecycleMatches.map((match) => (
                      <div
                        key={match.target.id}
                        className="flex flex-col gap-2 rounded-md border border-border bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="text-sm">{match.target.claim.text.zh}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {match.relationship === "duplicate" ? "完全重复" : "可能更新"} · 目标{" "}
                            {match.target.claim.id} · {match.target.evidenceItems.length} 条证据
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={match.relationship === "duplicate" ? "outline" : "default"}
                          disabled={reviewing}
                          onClick={() => decideLifecycle(item, match)}
                        >
                          {match.relationship === "duplicate" ? "合并证据" : "替代此事实"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.5fr)_auto_auto]">
                <select
                  aria-label="拒绝原因分类"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={reasonCategories[item.id] ?? ""}
                  disabled={reviewing}
                  onChange={(event) =>
                    setReasonCategories((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">拒绝原因分类</option>
                  {Object.entries(reviewReasonCategoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="审核备注"
                  placeholder="审核备注（可选）"
                  value={reasons[item.id] ?? ""}
                  disabled={reviewing}
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                />
                <Button
                  onClick={() => decide(item, "approve")}
                  disabled={reviewing || item.evidenceItems.length === 0}
                >
                  <Check />
                  {reviewing ? "处理中…" : "批准"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => decide(item, "reject")}
                  disabled={reviewing}
                >
                  <X />
                  拒绝
                </Button>
              </div>
              {reviewErrors[item.id] && (
                <p className="mt-2 text-sm text-conflict" role="alert">
                  {reviewErrors[item.id]}
                </p>
              )}
              <ReviewRevisionForm item={item} token={token} onCreated={addRevision} />
            </article>
          );
        })}
      </section>
      {automationApprovals.length > 0 && (
        <section className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl font-semibold">自动批准项待人工确认</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                这些关系已通过严格原文锚定并公开，但不会冒充人工核验。请对照下方原文后批量确认；
                单次最多处理 50 条。
              </p>
            </div>
            <Button type="button" disabled={busy} onClick={verifyAutomationApprovals}>
              <Check />
              人工确认本批（{Math.min(50, automationApprovals.length)}）
            </Button>
          </div>
          <div className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
            {automationApprovals.slice(0, 50).map((item) => (
              <article
                key={item.id}
                className="rounded-md border border-border bg-background/70 p-3"
              >
                <p className="text-sm font-medium">{item.claim.text.zh}</p>
                <div className="mt-2 space-y-2">
                  {item.evidenceItems.map((evidence) => (
                    <div key={evidence.id} className="text-xs text-muted-foreground">
                      {evidence.sourceExcerpt && (
                        <blockquote className="border-l-2 border-signal/40 pl-3 leading-relaxed">
                          {evidence.sourceExcerpt}
                        </blockquote>
                      )}
                      <a
                        className="mt-1 inline-block text-signal underline underline-offset-4"
                        href={evidence.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开官方原文
                      </a>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {reviewHistory.length > 0 && (
        <details className="paper-card p-5">
          <summary className="cursor-pointer font-serif text-xl font-semibold">
            已处理审核历史（{reviewHistory.length}）
          </summary>
          <div className="mt-4 divide-y divide-border">
            {reviewHistory.map((item) => (
              <article key={item.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
                  <div className="w-full min-w-0 flex-1 sm:w-auto">
                    <div className="break-all font-mono text-xs text-muted-foreground">
                      {item.id}
                    </div>
                    <p className="mt-2 text-sm font-medium">{item.claim.text.zh}</p>
                    {(item.reasonNote || item.reviewReason) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.reasonCategory
                          ? `${reviewReasonCategoryLabels[item.reasonCategory]} · `
                          : item.status === "rejected"
                            ? "历史未分类 · "
                            : ""}
                        {item.reasonNote ?? item.reviewReason}
                      </p>
                    )}
                  </div>
                  <span className="whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-xs">
                    {item.lifecycleStatus === "retracted"
                      ? "已撤回"
                      : item.status === "approved"
                        ? item.lifecycleStatus === "superseded"
                          ? "已替代"
                          : item.lifecycleStatus === "historical"
                            ? item.publicationAction === "merged-evidence"
                              ? "已并入证据"
                              : "历史记录"
                            : "已批准 · 当前公开"
                        : "已拒绝"}
                    {item.reviewMethod === "automation"
                      ? " · 自动批准"
                      : item.reviewMethod === "human"
                        ? " · 人工审核"
                        : " · 历史记录"}
                  </span>
                </div>
                <ReviewRevisionForm item={item} token={token} onCreated={addRevision} />
                {item.status === "approved" &&
                  item.publicationAction !== "merged-evidence" &&
                  (item.lifecycleStatus === "current" || item.lifecycleStatus === "retracted") && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-muted-foreground">
                        {item.lifecycleStatus === "retracted" ? "恢复公开" : "撤回公开事实"}
                      </summary>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.lifecycleStatus === "retracted"
                          ? "复核原文与事实后可以恢复公开；此次处理也会保留在审计中。"
                          : "撤回后从公开页面、图谱与检索移除，来源和审核历史保留。"}
                      </p>
                      <form
                        className="mt-2 flex flex-wrap items-start gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void changePublicationState(item);
                        }}
                      >
                        <Input
                          className="min-w-0 flex-1 basis-64"
                          aria-label={`${item.lifecycleStatus === "retracted" ? "恢复" : "撤回"}原因 ${item.id}`}
                          placeholder="处理原因（必填）"
                          required
                          minLength={3}
                          maxLength={500}
                          value={publicationReasons[item.id] ?? ""}
                          onChange={(event) =>
                            setPublicationReasons((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          className="whitespace-nowrap"
                          disabled={busy}
                        >
                          {item.lifecycleStatus === "retracted" ? "恢复公开" : "撤回公开"}
                        </Button>
                      </form>
                      {reviewErrors[item.id] && (
                        <p role="alert" className="mt-2 text-xs text-destructive">
                          {reviewErrors[item.id]}
                        </p>
                      )}
                    </details>
                  )}
              </article>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
