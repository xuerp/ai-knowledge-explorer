import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Eye,
  FileDiff,
  FileSearch,
  GitMerge,
  LockKeyhole,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfidenceChip, DemoBadge } from "@/components/common";
import { DataFreshnessBadge, DataStatePanel } from "@/components/data-state";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useApp, pick } from "@/lib/app-state";
import type { Evidence, KnowledgeSnapshot, ReviewCandidate, SyncRun } from "@/domain/types";
import { reviewReasonCategoryLabels } from "@/domain/review-decision";
import { getReviewStats, type ReviewStats } from "@/services/review-stats-api";

export const Route = createFileRoute("/admin/review-demo")({
  head: () => ({
    meta: [
      { title: "只读审核后台 · AI Radar" },
      {
        name: "description",
        content: "展示来源、同步、候选知识与人工审核如何构成 AI Radar 的可信数据闭环。",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ReviewDemoPage,
});

type AdminView = "queue" | "sources" | "runs";

function ReviewDemoPage() {
  const { t } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const statsQuery = useQuery({
    queryKey: ["review", "stats"],
    queryFn: ({ signal }) => getReviewStats(signal),
    staleTime: 60_000,
  });
  const [view, setView] = useState<AdminView>("queue");

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "审核数据加载失败" : "正在加载审核数据",
            snapshotQuery.error ? "Review data failed to load" : "Loading review data",
          )}
          description={t(
            "审核后台不会在数据缺失时展示伪造的运行状态。",
            "The review console never fabricates operational status when data is unavailable.",
          )}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }

  const snapshot = snapshotQuery.data;
  const verifiedSources = snapshot.evidence.filter((source) => source.verifiedAt).length;
  const conflictCandidates = snapshot.reviewCandidates.filter(
    (candidate) =>
      candidate.claim.confidence === "conflict" || candidate.status === "needs-more-evidence",
  ).length;

  return (
    <AppShell>
      <main className="min-h-[calc(100vh-3.5rem)] bg-background">
        <header className="border-b border-border bg-card/40">
          <div className="mx-auto max-w-7xl px-4 py-7 md:px-6 md:py-9">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-3xl">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-inferred/40 bg-inferred/10 px-2.5 py-1 text-xs font-medium text-inferred">
                    <Eye className="h-3.5 w-3.5" />
                    {t("只读演示后台", "Read-only demo console")}
                  </span>
                  <DemoBadge />
                  <DataFreshnessBadge meta={snapshot.meta} />
                </div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  {t("数据生产与审核", "Data production & review")}
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
                  {t(
                    "这里展示一条知识如何从来源进入候选队列，经过去重、冲突检测和人工核验后才发布到正式图谱。演示后台不提供抓取、批准、拒绝、删除或发布操作。",
                    "See how knowledge moves from sources into a candidate queue, through deduplication, conflict detection, and human review before publication. This demo exposes no crawl, approve, reject, delete, or publish actions.",
                  )}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <LockKeyhole className="h-4 w-4 text-signal" />
                  {t("权限边界", "Permission boundary")}
                </div>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  {t(
                    "所有写操作均被移除；此页面只读取当前知识快照。",
                    "All write actions are removed; this page only reads the current knowledge snapshot.",
                  )}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 md:px-6">
          <section aria-label={t("审核概览", "Review overview")}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<Database className="h-4 w-4" />}
                label={t("来源", "Sources")}
                value={snapshot.evidence.length}
                detail={t(
                  `${verifiedSources} 个已完成核验`,
                  `${verifiedSources} have been verified`,
                )}
              />
              <MetricCard
                icon={<RefreshCw className="h-4 w-4" />}
                label={t("最近同步", "Sync runs")}
                value={snapshot.syncRuns.length}
                detail={t("保留每次任务的处理结果", "Each run preserves its outcome")}
              />
              <MetricCard
                icon={<FileSearch className="h-4 w-4" />}
                label={t("待审核候选", "Review candidates")}
                value={snapshot.reviewCandidates.length}
                detail={t("尚未进入正式图谱", "Not yet in the published graph")}
              />
              <MetricCard
                icon={<AlertTriangle className="h-4 w-4" />}
                label={t("需补充证据", "Needs evidence")}
                value={conflictCandidates}
                detail={t("优先处理低置信与冲突", "Low-confidence and conflicts first")}
              />
            </div>
          </section>

          <ReviewStatistics
            stats={statsQuery.data}
            loading={statsQuery.isLoading}
            error={statsQuery.isError}
            onRetry={() => void statsQuery.refetch()}
          />

          <Pipeline />

          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-widest text-signal">
                  {t("治理工作台", "Governance workspace")}
                </div>
                <h2 className="mt-1 font-serif text-2xl font-semibold text-foreground">
                  {t("可追溯的审核记录", "Traceable review records")}
                </h2>
              </div>
              <div className="inline-flex rounded-lg border border-border bg-card p-1">
                <ViewButton
                  active={view === "queue"}
                  onClick={() => setView("queue")}
                  label={t("候选队列", "Queue")}
                />
                <ViewButton
                  active={view === "sources"}
                  onClick={() => setView("sources")}
                  label={t("信源", "Sources")}
                />
                <ViewButton
                  active={view === "runs"}
                  onClick={() => setView("runs")}
                  label={t("同步运行", "Sync runs")}
                />
              </div>
            </div>

            {view === "queue" && (
              <ReviewQueue candidates={snapshot.reviewCandidates} snapshot={snapshot} />
            )}
            {view === "sources" && (
              <SourceHealth sources={snapshot.evidence} runs={snapshot.syncRuns} />
            )}
            {view === "runs" && (
              <SyncHistory runs={snapshot.syncRuns} sources={snapshot.evidence} />
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function ReviewStatistics({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats?: ReviewStats;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t, lang } = useApp();
  const number = new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US");
  const percent = new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  });

  if (!stats) {
    return (
      <section className="paper-card p-5" aria-label={t("审核统计", "Review statistics")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-signal">
              {t("真实审核审计", "Live review audit")}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {loading
                ? t("正在读取审核统计…", "Loading review statistics…")
                : t(
                    "审核统计当前不可用；页面不会用演示数字替代。",
                    "Review statistics are unavailable; no demo values are substituted.",
                  )}
            </p>
          </div>
          {error && (
            <button className="text-sm text-signal underline underline-offset-4" onClick={onRetry}>
              {t("重试", "Retry")}
            </button>
          )}
        </div>
      </section>
    );
  }

  const duration =
    stats.averageReviewSeconds == null
      ? t("暂无", "N/A")
      : stats.averageReviewSeconds < 60
        ? t(
            `${Math.round(stats.averageReviewSeconds)} 秒`,
            `${Math.round(stats.averageReviewSeconds)} sec`,
          )
        : t(
            `${(stats.averageReviewSeconds / 60).toFixed(1)} 分钟`,
            `${(stats.averageReviewSeconds / 60).toFixed(1)} min`,
          );

  return (
    <section className="paper-card p-5" aria-labelledby="review-stats-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-widest text-signal">
            {t("真实审核审计", "Live review audit")}
          </div>
          <h2 id="review-stats-heading" className="mt-1 font-serif text-xl font-semibold">
            {t("审核效率与拒绝原因", "Review outcomes and rejection reasons")}
          </h2>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {t(
            "仅公开聚合指标，不包含审核员身份或个别备注。历史拒绝不会被猜测分类。",
            "Only aggregate metrics are public; reviewer identity and individual notes are excluded. Historical rejections are never guessed into categories.",
          )}
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatValue label={t("已审核", "Reviewed")} value={number.format(stats.reviewedCount)} />
        <StatValue
          label={t("批准率", "Approval rate")}
          value={percent.format(stats.approvalRate)}
        />
        <StatValue
          label={t("拒绝率", "Rejection rate")}
          value={percent.format(stats.rejectionRate)}
        />
        <StatValue label={t("平均审核时长", "Average review time")} value={duration} />
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("拒绝原因分布", "Rejection reason distribution")}
        </div>
        {stats.rejectionReasons.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.rejectionReasons.map((reason) => (
              <span
                key={reason.category}
                className="rounded-full border border-border px-3 py-1.5 text-xs"
              >
                {reason.category === "uncategorized"
                  ? t("历史未分类", "Historical uncategorized")
                  : reviewReasonCategoryLabels[reason.category]}
                {" · "}
                {number.format(reason.count)} ({percent.format(reason.ratio)})
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("暂无拒绝记录。", "No rejected reviews yet.")}
          </p>
        )}
      </div>
    </section>
  );
}

function StatValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 font-serif text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="paper-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span className="text-signal">{icon}</span>
        {label}
      </div>
      <div className="mt-3 font-serif text-3xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Pipeline() {
  const { t } = useApp();
  const stages = [
    {
      icon: <ScanSearch className="h-4 w-4" />,
      title: t("采集", "Collect"),
      detail: t("官方页面、GitHub、论文与评测", "Official pages, GitHub, papers, benchmarks"),
    },
    {
      icon: <FileDiff className="h-4 w-4" />,
      title: t("变化检测", "Diff"),
      detail: t("规范化 URL、内容哈希与快照差异", "Canonical URLs, hashes, snapshot changes"),
    },
    {
      icon: <GitMerge className="h-4 w-4" />,
      title: t("抽取与消歧", "Extract"),
      detail: t("实体、Claim、关系与别名合并", "Entities, claims, edges, alias resolution"),
    },
    {
      icon: <AlertTriangle className="h-4 w-4" />,
      title: t("冲突检测", "Detect"),
      detail: t("与已发布知识进行证据对照", "Compare evidence with published knowledge"),
    },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      title: t("人工审核", "Review"),
      detail: t("确认、修正、拒绝或要求补充证据", "Confirm, edit, reject, or request evidence"),
    },
    {
      icon: <CheckCircle2 className="h-4 w-4" />,
      title: t("发布", "Publish"),
      detail: t("写入正式图谱、时间线与通知", "Update graph, timeline, and notifications"),
    },
  ];
  return (
    <section className="paper-card p-5" aria-labelledby="pipeline-heading">
      <div className="mb-4">
        <div className="text-xs font-medium uppercase tracking-widest text-signal">
          {t("半自动可信闭环", "Human-in-the-loop trust cycle")}
        </div>
        <h2 id="pipeline-heading" className="mt-1 font-serif text-xl font-semibold text-foreground">
          {t("来源如何进入正式图谱", "How a source enters the published graph")}
        </h2>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {stages.map((stage, index) => (
          <li
            key={stage.title}
            className="relative rounded-lg border border-border bg-background p-3"
          >
            <div className="flex items-center justify-between">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-signal/10 text-signal">
                {stage.icon}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">{stage.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stage.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ViewButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 rounded-md px-3 text-xs ${
        active ? "bg-signal text-signal-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ReviewQueue({
  candidates,
  snapshot,
}: {
  candidates: ReviewCandidate[];
  snapshot: KnowledgeSnapshot;
}) {
  const { t, lang } = useApp();
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const evidenceById = new Map(snapshot.evidence.map((source) => [source.id, source]));

  if (!candidates.length) {
    return (
      <div className="paper-card p-8 text-center text-sm text-muted-foreground">
        {t("当前没有待审核候选。", "There are no review candidates.")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {candidates.map((candidate) => {
        const entity = candidate.entityId ? entityById.get(candidate.entityId) : undefined;
        const sources = candidate.evidenceIds
          .map((id) => evidenceById.get(id))
          .filter((source): source is Evidence => Boolean(source));
        return (
          <article key={candidate.id} className="paper-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/35 px-5 py-3">
              <span className="font-mono text-xs text-muted-foreground">{candidate.id}</span>
              <span className="chip">
                {entity ? pick(entity.name, lang) : t("未绑定实体", "Unresolved entity")}
              </span>
              <ConfidenceChip level={candidate.claim.confidence} />
              <span className="ml-auto text-xs text-muted-foreground">
                {t("进入队列", "Queued")} {candidate.createdAt.slice(0, 10)}
              </span>
            </div>
            <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("候选 Claim", "Candidate claim")}
                </div>
                <p className="mt-2 font-serif text-xl leading-relaxed text-foreground">
                  {pick(candidate.claim.text, lang)}
                </p>
                <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                  <MetaField
                    label={t("事实有效期", "Valid time")}
                    value={
                      candidate.claim.validFrom
                        ? `${candidate.claim.validFrom} → ${candidate.claim.validTo ?? t("当前", "present")}`
                        : t("候选未提供", "Not supplied")
                    }
                  />
                  <MetaField
                    label={t("系统观察时间", "Observed time")}
                    value={candidate.claim.observedAt ?? candidate.claim.updatedAt}
                  />
                  <MetaField
                    label={t("审核状态", "Review status")}
                    value={t("需要更多证据", "Needs more evidence")}
                    alert
                  />
                </dl>
                <div className="mt-5 rounded-lg border border-conflict/30 bg-conflict/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-conflict">
                    <AlertTriangle className="h-4 w-4" />
                    {t("风险说明", "Risk explanation")}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t(
                      "当前证据来自社区讨论，尚无独立或官方来源交叉验证。候选不会自动发布，也不会覆盖现有知识。",
                      "Current evidence comes from community discussion without independent or official corroboration. The candidate cannot auto-publish or overwrite existing knowledge.",
                    )}
                  </p>
                </div>
              </div>
              <aside>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("证据包", "Evidence bundle")} · {sources.length}
                </div>
                <div className="space-y-2">
                  {sources.map((source) => (
                    <SourceEvidence key={source.id} source={source} />
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <LockKeyhole className="h-4 w-4 shrink-0" />
                  {t(
                    "演示模式仅展示审核依据，不提供处置按钮。",
                    "Demo mode presents review evidence without action controls.",
                  )}
                </div>
              </aside>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MetaField({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-medium ${alert ? "text-conflict" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}

function SourceEvidence({ source }: { source: Evidence }) {
  const { t, lang } = useApp();
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border border-border p-3 transition-colors hover:border-signal/50 hover:bg-accent/40"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{pick(source.title, lang)}</span>
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </span>
      <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{source.publisher}</span>
        <span>
          {t("发布", "Published")} {source.publishedAt}
        </span>
        <span>
          {t("采集", "Collected")} {source.collectedAt}
        </span>
      </span>
    </a>
  );
}

function SourceHealth({ sources, runs }: { sources: Evidence[]; runs: SyncRun[] }) {
  const { t, lang } = useApp();
  const latestRunBySource = useMemo(() => {
    const map = new Map<string, SyncRun>();
    runs.forEach((run) => {
      const current = map.get(run.sourceId);
      if (!current || run.startedAt > current.startedAt) map.set(run.sourceId, run);
    });
    return map;
  }, [runs]);

  return (
    <div className="paper-card overflow-x-auto">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="border-b border-border bg-muted/35 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t("信源", "Source")}</th>
            <th className="px-4 py-3 font-medium">{t("类型", "Type")}</th>
            <th className="px-4 py-3 font-medium">{t("采集时间", "Collected")}</th>
            <th className="px-4 py-3 font-medium">{t("最后核验", "Verified")}</th>
            <th className="px-4 py-3 font-medium">{t("最近同步", "Latest run")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sources.map((source) => {
            const run = latestRunBySource.get(source.id);
            return (
              <tr key={source.id}>
                <td className="px-4 py-3">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground hover:text-signal"
                  >
                    {source.publisher}
                  </a>
                  <div className="mt-0.5 max-w-sm truncate text-xs text-muted-foreground">
                    {pick(source.title, lang)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="chip">{source.type}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{source.collectedAt}</td>
                <td className="px-4 py-3">
                  {source.verifiedAt ? (
                    <span className="inline-flex items-center gap-1.5 text-verified">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {source.verifiedAt}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-inferred">
                      <Clock3 className="h-3.5 w-3.5" />
                      {t("待核验", "Pending")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {run ? (
                    <span className="inline-flex items-center gap-1.5 text-verified">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("成功", "Succeeded")}
                    </span>
                  ) : (
                    t("当前快照无记录", "No run in snapshot")
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SyncHistory({ runs, sources }: { runs: SyncRun[]; sources: Evidence[] }) {
  const { t } = useApp();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  if (!runs.length) {
    return (
      <div className="paper-card p-8 text-center text-sm text-muted-foreground">
        {t("当前快照没有同步运行记录。", "No sync runs are present in this snapshot.")}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const source = sourceById.get(run.sourceId);
        return (
          <article key={run.id} className="paper-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-verified/10 text-verified">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-foreground">{source?.publisher ?? run.sourceId}</h3>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{run.id}</p>
              </div>
              <span className="chip text-verified">{t("同步成功", "Succeeded")}</span>
            </div>
            <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-4">
              <MetaField label={t("开始", "Started")} value={run.startedAt} />
              <MetaField
                label={t("结束", "Finished")}
                value={run.finishedAt ?? t("运行中", "Running")}
              />
              <MetaField label={t("文档数", "Documents")} value={String(run.documentsSeen)} />
              <MetaField
                label={t("新增候选", "Candidates")}
                value={String(run.candidatesCreated)}
              />
            </dl>
          </article>
        );
      })}
    </div>
  );
}
