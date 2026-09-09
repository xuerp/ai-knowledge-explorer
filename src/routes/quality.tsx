import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
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
      <main className="page-container pb-16 pt-10 md:pt-14">
        <header className="border-b border-border pb-10">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-signal">
            <BarChart3 className="h-4 w-4" /> Quality Dashboard
          </div>
          <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                {t("数据质量与检索评估", "Data quality and retrieval evaluation")}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-ink-soft">
                {t(
                  "业务数据指标来自当前知识快照，评估指标来自固定 Golden Set。两类数字采用不同更新节奏，不用高频任务重复消耗检索资源。",
                  "Business metrics come from the current knowledge snapshot; evaluation metrics come from a fixed Golden Set. Their refresh cadences stay separate to avoid wasteful high-frequency evaluation.",
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              disabled={metrics.isFetching}
              onClick={() => void metrics.refetch()}
            >
              <RefreshCw className={`h-4 w-4 ${metrics.isFetching ? "animate-spin" : ""}`} />
              {t("刷新", "Refresh")}
            </Button>
          </div>
        </header>

        {metrics.isLoading && <QualityLoading label={t("正在读取质量指标…", "Loading metrics…")} />}
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
          <div className="space-y-8 py-8">
            {metrics.data.dataMode === "demo" && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p>
                  {t(
                    "当前仍为演示数据模式。以下数字描述已核验快照和固定评估，不代表全网实时覆盖，也不用于强行宣称 Live Ready。",
                    "The product remains in demo-data mode. These figures describe the verified snapshot and fixed evaluation; they do not claim real-time global coverage or force a Live Ready conclusion.",
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
                title={t("固定集检索评估", "Fixed-set retrieval evaluation")}
                description={t(
                  "仅在每日评估窗口或检索策略变更后更新，不挂载到 30 分钟高频 Cron。",
                  "Updated only in a daily evaluation window or after retrieval changes; never attached to the 30-minute high-frequency cron.",
                )}
                updatedAt={formatDateTime(metrics.data.evaluation.updatedAt, lang)}
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  label="Recall@8"
                  value={formatPercent(metrics.data.evaluation.recallAt8)}
                />
                <MetricCard
                  label="Precision@8"
                  value={formatPercent(metrics.data.evaluation.precisionAt8)}
                />
                <MetricCard
                  label="Entity Recall@8"
                  value={formatPercent(metrics.data.evaluation.entityRecallAt8)}
                />
                <MetricCard
                  label={t("通过率", "Pass ratio")}
                  value={formatPercent(metrics.data.evaluation.passRatio)}
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
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {t(
                  "这些结果绑定固定快照和固定问题集；指标目标是验证对象，不是必须达成的 KPI。",
                  "These results are bound to a fixed snapshot and question set. Targets are evaluation subjects, not mandatory KPIs.",
                )}
              </p>
            </section>
          </div>
        )}
      </main>
    </AppShell>
  );
}

function SectionHeading({
  id,
  icon,
  title,
  description,
  updatedAt,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  updatedAt: string;
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
        <Clock3 className="h-3.5 w-3.5" /> {updatedAt}
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
