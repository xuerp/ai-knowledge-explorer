import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Activity, Clock3, Database, Info, RefreshCw, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { DemoBadge, WorkspaceHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApp } from "@/lib/app-state";
import { getQualityMetrics, type RetrievalEvaluation } from "@/services/quality-api";
import latestRetrievalAttempt from "../../product/retrieval-evaluation-status.json";

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
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  return (
    <AppShell>
      <div className="quality-page support-workspace workspace-page">
        <div className="workspace-container">
          <WorkspaceHeader
            title={t("数据质量与检索评估", "Data quality and retrieval evaluation")}
            description={t(
              "查看知识库的资料覆盖、来源情况与固定题集的检索表现。",
              "Explore knowledge coverage, sources and retrieval results on a fixed question set.",
            )}
            actions={
              <div className="flex flex-wrap items-center gap-3">
                {metrics.data && (
                  <DemoBadge
                    mode={metrics.data.dataMode}
                    updatedAt={metrics.data.business.updatedAt}
                  />
                )}
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
              </div>
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
              <section aria-labelledby="business-quality-heading">
                <SectionHeading
                  id="business-quality-heading"
                  icon={<Database className="h-5 w-5" />}
                  title={t("业务数据指标", "Business data metrics")}
                  description={t(
                    "每 5 分钟同步当前库；条目的核验日期可在来源中查看。",
                    "Syncs the current corpus every 5 minutes. Verification dates are available with each source.",
                  )}
                  updatedAt={formatDateTime(metrics.data.business.updatedAt, lang)}
                  timeLabel={t("库记录更新", "Records updated")}
                />
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <MetricCard
                    label={t("实体", "Entities")}
                    value={metrics.data.business.entityCount}
                  />
                  <MetricCard label={t("事实", "Facts")} value={metrics.data.business.claimCount} />
                  <MetricCard
                    label={t("来源", "Sources")}
                    value={metrics.data.business.evidenceCount}
                  />
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
                    label={t("来源引用完整度", "Source reference coverage")}
                    value={metrics.data.business.evidenceReferenceCoverage}
                    note={t(
                      "检查事实、关系和时间线引用的来源记录是否齐全。结论的支持程度需结合原文核对。",
                      "Checks that the sources referenced by facts, relationships and timeline entries exist. Check the original text to assess support for a conclusion.",
                    )}
                    count={
                      metrics.data.business.counts &&
                      `${metrics.data.business.counts.resolvedReferences} / ${metrics.data.business.counts.referencedContent}`
                    }
                  />
                  <ProgressMetric
                    label={t("官方来源占比", "Official-source ratio")}
                    value={metrics.data.business.officialEvidenceRatio}
                    note={t(
                      "已标记为官方发布的来源记录占全部来源的比例。",
                      "The share of all source records marked as official publications.",
                    )}
                    count={
                      metrics.data.business.counts &&
                      `${metrics.data.business.counts.officialEvidence} / ${metrics.data.business.evidenceCount}`
                    }
                  />
                  <ProgressMetric
                    label={t("有审核时间记录", "Evidence with review timestamp")}
                    value={metrics.data.business.reviewedEvidenceRatio}
                    note={t(
                      "来源中填写了审核日期的比例。日期反映记录中的审核时间。",
                      "The share of sources with a recorded review date. Dates refer to the review recorded on each source.",
                    )}
                    count={
                      metrics.data.business.counts &&
                      `${metrics.data.business.counts.evidenceWithReviewTime} / ${metrics.data.business.evidenceCount}`
                    }
                  />
                  <ProgressMetric
                    label={t("180 天内采集", "Collected within 180 days")}
                    value={metrics.data.business.freshEvidenceRatio}
                    note={t(
                      "按来源的采集日期计算。具体信息的有效期请查看原文与适用条件。",
                      "Calculated from source collection dates. Check the original source and conditions for current validity.",
                    )}
                    count={
                      metrics.data.business.counts &&
                      `${metrics.data.business.counts.recentlyCollectedEvidence} / ${metrics.data.business.evidenceCount}`
                    }
                  />
                  <ProgressMetric
                    label={t("标记为已核验的内容", "Content marked verified")}
                    value={metrics.data.business.verifiedContentRatio}
                    note={t(
                      "事实、关系和时间线中标记为已核验的记录比例。",
                      "The share of facts, relationships and timeline entries marked as verified.",
                    )}
                    count={
                      metrics.data.business.counts &&
                      `${metrics.data.business.counts.verifiedContent} / ${metrics.data.business.counts.referencedContent}`
                    }
                  />
                  <MetricCard
                    label={t("核心对象待补关系", "Core relationship gaps")}
                    value={metrics.data.business.coreRelationDeficit}
                    note={t(
                      "核心模型家族、Agent 和框架距每个 5 条有来源关系的缺口之和。",
                      "Total shortfall from 5 grounded relations per core model family, agent and framework.",
                    )}
                  />
                </div>
              </section>

              {latestRetrievalAttempt.status === "failed" && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm leading-6">
                  <h2 className="font-semibold">
                    {t("本次 Hybrid 复测未完成", "This hybrid evaluation did not complete")}
                  </h2>
                  <p className="mt-2">
                    {t(
                      `${formatDateTime(latestRetrievalAttempt.observedAt, lang)}，评估服务返回 ${latestRetrievalAttempt.failureCode}，已停止且未重试。完成 ${latestRetrievalAttempt.completedSamples} / ${latestRetrievalAttempt.sampleCount} 题。下方为已完成的全文检索基线，不能替代当前 Hybrid 的评估。`,
                      `At ${formatDateTime(latestRetrievalAttempt.observedAt, lang)}, the evaluation service returned ${latestRetrievalAttempt.failureCode}. It stopped without retrying, completing ${latestRetrievalAttempt.completedSamples} / ${latestRetrievalAttempt.sampleCount} questions. The completed lexical baseline below does not substitute for current hybrid evaluation.`,
                    )}
                  </p>
                  <a
                    className="mt-2 inline-block text-signal underline underline-offset-4"
                    href={`https://github.com/xuerp/ai-knowledge-explorer/blob/main/${latestRetrievalAttempt.artifactPath}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("查看失败记录", "View failure record")}
                  </a>
                </div>
              )}
              <EvaluationSection evaluation={metrics.data.evaluation} />
              {!!metrics.data.evaluationHistory?.length && (
                <section aria-labelledby="evaluation-history-heading">
                  <h2 className="text-xl font-semibold" id="evaluation-history-heading">
                    {t("历史评估归档", "Evaluation archive")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t(
                      "保留原始题集、快照与逐题结果。不同题集的分数不能直接比较。",
                      "Original question sets, snapshots and per-question results are retained. Scores from different sets are not directly comparable.",
                    )}
                  </p>
                  {metrics.data.evaluationHistory.map((evaluation) => (
                    <details
                      key={evaluation.artifactPath}
                      className="mt-4 rounded-lg border border-border bg-background"
                    >
                      <summary className="cursor-pointer p-5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal">{`v${evaluation.goldenSetVersion} · ${evaluation.sampleCount} ${t("题", "questions")} · ${formatDateTime(evaluation.updatedAt, lang)} · ${evaluation.retrievalMode}`}</summary>
                      <div className="border-t border-border p-5">
                        <EvaluationSection evaluation={evaluation} archived />
                      </div>
                    </details>
                  ))}
                </section>
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                {t("本次读取", "Read at")} {formatDateTime(metrics.data.generatedAt, lang)}
                {t(
                  "（北京时间）。刷新核对数据与报告状态，检索成绩在完成新一轮评估后更新。",
                  " (Asia/Shanghai). Refresh checks data and report status. Retrieval scores update after a new evaluation is completed.",
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function EvaluationSection({
  evaluation: e,
  archived = false,
}: {
  evaluation: RetrievalEvaluation;
  archived?: boolean;
}) {
  const { t, lang } = useApp();
  const scope = e.applicability;
  const matched = scope?.status === "scope-matched";
  const labels: Record<string, string> = {
    entity: t("对象事实", "Entity facts"),
    relation: t("关系", "Relations"),
    timeline: t("时间线", "Timeline"),
    comparison: t("比较", "Comparisons"),
    holdout: t("留出题", "Held-out questions"),
  };
  return (
    <section aria-label={t("检索评估报告", "Retrieval evaluation report")}>
      {!archived && (
        <SectionHeading
          id="evaluation-quality-heading"
          icon={<Activity className="h-5 w-5" />}
          title={t("已发布检索评估", "Published retrieval evaluation")}
          description={t(
            "在固定题集上检查能否找回标注事实；可展开查看计算口径、逐题结果与原始报告。",
            "Tests retrieval of annotated facts on a fixed question set. Explore the methodology, per-question results and original report below.",
          )}
          updatedAt={formatDateTime(e.updatedAt, lang)}
          timeLabel={t("实际评估", "Evaluated")}
        />
      )}
      <div className={`paper-card p-5 ${archived ? "" : "mt-5"}`}>
        <h3 className="font-semibold">
          {matched
            ? t("评估范围匹配", "Evaluation scope matches")
            : e.retrievalMode === "lexical" &&
                scope?.corpusMatches === true &&
                !scope.retrievalConfigMatches
              ? t(
                  "当前快照的全文检索基线 · 配置与线上不同",
                  "Current-corpus lexical baseline · configuration differs from the service",
                )
              : t("历史评估 · 适用于原报告快照", "Historical evaluation · original snapshot only")}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t(
            "记录本站的资料检索表现，成绩适用于报告中指定的题集与快照。",
            "Measures this site's evidence retrieval on the report's question set and snapshot.",
          )}
        </p>
        <details className="mt-4">
          <summary className="cursor-pointer py-2 text-sm font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal">
            {t("核对评估范围", "Check evaluation scope")}
          </summary>
          <dl className="mt-2 divide-y divide-border text-sm">
            <ScopeRow label={t("知识快照", "Knowledge snapshot")}>
              {scope?.corpusMatches === true
                ? t(
                    "数据内容匹配，忽略每次读取生成的时间戳。",
                    "Corpus content matches, excluding request-generated timestamps.",
                  )
                : scope?.corpusMatches === false
                  ? t(
                      "当前库已变化；下方成绩只适用于报告快照。",
                      "The current corpus has changed; scores apply only to the evaluated snapshot.",
                    )
                  : t("快照适用性尚未核实。", "Snapshot applicability is unverified.")}
            </ScopeRow>
            <ScopeRow label={t("问题标注", "Annotations")}>
              {scope?.missingExpectedClaimSampleCount != null
                ? scope.missingExpectedClaimSampleCount > 0
                  ? t(
                      `${e.sampleCount} 道题中 ${scope.missingExpectedClaimSampleCount} 道引用了当前库中缺失的事实。`,
                      `${scope.missingExpectedClaimSampleCount} of ${e.sampleCount} questions reference facts missing from the current corpus.`,
                    )
                  : t(
                      "标注事实均可找到，内容一致性见知识快照核对结果。",
                      "All annotated facts are present. The corpus comparison checks whether their content matches.",
                    )
                : t("标注核对信息不可用。", "Annotation comparison is unavailable.")}
            </ScopeRow>
            <ScopeRow label={t("检索方式", "Retrieval mode")}>
              {t("报告：", "Report: ")}
              {e.retrievalMode} · {t("当前：", "Current: ")}
              {scope?.configuredRetrievalMode ?? t("未知", "Unknown")}
              {scope?.retrievalConfigMatches
                ? t("（配置匹配）", " (configuration matches)")
                : t(
                    "（配置不同，不可替代当前方式的评估）",
                    " (different configuration; cannot substitute for current-mode evaluation)",
                  )}
            </ScopeRow>
            <ScopeRow label={t("检索代码", "Retrieval code")}>
              {scope?.implementationMatches === true
                ? t(
                    "影响检索结果的代码与评估时一致。",
                    "The code affecting retrieval matches the evaluated version.",
                  )
                : scope?.implementationMatches === false
                  ? t(
                      "检索代码已变化，需重新评估。",
                      "Retrieval code has changed; reevaluation is required.",
                    )
                  : scope?.buildMatches
                    ? t("报告提交与当前版本一致。", "Report and running build match.")
                    : t(
                        "旧报告缺少检索代码指纹，当前适用性未验证。",
                        "This older report has no retrieval-code fingerprint; applicability is unverified.",
                      )}
            </ScopeRow>
          </dl>
        </details>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Recall@8"
          value={formatPercent(e.recallAt8)}
          note={t(
            "每题命中的标注事实数 ÷ 该题全部标注事实数，再取题目平均。",
            "Per-question fraction of annotated facts retrieved, averaged across questions.",
          )}
        />
        <MetricCard
          label="Precision@8"
          value={formatPercent(e.precisionAt8)}
          note={t(
            "每题命中的标注事实数 ÷ 8，再取平均；未标注结果不计命中，不等于均无关。",
            "Annotated hits divided by 8, averaged per question. Unannotated results are not necessarily irrelevant.",
          )}
        />
        <MetricCard
          label="Entity Recall@8"
          value={formatPercent(e.entityRecallAt8)}
          note={t(
            "前 8 条结果经模型家族扩展后的对象覆盖率，不是严格版本命中率。",
            "Entity coverage after model-family expansion, not exact-version retrieval.",
          )}
        />
        <MetricCard
          label={t("标注全命中率", "All-annotation hit rate")}
          value={formatPercent(e.passRatio)}
          note={t(
            "找全该题所有标注事实的题数 ÷ 全部题数。",
            "Questions retrieving every annotated fact divided by all questions.",
          )}
        />
      </div>
      {!!e.categories && (
        <div className="mt-4 divide-y divide-border rounded-lg border border-border px-5">
          {Object.entries(e.categories).map(([category, result]) => (
            <div
              key={category}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm"
            >
              <span>
                {labels[category] ?? category} · {result.samples} {t("题", "questions")}
              </span>
              <span className="font-mono text-muted-foreground">
                Recall {formatPercent(result.recallAtK)} · {t("全命中", "All-hit")}{" "}
                {formatPercent(result.passRatio)}
              </span>
            </div>
          ))}
        </div>
      )}
      <details className="mt-4 rounded-lg border border-border bg-background">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal">
          {t("查看配置与原始报告", "View configuration and original report")}
        </summary>
        <div className="grid gap-5 border-t border-border p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail
            label="Golden Set"
            value={`v${e.goldenSetVersion} · ${e.sampleCount} ${t("题", "questions")}`}
          />
          <Detail
            label={t("检索配置", "Retrieval setup")}
            value={`${e.retrievalMode} · TopK=${e.topK}`}
          />
          <Detail
            label={t("Embedding 模型", "Embedding model")}
            value={e.embeddingModel ?? t("未启用", "Disabled")}
          />
          <Detail
            label={t("评估提交", "Evaluation commit")}
            value={e.evaluationCommit.slice(0, 12)}
            mono
          />
          <div className="min-w-0 sm:col-span-2">
            <a
              className="break-words text-signal underline underline-offset-4"
              href={`https://github.com/xuerp/ai-knowledge-explorer/blob/main/${e.artifactPath}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("查看逐题结果与失败明细", "Inspect every question and failure")}
            </a>
          </div>
          {scope?.configuredConfiguration && (
            <div className="min-w-0 sm:col-span-2">
              <Detail
                label={t("当前服务配置", "Current service configuration")}
                value={`${scope.configuredConfiguration.databaseDialect} · ${scope.configuredConfiguration.embeddingProvider} · ${scope.configuredConfiguration.embeddingModel ?? "—"} · ${scope.configuredConfiguration.embeddingDimension ? `${scope.configuredConfiguration.embeddingDimension}d` : "—"}`}
              />
            </div>
          )}
        </div>
      </details>
    </section>
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
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
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

function MetricExplanation({ label, note }: { label: string; note: string }) {
  const { t } = useApp();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(`${label}的计算口径`, `How ${label} is calculated`)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal sm:h-8 sm:w-8"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-w-[calc(100vw-2rem)] text-sm leading-6">
        <h4 className="font-semibold">{label}</h4>
        <p className="mt-2">{note}</p>
      </PopoverContent>
    </Popover>
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
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {note && <MetricExplanation label={label} note={note} />}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function ProgressMetric({
  label,
  value,
  note,
  count,
}: {
  label: string;
  value: number;
  note?: string;
  count?: string | null;
}) {
  const percent = Math.round(value * 1000) / 10;
  return (
    <div className="paper-card p-5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-1 font-medium">
          {label}
          {note && <MetricExplanation label={label} note={note} />}
        </span>
        <span className="font-mono">{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-signal"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      {count && <p className="mt-3 font-mono text-xs text-muted-foreground">{count}</p>}
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
