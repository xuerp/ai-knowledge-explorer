import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bell, Clock3, GitBranch, Radar, ShieldCheck, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DemoBadge } from "@/components/common";
import { DataFreshnessBadge, DataStatePanel } from "@/components/data-state";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";
import type { ChangeEvent, Entity } from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar · 你关注的 AI，最近发生了什么" },
      {
        name: "description",
        content: "可信、可追溯、具有时间维度的 AI 技术知识图谱。",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "首页数据加载失败" : "正在加载首页",
            snapshotQuery.error ? "Home data failed to load" : "Loading home",
          )}
          description={t(
            "请检查连接后重试；演示数据不会冒充实时结果。",
            "Check the connection and retry. Demo data never masquerades as live data.",
          )}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }

  const snapshot = snapshotQuery.data;
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const followingIds = new Set(snapshot.following.map((item) => item.entityId));
  const related = snapshot.changes
    .filter((change) => followingIds.has(change.entityId))
    .slice(0, 4);
  const industry = snapshot.changes.slice(0, 3);
  const previewIds = snapshot.graph.nodes.slice(0, 9).map((node) => node.entityId);

  return (
    <AppShell>
      <div className="page-container pb-12 pt-9 md:pt-11">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 max-w-full">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <DemoBadge />
              <DataFreshnessBadge meta={snapshot.meta} />
            </div>
            <h1 className="max-w-3xl text-[1.75rem] font-bold leading-tight tracking-tight text-foreground md:text-4xl">
              {t("你关注的 AI，最近发生了什么", "What changed in the AI you follow")}
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("最后同步", "Last sync")} · {snapshot.meta.retrievedAt.slice(0, 16)} ·{" "}
              {t("每条结论都可追溯到证据", "Every conclusion traces back to evidence")}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            {["24 小时", "7 天", "30 天", "90 天"].map((range, index) => (
              <button
                key={range}
                type="button"
                className={`h-8 rounded-md px-3 text-xs ${
                  index === 1
                    ? "bg-signal text-signal-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </header>

        <section className="mt-8">
          <SectionTitle
            icon={<Bell className="h-4 w-4" />}
            title={t("与你相关的最新变化", "Latest changes relevant to you")}
            action={
              <Link to="/following" className="text-xs text-signal hover:underline">
                {t("管理关注", "Manage follows")} →
              </Link>
            }
          />
          <div className="space-y-3">
            {related.map((change, index) => {
              const entity = entityById.get(change.entityId);
              if (!entity) return null;
              return (
                <UpdateCard
                  key={change.id}
                  change={change}
                  entity={entity}
                  featured={index === 0}
                />
              );
            })}
          </div>
        </section>

        <section className="mt-10">
          <SectionTitle
            icon={<Sparkles className="h-4 w-4" />}
            title={t("全行业不可错过", "Industry must-reads")}
          />
          <div className="grid gap-3 md:grid-cols-3">
            {industry.map((change) => {
              const entity = entityById.get(change.entityId);
              if (!entity) return null;
              return (
                <Link
                  key={change.id}
                  to="/knowledge/model/$slug"
                  params={{ slug: entity.slug }}
                  className="paper-card group min-h-28 p-4 transition-colors hover:border-signal/40"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ChangeBadge change={change} />
                      <SourceBadge change={change} />
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-signal" />
                  </div>
                  <h3 className="text-sm font-semibold">{pick(entity.name, lang)}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {pick(change.summary, lang)}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-10">
          <SectionTitle
            icon={<GitBranch className="h-4 w-4" />}
            title={t("今日图谱变化", "Today's graph changes")}
            action={
              <span className="text-xs text-muted-foreground">
                +{snapshot.changes.length} {t("个变化事件", "change events")} · +
                {snapshot.graph.edges.length} {t("条关系", "relations")}
              </span>
            }
          />
          <div className="relative overflow-hidden rounded-xl border border-border bg-card">
            <KnowledgeGraph
              entities={snapshot.entities}
              relations={snapshot.graph.edges}
              entityIds={previewIds}
              centerId={previewIds[0]}
              height={310}
              canvasWidth={1120}
            />
            <Link
              to="/graph"
              className="absolute bottom-4 right-4 inline-flex h-9 items-center gap-2 rounded-md bg-signal px-4 text-xs font-medium text-white"
            >
              <Radar className="h-4 w-4" />
              {t("进入完整图谱", "Open full graph")}
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function SectionTitle({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <span className="text-signal">{icon}</span>
        {title}
      </h2>
      {action}
    </div>
  );
}

function UpdateCard({
  change,
  entity,
  featured,
}: {
  change: ChangeEvent;
  entity: Entity;
  featured: boolean;
}) {
  const { t, lang } = useApp();
  return (
    <article
      className={`paper-card min-w-0 overflow-hidden p-4 md:p-5 ${
        featured ? "border-signal/25" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChangeBadge change={change} />
        <SourceBadge change={change} />
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <Clock3 className="h-3 w-3" /> {change.date}
        </span>
      </div>
      <Link to="/knowledge/model/$slug" params={{ slug: entity.slug }} className="group mt-3 block">
        <h3
          className={`${featured ? "text-base" : "text-sm"} break-words font-semibold text-foreground`}
        >
          {pick(entity.name, lang)} · {pick(change.summary, lang)}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {pick(entity.summary, lang)}
        </p>
      </Link>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-verified" />
        {t(
          "来源已绑定 · 点击进入实体档案查看完整证据",
          "Sources attached · open the profile for evidence",
        )}
        <Link
          to="/knowledge/model/$slug"
          params={{ slug: entity.slug }}
          className="ml-auto text-signal hover:underline"
        >
          {t("查看详情", "Details")} →
        </Link>
      </div>
    </article>
  );
}

function ChangeBadge({ change }: { change: ChangeEvent }) {
  const { t, lang } = useApp();
  const summary = pick(change.summary, lang).toLocaleLowerCase();
  const isPrice =
    summary.includes("价格") || summary.includes("pricing") || summary.includes("cost");
  const meta = isPrice
    ? { label: t("价格变化", "Price change"), className: "bg-[#f3e8ff] text-[#7c3aed]" }
    : change.kind === "benchmark"
      ? {
          label: t("Benchmark 更新", "Benchmark update"),
          className: "bg-[#fff3e8] text-[#ea580c]",
        }
      : change.kind === "new"
        ? { label: t("新增能力", "New capability"), className: "bg-[#ecfdf5] text-[#059669]" }
        : change.kind === "rumor"
          ? { label: t("传闻", "Rumor"), className: "bg-[#f3e8ff] text-[#7c3aed]" }
          : {
              label: t("能力增强", "Capability update"),
              className: "bg-[#eff6ff] text-[#2563eb]",
            };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function SourceBadge({ change }: { change: ChangeEvent }) {
  const { t, lang } = useApp();
  const summary = pick(change.summary, lang).toLocaleLowerCase();
  const isCommunity =
    summary.includes("社区") || summary.includes("community") || summary.includes("hugging face");
  const meta = isCommunity
    ? {
        label: t("社区验证", "Community verified"),
        className: "bg-[#fffbeb] text-[#d97706]",
      }
    : change.confidence === "verified"
      ? { label: t("官方确认", "Official"), className: "bg-[#eef2ff] text-[#4f46e5]" }
      : change.confidence === "inferred"
        ? { label: t("独立验证", "Independent"), className: "bg-[#eff6ff] text-[#2563eb]" }
        : {
            label: t("社区报告", "Community report"),
            className: "bg-[#fffbeb] text-[#d97706]",
          };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
