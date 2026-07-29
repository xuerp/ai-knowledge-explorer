import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  GitBranch,
  Layers3,
  MapPin,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfidenceChip, DemoBadge, SectionHeading, SourceRow } from "@/components/common";
import { ENTITY_TYPE_LABELS, RELATION_LABELS } from "@/domain/labels";
import type { Entity, EntityType, KnowledgeSnapshot } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";
import { knowledgeRepository } from "@/services/knowledge-repository";

const ENTITY_TYPES = new Set<EntityType>([
  "model",
  "agent",
  "framework",
  "paper",
  "benchmark",
  "company",
  "dataset",
  "api",
  "tool",
  "application",
]);

export const Route = createFileRoute("/knowledge_/$type/$slug")({
  loader: async ({ params }) => {
    if (!ENTITY_TYPES.has(params.type as EntityType)) throw notFound();
    const entityType = params.type as EntityType;
    const [snapshot, entity] = await Promise.all([
      knowledgeRepository.getSnapshot(),
      knowledgeRepository.getEntityBySlug(params.slug, entityType),
    ]);
    if (!entity) throw notFound();
    return { entity, snapshot };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "实体未找到 · AI Radar" }] };
    return {
      meta: [
        { title: `${loaderData.entity.name.zh} · AI Radar` },
        { name: "description", content: loaderData.entity.summary.zh },
      ],
    };
  },
  component: GenericEntityDetail,
});

