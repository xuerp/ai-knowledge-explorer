import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

import { QualityMetric } from "./shared";

import type { ReviewViewModel } from "./review-view-model";
export function QualityPanel({ context }: { context: ReviewViewModel }) {
  const {
    activeGoldenQuestionReport,
    goldenQuestionsBusy,
    prepareRelationGap,
    runGoldenQuestions,
    user,
    workspace,
  } = context;
  return (
    <>
      {workspace.quality && !workspace.quality.liveReady && (
        <section className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-5">
          <h2 className="font-medium">正式数据验收尚未通过</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            当前 {workspace.quality.entityCount} 个实体、{workspace.quality.claimCount} 条 Claim、
            {workspace.quality.relationCount}{" "}
            条关系。当前数据可用于功能与检索验证，达到关系覆盖门槛后才能切换正式数据模式。
          </p>
          {workspace.quality.evaluationScope === "overview" && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                当前为快速质量概览；完整 RAG 黄金问题检索按需运行，不阻塞后台登录与刷新。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={goldenQuestionsBusy}
                onClick={runGoldenQuestions}
              >
                <RefreshCw
                  className={`mr-2 h-3.5 w-3.5 ${goldenQuestionsBusy ? "animate-spin" : ""}`}
                />
                {goldenQuestionsBusy ? "正在运行完整评测" : "运行完整 RAG Golden"}
              </Button>
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-background/60 p-3 text-sm">
              <div className="font-medium">Claim 审核进度</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {workspace.quality.claimCount}/{workspace.quality.claimsRequired}
                ，还需审核并发布 {workspace.quality.claimsRemaining} 条。
              </p>
            </div>
            <div className="rounded-md border border-border bg-background/60 p-3 text-sm">
              <div className="font-medium">核心关系覆盖</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {workspace.quality.coreEntitiesBelowFiveRelations.length} 个核心实体尚未达到 5
                条可解释关系，合计还缺 {workspace.quality.coreRelationDeficit} 条关系连接。
              </p>
            </div>
          </div>
          {activeGoldenQuestionReport && (
            <div className="mt-3 rounded-md border border-border bg-background/60 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">黄金问题证据可回答性</div>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    (activeGoldenQuestionReport.ragReady ?? activeGoldenQuestionReport.ready)
                      ? "bg-verified/10 text-verified"
                      : "bg-conflict/10 text-conflict"
                  }`}
                >
                  {activeGoldenQuestionReport.passed}/{activeGoldenQuestionReport.total} ·{" "}
                  {Math.round(activeGoldenQuestionReport.passRatio * 100)}%
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                自动核验实体解析、带来源关系、时间证据和最短路径；正式要求 ≥{" "}
                {Math.round(activeGoldenQuestionReport.requiredRatio * 100)}%。
              </p>
              {activeGoldenQuestionReport.retrievalPassRatio !== undefined && (
                <p className="mt-1 text-xs text-muted-foreground">
                  检索通过率：
                  {Math.round(activeGoldenQuestionReport.retrievalPassRatio * 100)}% · RAG 门禁：
                  {activeGoldenQuestionReport.ragReady ? "通过" : "未通过"}
                </p>
              )}
              {activeGoldenQuestionReport.ragMetrics && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    {
                      label: "实体 Recall@8",
                      value: activeGoldenQuestionReport.ragMetrics.entityRecallAt8,
                    },
                    {
                      label: "Claim Recall@8",
                      value: activeGoldenQuestionReport.ragMetrics.claimRecallAt8,
                    },
                    {
                      label: "引用覆盖",
                      value: activeGoldenQuestionReport.ragMetrics.citationCoverage,
                    },
                    {
                      label: "官方来源",
                      value: activeGoldenQuestionReport.ragMetrics.officialSourceRatio,
                    },
                    {
                      label: "时间准确",
                      value: activeGoldenQuestionReport.ragMetrics.temporalAccuracy,
                    },
                    {
                      label: "拒答准确",
                      value: activeGoldenQuestionReport.ragMetrics.refusalAccuracy,
                    },
                    {
                      label: "生命周期精度",
                      value: activeGoldenQuestionReport.ragMetrics.lifecyclePrecision,
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded border border-border p-2 text-xs">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="mt-1 font-medium">{Math.round(value * 100)}%</div>
                    </div>
                  ))}
                </div>
              )}
              {activeGoldenQuestionReport.results.some(
                (result) => !result.passed || result.retrievalPassed === false,
              ) && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium">查看未通过问题</summary>
                  <div className="mt-2 space-y-2">
                    {activeGoldenQuestionReport.results
                      .filter((result) => !result.passed || result.retrievalPassed === false)
                      .map((result) => (
                        <div key={result.id} className="rounded border border-border p-2 text-xs">
                          <div className="font-medium">
                            {result.id} · {result.question}
                          </div>
                          <p className="mt-1 text-muted-foreground">{result.reason}</p>
                        </div>
                      ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {workspace.quality.issues.map((issue) => (
              <li key={issue}>· {issue}</li>
            ))}
          </ul>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <QualityMetric
              label="引用覆盖"
              value={workspace.quality.evidenceReferenceCoverage}
              threshold="目标 ≥ 98%"
            />
            <QualityMetric
              label="官方来源"
              value={workspace.quality.officialEvidenceRatio}
              threshold="目标 ≥ 60%"
            />
            <QualityMetric
              label="人工核验"
              value={workspace.quality.reviewedEvidenceRatio}
              threshold="目标 ≥ 90%"
            />
            <QualityMetric
              label="180 天新鲜度"
              value={workspace.quality.freshEvidenceRatio}
              threshold="目标 ≥ 80%"
            />
            <QualityMetric
              label="已核验内容"
              value={workspace.quality.verifiedContentRatio}
              threshold="目标 ≥ 80%"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            当前覆盖 {workspace.quality.evidenceDomainCount} 个来源域名，
            {workspace.quality.conflictContentCount} 条未解决冲突；正式验收要求至少 8
            个来源域名且冲突为 0。
          </p>
          {workspace.quality.coreEntitiesBelowFiveRelations.length > 0 && (
            <details className="mt-3 rounded-md border border-border bg-background/60 p-3">
              <summary className="cursor-pointer text-xs font-medium">
                查看核心实体关系缺口（{workspace.quality.coreEntitiesBelowFiveRelations.length}）
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...workspace.quality.coreEntitiesBelowFiveRelations]
                  .sort(
                    (left, right) =>
                      (workspace.quality?.coreEntityRelationCounts[left] ?? 0) -
                        (workspace.quality?.coreEntityRelationCounts[right] ?? 0) ||
                      left.localeCompare(right),
                  )
                  .map((entityId) => {
                    const count = workspace.quality?.coreEntityRelationCounts[entityId] ?? 0;
                    const label = workspace.quality?.coreEntityRelationLabels[entityId];
                    return (
                      <div
                        key={entityId}
                        className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2 text-xs"
                      >
                        <span>
                          <span className="font-medium">{label?.zh || entityId}</span>
                          <span className="ml-2 font-mono text-muted-foreground">{entityId}</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            当前 {count} · 还缺 {Math.max(0, 5 - count)}
                          </span>
                          {user.role === "admin" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => prepareRelationGap(entityId)}
                            >
                              补关系
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </details>
          )}
        </section>
      )}
    </>
  );
}
