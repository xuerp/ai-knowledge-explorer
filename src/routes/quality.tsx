import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Activity, Clock3, Database, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-state";
import { getQualityMetrics } from "@/services/quality-api";

export const Route = createFileRoute("/quality")({
  head: () => ({
    meta: [
      { title: "数据质量看板 · AI Radar" },
      {
        name: "description",
        content: "查看 AI Radar 的业务数据质量与固定检索评估指标，并区分两类指标的更新时间。",
      },
    ],
  }),
  component: QualityPage,
});

function QualityPage() {
  const { t, lang } = useApp();
  const metrics = useQuery({
    queryKey: ["quality", "metrics"],
    queryFn: ({ signal }) => getQualityMetrics(signal),
    staleTime: 60_000,
  });

  return (
    <AppShell>
      <div className="quality-page support-workspace workspace-page">
        <div className="workspace-container">
          <WorkspaceHeader
            title={t("数据质量与检索评估", "Data quality and retrieval evaluation")}
            description={t(
              "业务指标反映当前知识库；检索报告记录固定问题集在当时快照上的表现。刷新会核对报告的适用范围，不会重新运行评估。",
              "Business metrics describe the current knowledge base. Retrieval reports measure a fixed question set against its original snapshot. Refresh checks applicability without rerunning evaluation.",
            )}
            actions={
              <Button
                type="button"
                variant="outline"
                className="w-fit gap-2"
                disabled={metrics.isFetching}
                onClick={() => void metrics.refetch()}
              >
                <RefreshCw className={`h-4 w-4 ${metrics.isFetching ? "animate-spin" : ""}`} />
                {t("刷新数据状态", "Refresh data status")}
              </Button>
            }
          />

          {metrics.isLoading && (
            <QualityLoading label={t("正在读取质量指标…", "Loading metrics…")} />
          )}
          {metrics.isError && (
            <div className="paper-card mt-8 border-destructive/30 p-6">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 text-destructive" />
                <div>
                  <h2 className="font-semibold">{t("质量指标暂不可用", "Metrics unavailable")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {metrics.error instanceof Error
                      ? metrics.error.message
                      : t("请稍后重试。", "Try again later.")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {metrics.data && (
            <div className="quality-page__sections">
              {metrics.data.dataMode === "demo" && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p>
                    {t(
                      "当前包含示例快照与固定评测。以下数字不代表全网实时覆盖，也不能作为正式数据验收结果。",
                      "This includes a sample snapshot and fixed evaluation. These figures do not represent real-time global coverage or formal data acceptance.",
                    )}
                  </p>
                </div>
              )}

              <section aria-labelledby="business-quality-heading">
                <SectionHeading
                  id="business-quality-heading"
                  icon={<Database className="h-5 w-5" />}
                  title={t("业务数据指标", "Business data metrics")}
                  description={t(
                    "请求时从当前知识库轻量聚合，可跟随现有数据更新周期刷新。",
                    "Aggregated cheaply from the current knowledge base and safe to refresh with the normal data cycle.",
                  )}
                  updatedAt={formatDateTime(metrics.data.business.updatedAt, lang)}
                  timeLabel={t("数据更新", "Data updated")}
                />
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <MetricCard
                    label={t("实体", "Entities")}
                    value={metrics.data.business.entityCount}
                  />
                  <MetricCard label="Claims" value={metrics.data.business.claimCount} />
                  <MetricCard label="Evidence" value={metrics.data.business.evidenceCount} />
                  <MetricCard
                    label={t("关系", "Relations")}
                    value={metrics.data.business.relationCount}
                  />
                  <MetricCard
                    label={t("时间线", "Timeline")}
                    value={metrics.data.business.timelineEntryCount}
                  />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ProgressMetric
                    label={t("Evidence 引用覆盖", "Evidence reference coverage")}
                    value={metrics.data.business.evidenceReferenceCoverage}
                  />
                  <ProgressMetric
                    label={t("官方来源占比", "Official-source ratio")}
                    value={metrics.data.business.officialEvidenceRatio}
                  />
                  <ProgressMetric
                    label={t("已审核 Evidence", "Reviewed evidence")}
                    value={metrics.data.business.reviewedEvidenceRatio}
                  />
                  <ProgressMetric
                    label={t("新鲜 Evidence", "Fresh evidence")}
                    value={metrics.data.business.freshEvidenceRatio}
                  />
                  <ProgressMetric
                    label={t("已验证内容", "Verified content")}
                    value={metrics.data.business.verifiedContentRatio}
                  />
                  <MetricCard
                    label={t("核心关系覆盖差值", "Core relation coverage delta")}
                    value={metrics.data.business.coreRelationDeficit}
                    note={t("观测值，不是发布配额", "Observed value, not a publishing quota")}
                  />
                </div>
              </section>

              <section aria-labelledby="evaluation-quality-heading">
                <SectionHeading
                  id="evaluation-quality-heading"
                  icon={<Activity className="h-5 w-5" />}
                  title={t("已发布检索评估", "Published retrieval evaluation")}
                  description={t(
                    "测试本站能否从知识库找回预先标注的事实。报告在完成评估并发布后更新。",
                    "Tests whether this site's search retrieves pre-annotated facts. Results update when a completed evaluation is published.",
                  )}
                  updatedAt={formatDateTime(metrics.data.evaluation.updatedAt, lang)}
                  timeLabel={t("评估时间", "Evaluated")}
                />
                <div className="paper-card mt-5 p-5">
                  <h3 className="font-semibold">
                    {metrics.data.evaluation.applicability?.status === "scope-matched"
                      ? t("评估范围匹配", "Evaluation scope matches")
                      : t(
                          "历史基线 · 不代表当前检索表现",
                          "Historical baseline · not current search performance",
                        )}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t(
                      "固定问题集（Golden Set）包含预期事实及其来源。这份报告评估检索结果，不评估模型能力，也不证明采集、审核与发布已完整打通。",
                      "The Golden Set defines expected facts and sources. This report evaluates retrieval, not model capability or completion of the collection, review and publishing workflow.",
                    )}
                  </p>
                  <dl className="mt-4 divide-y divide-border text-sm">
                    <ScopeRow label={t("知识快照", "Knowledge snapshot")}>
                      {metrics.data.evaluation.applicability?.corpusMatches === false
                        ? t(
                            "与评估时的快照不同，需在当前数据上重新评估。",
                            "Differs from the evaluated snapshot; reevaluation on current data is needed.",
                          )
                        : metrics.data.evaluation.applicability?.corpusMatches === true
                          ? t("与评估时的快照匹配。", "Matches the evaluated snapshot.")
                          : t(
                              "缺少快照核对信息，当前适用性未验证。",
                              "Snapshot comparison is unavailable; applicability is unverified.",
                            )}
                    </ScopeRow>
                    <ScopeRow label={t("问题标注", "Question annotations")}>
                      {metrics.data.evaluation.applicability?.missingExpectedClaimSampleCount !=
                      null
                        ? metrics.data.evaluation.applicability.missingExpectedClaimSampleCount > 0
                          ? t(
                              `${metrics.data.evaluation.sampleCount} 道题中，${metrics.data.evaluation.applicability.missingExpectedClaimSampleCount} 道引用了当前库中缺失的事实。需核验标注后再评估。`,
                              `${metrics.data.evaluation.applicability.missingExpectedClaimSampleCount} of ${metrics.data.evaluation.sampleCount} questions reference facts missing from the current corpus. Validate annotations before reevaluation.`,
                            )
                          : t(
                              "预期事实均存在；这项核对不等于通过检索评估。",
                              "Expected facts exist; this check is not a retrieval evaluation.",
                            )
                        : t(
                            "尚未核对当前库中的预期事实。",
                            "Expected facts have not been checked against the current corpus.",
                          )}
                    </ScopeRow>
                    <ScopeRow label={t("检索方式", "Retrieval mode")}>
                      {t("报告：", "Report: ")}
                      {metrics.data.evaluation.retrievalMode}
                      {metrics.data.evaluation.applicability && (
                        <>
                          {" "}
                          · {t("当前配置：", "Current configuration: ")}
                          {metrics.data.evaluation.applicability.configuredRetrievalMode}
                          {metrics.data.evaluation.applicability.retrievalConfigMatches
                            ? t("（匹配）", " (matches)")
                            : t("（配置不同）", " (different configuration)")}
                        </>
                      )}
                    </ScopeRow>
                    {metrics.data.evaluation.applicability?.buildMatches === false && (
                      <ScopeRow label={t("代码版本", "Code version")}>
                        {t(
                          "当前运行版本与报告提交未匹配。",
                          "The running build is not matched to the evaluation commit.",
                        )}
                      </ScopeRow>
                    )}
                  </dl>
                </div>
                <details className="mt-4 rounded-lg border border-border bg-background">
                  <summary className="cursor-pointer px-5 py-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal">
                    {t("查看已保存成绩与配置", "View saved results and configuration")}
                  </summary>
                  <div className="border-t border-border p-5">
                    <p className="mb-4 text-sm leading-6 text-muted-foreground">
                      {t(
                        "以下成绩仅属于上述报告及其原始快照。",
                        "These scores apply only to the report and its original snapshot.",
                      )}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <MetricCard
                        label="Recall@8"
                        value={formatPercent(metrics.data.evaluation.recallAt8)}
                        note={t(
                          "前 8 条结果找回预期事实的比例",
                          "Expected facts retrieved in the top 8 results",
                        )}
                      />
                      <MetricCard
                        label="Precision@8"
                        value={formatPercent(metrics.data.evaluation.precisionAt8)}
                        note={t(
                          "前 8 条结果中命中标注事实的比例",
                          "Annotated fact hits among the top 8 results",
                        )}
                      />
                      <MetricCard
                        label="Entity Recall@8"
                        value={formatPercent(metrics.data.evaluation.entityRecallAt8)}
                        note={t(
                          "前 8 条结果覆盖预期对象的比例",
                          "Expected entity coverage in the top 8 results",
                        )}
                      />
                      <MetricCard
                        label={t("通过率", "Pass ratio")}
                        value={formatPercent(metrics.data.evaluation.passRatio)}
                        note={t(
                          "达到该问题集判定要求的题目比例",
                          "Questions meeting this set's pass criteria",
                        )}
                      />
                    </div>
                    <div className="paper-card mt-3 grid gap-5 p-5 text-sm md:grid-cols-2 lg:grid-cols-4">
                      <Detail
                        label="Golden Set"
                        value={`v${metrics.data.evaluation.goldenSetVersion} · ${metrics.data.evaluation.sampleCount} ${t("题", "samples")}`}
                      />
                      <Detail
                        label={t("检索配置", "Retrieval setup")}
                        value={`${metrics.data.evaluation.retrievalMode} · TopK=${metrics.data.evaluation.topK}`}
                      />
                      <Detail
                        label={t("Embedding 模型", "Embedding model")}
                        value={metrics.data.evaluation.embeddingModel ?? t("未启用", "Disabled")}
                      />
                      <Detail
                        label={t("评估提交", "Evaluation commit")}
                        value={metrics.data.evaluation.evaluationCommit.slice(0, 12)}
                        mono
                      />
                    </div>
                  </div>
                </details>
              </section>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function ScopeRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7rem_1fr] sm:gap-4">
      <dt className="font-medium">{label}</dt>
      <dd className="min-w-0 leading-6 text-muted-foreground">{children}</dd>
    </div>
  );
}

function SectionHeading({
  id,
  icon,
  title,
  description,
  updatedAt,
  timeLabel,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  updatedAt: string;
  timeLabel: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold" id={id}>
          <span className="text-signal">{icon}</span> {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5 shrink-0" />
        <span>
          {timeLabel} <span className="whitespace-nowrap">{updatedAt}</span>
        </span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="paper-card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tracking-tight">{value}</div>
      {note && <div className="mt-2 text-xs leading-5 text-muted-foreground">{note}</div>}
    </div>
  );
}

function ProgressMetric({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 1000) / 10;
  return (
    <div className="paper-card p-5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono">{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-signal"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words ${mono ? "font-mono" : "font-medium"}`}>{value}</div>
    </div>
  );
}

function QualityLoading({ label }: { label: string }) {
  return (
    <div className="paper-card mt-8 flex items-center gap-3 p-6 text-sm text-muted-foreground">
      <RefreshCw className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDateTime(value: string, lang: "zh" | "en") {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
