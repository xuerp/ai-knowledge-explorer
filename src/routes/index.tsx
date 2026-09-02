import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock3, GitCompareArrows, Radar } from "lucide-react";
import { DataFreshnessBadge } from "@/components/data-state";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import type { ChangeEvent, Entity, KnowledgeSnapshot } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { pick, useApp } from "@/lib/app-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar · 追踪 AI 模型演进" },
      {
        name: "description",
        content: "追踪主流 AI 模型的更新动态、发展脉络与版本对比。",
      },
    ],
  }),
  component: HomePage,
});

const CORE_ENTITY_SLUGS = [
  "gpt",
  "claude",
  "gemini",
  "deepseek",
  "qwen",
  "doubao",
  "mcp",
  "cursor",
];

function HomePage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const snapshot = snapshotQuery.data ?? DEMO_KNOWLEDGE_SNAPSHOT;
  const showingBundledSnapshot = !snapshotQuery.data;
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const latestChanges = snapshot.changes.slice(0, 8);
  const coreEntities = CORE_ENTITY_SLUGS.map((slug) =>
    snapshot.entities.find((entity) => entity.slug === slug),
  )
    .filter((entity): entity is Entity => Boolean(entity))
    .slice(0, 12);

  return (
    <AppShell>
      <main className="page-container min-w-0 overflow-hidden pb-16 pt-9 md:pt-14">
        {/* Hero */}
        <section className="border-b border-border pb-12">
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-signal">
              <Radar className="h-4 w-4" /> AI RADAR
            </span>
            <DataFreshnessBadge meta={snapshot.meta} />
          </div>
          <h1 className="max-w-4xl break-words text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
            {t("追踪主流 AI 模型的演进与对比", "Track AI model evolution and comparison")}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft md:text-lg">
            {t(
              "查看 GPT、Claude、Gemini 等模型的更新动态、版本迭代时间线，以及多维度对比。",
              "Follow GPT, Claude, Gemini updates, version timelines, and multi-dimensional comparisons.",
            )}
          </p>
          <div className="mt-6 flex min-w-0 flex-wrap gap-3">
            <a
              href="#latest"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-signal px-5 text-sm font-medium text-signal-foreground hover:opacity-90"
            >
              {t("最新动态", "Latest updates")} <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              to="/compare"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-5 text-sm font-medium hover:border-signal/40"
            >
              {t("对比模型", "Compare models")} <GitCompareArrows className="h-4 w-4" />
            </Link>
          </div>
        </section>

        {showingBundledSnapshot && (
          <div className="mt-5 rounded-md border border-signal/20 bg-accent/60 px-4 py-3 text-xs leading-6 text-muted-foreground">
            {t(
              snapshotQuery.error
                ? "实时接口暂时不可用，当前显示演示数据。"
                : "实时接口连接中，当前显示演示数据。",
              snapshotQuery.error
                ? "Live API unavailable, showing demo data."
                : "Live API connecting, showing demo data.",
            )}
          </div>
        )}

        {/* 最新变化 */}
        <section id="latest" className="scroll-mt-20 pt-12">
          <div className="mb-5">
            <div className="text-xs font-medium uppercase tracking-widest text-signal">
              {t("最新动态", "Latest updates")}
            </div>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
              {t("最近更新", "Recent changes")}
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {latestChanges.map((change) => {
              const entity = entityById.get(change.entityId);
              if (!entity) return null;
              return (
                <ChangeCard key={change.id} change={change} entity={entity} snapshot={snapshot} />
              );
            })}
          </div>
        </section>

        {/* 核心模型 */}
        <section className="pt-14">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-signal">
                {t("核心模型", "Core models")}
              </div>
              <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
                {t("查看完整发展脉络", "View full evolution")}
              </h2>
            </div>
            <Link to="/knowledge" className="text-sm text-signal hover:underline">
              {t("浏览全部", "Browse all")} →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {coreEntities.map((entity) => {
              const latest = snapshot.changes.find((change) => change.entityId === entity.id);
              const timelineCount = snapshot.timeline[entity.id]?.length || 0;
              return (
                <Link
                  key={entity.id}
                  to="/knowledge/$type/$slug"
                  params={{ type: entity.type, slug: entity.slug }}
                  className="paper-card group min-h-36 p-5 transition-colors hover:border-signal/40"
                >
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
                    <span>{entity.type}</span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:text-signal" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{pick(entity.name, lang)}</h3>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-soft">
                    {latest ? pick(latest.summary, lang) : pick(entity.summary, lang)}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" /> {entity.lastUpdatedAt}
                    </span>
                    {timelineCount > 0 && (
                      <span className="font-medium">
                        {timelineCount} {t("个版本", "versions")}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function ChangeCard({
  change,
  entity,
  snapshot,
}: {
  change: ChangeEvent;
  entity: Entity;
  snapshot: KnowledgeSnapshot;
}) {
  const { t, lang } = useApp();
  const sources = change.sourceIds
    ?.map((id) => snapshot.evidence.find((source) => source.id === id))
    .filter((source): source is NonNullable<typeof source> => Boolean(source));

  return (
    <Link
      to="/knowledge/$type/$slug"
      params={{ type: entity.type, slug: entity.slug }}
      className="paper-card group p-5 transition-colors hover:border-signal/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{entity.type}</div>
          <h3 className="mt-1 font-semibold group-hover:text-signal">{pick(entity.name, lang)}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{pick(change.summary, lang)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          <span className="font-mono">{change.date}</span>
          {sources && sources.length > 0 && (
            <span className="text-[11px]">
              {sources.length} {t("来源", "sources")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