function GenericEntityDetail() {
  const { entity, snapshot } = Route.useLoaderData() as {
    entity: Entity;
    snapshot: KnowledgeSnapshot;
  };
  const { t, lang } = useApp();
  const entityById = new Map(snapshot.entities.map((item) => [item.id, item]));
  const relations = snapshot.graph.edges.filter(
    (edge) => edge.fromId === entity.id || edge.toId === entity.id,
  );
  const timeline = snapshot.timeline[entity.id] ?? [];
  const sourceIds = new Set([
    ...relations.flatMap((edge) => edge.sourceIds),
    ...timeline.flatMap((event) => event.sourceIds),
    ...(entity.metrics ?? []).flatMap((metric) => metric.sourceIds ?? []),
  ]);
  const sources = snapshot.evidence.filter((source) => sourceIds.has(source.id));
  const origin =
    entity.origin?.zh === "中国" || entity.origin?.zh === "国内"
      ? t("国内", "Domestic")
      : entity.origin
        ? t("海外", "Overseas")
        : "—";

  return (
    <AppShell>
      <div className="page-container pb-12 pt-8 md:pt-10">
        <nav className="mb-5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Link to="/knowledge" className="hover:text-signal">
            {t("知识库", "Knowledge")}
          </Link>
          <span>/</span>
          <span>{pick(ENTITY_TYPE_LABELS[entity.type], lang)}</span>
          <span>/</span>
          <span className="text-foreground">{pick(entity.name, lang)}</span>
        </nav>

        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="chip">{pick(ENTITY_TYPE_LABELS[entity.type], lang)}</span>
              {entity.vendor && (
                <span className="chip inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {entity.vendor}
                </span>
              )}
              <DemoBadge />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              {pick(entity.name, lang)}
            </h1>
            {entity.name.zh !== entity.name.en && (
              <p className="mt-1 text-sm text-muted-foreground">{entity.name.en}</p>
            )}
            <p className="mt-4 text-base leading-relaxed text-ink-soft">
              {pick(entity.summary, lang)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/graph"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent"
            >
              <GitBranch className="h-4 w-4" />
              {t("在图谱中查看", "View in graph")}
            </Link>
            <Link
              to="/ask"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-signal px-4 text-sm font-medium text-signal-foreground hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              {t("基于证据提问", "Ask with evidence")}
            </Link>
          </div>
        </header>

        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
          <article className="paper-card p-5 md:p-6">
            <h2 className="text-lg font-semibold">{t("结构化档案", "Structured profile")}</h2>
            <dl className="mt-5 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
              <ProfileField
                label={t("实体类型", "Entity type")}
                value={pick(ENTITY_TYPE_LABELS[entity.type], lang)}
              />
              <ProfileField label={t("当前状态", "Status")} value={statusLabel(entity, t)} />
              <ProfileField label={t("所属组织", "Organization")} value={entity.vendor ?? "—"} />
              <ProfileField label={t("来源区域", "Region")} value={origin} />
              <ProfileField
                label={t("首次收录 / 发布", "First recorded / released")}
                value={entity.firstReleasedAt ?? "—"}
              />
              <ProfileField label={t("最近核验", "Last verified")} value={entity.lastUpdatedAt} />
              <ProfileField
                label={t("别名", "Aliases")}
                value={entity.aliases?.join(" · ") || "—"}
                wide
              />
              <ProfileField label={t("标签", "Tags")} value={entity.tags.join(" · ") || "—"} wide />
            </dl>
          </article>

          <article className="paper-card p-5 md:p-6">
            <h2 className="text-lg font-semibold">{t("关系概览", "Relationship summary")}</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat value={relations.length} label={t("已收录关系", "Relations")} />
              <Stat value={sources.length} label={t("直接来源", "Sources")} />
              <Stat value={timeline.length} label={t("时间事件", "Timeline events")} />
              <Stat
                value={new Set(relations.map((edge) => edge.kind)).size}
                label={t("关系类型", "Relation types")}
              />
            </div>
            {entity.capabilities && entity.capabilities.length > 0 && (
              <div className="mt-5 border-t border-border pt-5">
                <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("能力 / 特征", "Capabilities / traits")}
                </div>
                <ul className="space-y-3">
                  {entity.capabilities.map((capability, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                      <span className="min-w-0 flex-1">{pick(capability, lang)}</span>
                      <ConfidenceChip level={capability.confidence} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        </div>

        <section className="mt-12">
          <SectionHeading
            eyebrow="01"
            title={t("它与谁有什么关系", "How this entity is connected")}
            description={t(
              "每条关系都明确显示起点、关系语义、终点和置信度；点击相关实体可继续追踪。",
              "Every row names its source, relationship, target and confidence. Open a related entity to continue exploring.",
            )}
            action={
              <Link to="/graph" className="text-sm text-signal hover:underline">
                {t("进入完整关系图", "Open full graph")} →
              </Link>
            }
          />
          <div className="paper-card divide-y divide-border">
            {relations.map((edge) => {
              const from = entityById.get(edge.fromId);
              const to = entityById.get(edge.toId);
              const other = edge.fromId === entity.id ? to : from;
              if (!from || !to || !other) return null;
              return (
                <div
                  key={edge.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-center"
                >
                  <EntityLink entity={from} />
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-signal">
                    <ArrowRight className="h-3.5 w-3.5" />
                    {pick(RELATION_LABELS[edge.kind], lang)}
                  </span>
                  <EntityLink entity={to} />
                  <ConfidenceChip level={edge.confidence} />
                </div>
              );
            })}
            {relations.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">
                {t("尚未收录该实体的关系。", "No relationships have been recorded yet.")}
              </p>
            )}
          </div>
        </section>

        <section className="mt-12">
          <SectionHeading
            eyebrow="02"
            title={t("时间线", "Timeline")}
            description={t(
              "按时间记录发布、更新、评测与重要事件。",
              "Releases, updates, benchmarks and important events in chronological context.",
            )}
          />
          <div className="space-y-3">
            {timeline.map((event) => (
              <article key={event.id} className="paper-card flex gap-4 p-4">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <time className="font-mono text-xs text-signal">{event.date}</time>
                    <h3 className="font-semibold">{pick(event.title, lang)}</h3>
                    <ConfidenceChip level={event.confidence} />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {pick(event.summary, lang)}
                  </p>
                </div>
              </article>
            ))}
            {timeline.length === 0 && (
              <div className="paper-card p-6 text-sm text-muted-foreground">
                {t(
                  "该实体暂时没有独立时间线；已有关系和来源仍可在上方核验。",
                  "This entity has no standalone timeline yet; its relationships and sources remain verifiable above.",
                )}
              </div>
            )}
          </div>
        </section>

        <section className="mt-12">
          <SectionHeading
            eyebrow="03"
            title={t("关系证据", "Relationship evidence")}
            description={t(
              "这里只列出直接支持本实体关系或时间事件的来源。",
              "Only sources directly supporting this entity's relationships or timeline are listed.",
            )}
          />
          <div className="paper-card divide-y divide-border">
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
            {sources.length === 0 && (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {t(
                  "尚无可直接展示的来源，相关关系将保持未核验状态。",
                  "No directly displayable sources yet; related claims remain unverified.",
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function EntityLink({ entity }: { entity: Entity }) {
  const { lang } = useApp();
  return (
    <Link
      to="/knowledge/$type/$slug"
      params={{ type: entity.type, slug: entity.slug }}
      className="min-w-0 rounded-md border border-border bg-background px-3 py-2 hover:border-signal/50 hover:bg-accent/40"
    >
      <span className="block truncate font-medium text-foreground">{pick(entity.name, lang)}</span>
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        {pick(ENTITY_TYPE_LABELS[entity.type], lang)}
      </span>
    </Link>
  );
}

function ProfileField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 leading-relaxed text-foreground">{value}</dd>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="font-serif text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function statusLabel(entity: Entity, t: (zh: string, en: string) => string) {
  return {
    active: t("活跃", "Active"),
    deprecated: t("已停止维护", "Deprecated"),
    preview: t("预览", "Preview"),
    rumor: t("传闻 / 未核验", "Rumor / unverified"),
  }[entity.status];
}
