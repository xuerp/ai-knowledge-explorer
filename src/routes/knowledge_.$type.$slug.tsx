import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ExternalLink,
  GitBranch,
  Layers3,
  MapPin,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfidenceChip, DemoBadge, SectionHeading, SourceRow } from "@/components/common";
import { ReviewedFacts } from "@/components/knowledge/ReviewedFacts";
import { KnowledgeArticle } from "@/components/knowledge/KnowledgeArticle";
import { ENTITY_TYPE_LABELS, RELATION_LABELS } from "@/domain/labels";
import { getEntitySectionPresentation, type EntitySection } from "@/domain/reading-mode";
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
  const { t, lang, mode } = useApp();
  const entityById = new Map(snapshot.entities.map((item) => [item.id, item]));
  const relations = snapshot.graph.edges.filter(
    (edge) => edge.fromId === entity.id || edge.toId === entity.id,
  );
  const timeline = snapshot.timeline[entity.id] ?? [];
  const claims = snapshot.claims.filter((claim) => claim.entityId === entity.id);
  const sourceIds = new Set([
    ...claims.flatMap((claim) => claim.sourceIds),
    ...relations.flatMap((edge) => edge.sourceIds),
    ...timeline.flatMap((event) => event.sourceIds),
    ...(entity.metrics ?? []).flatMap((metric) => metric.sourceIds ?? []),
    ...(entity.knowledge?.keyPoints ?? []).flatMap((point) => point.sourceIds ?? []),
  ]);
  const sources = snapshot.evidence.filter((source) => sourceIds.has(source.id));
  const origin =
    entity.origin?.zh === "中国" || entity.origin?.zh === "国内"
      ? t("国内", "Domestic")
      : entity.origin
        ? t("海外", "Overseas")
        : "—";
  const visibleSections: EntitySection[] = [
    ...(entity.knowledge ? (["guide"] as const) : []),
    "profile",
    ...(claims.length > 0 ? (["claims"] as const) : []),
    "relationships",
    ...(timeline.length > 0 ? (["timeline"] as const) : []),
    "evidence",
  ];
  const sectionPresentation = getEntitySectionPresentation(mode, "generic", visibleSections);

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
            {entity.knowledge?.officialUrl && (
              <a
                href={entity.knowledge.officialUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent"
              >
                <ExternalLink className="h-4 w-4" />
                {t("官方网站", "Official site")}
              </a>
            )}
            <Link
              to="/graph"
              search={{ entity: entity.id, mode: "ecosystem" }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent"
            >
              <GitBranch className="h-4 w-4" />
              {t("分析关联", "Analyze relationships")}
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

        <div className="flex flex-col gap-12 pt-10">
          {entity.knowledge && (
            <div data-reading-section="guide" style={{ order: sectionPresentation.guide.order }}>
              <KnowledgeArticle
                knowledge={entity.knowledge}
                entityName={entity.name}
                sectionEyebrow={sectionPresentation.guide.eyebrow}
              />
            </div>
          )}

          <section
            data-reading-section="profile"
            style={{ order: sectionPresentation.profile.order }}
          >
            <SectionHeading
              eyebrow={sectionPresentation.profile.eyebrow}
              title={t("基础档案", "Reference profile")}
              description={t(
                "用于检索、筛选和数据核验的结构化信息。",
                "Structured information for search, filtering and verification.",
              )}
            />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
              <article className="paper-card p-5 md:p-6">
                <h3 className="text-lg font-semibold">{t("结构化档案", "Structured profile")}</h3>
                <dl className="mt-5 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
                  <ProfileField
                    label={t("实体类型", "Entity type")}
                    value={pick(ENTITY_TYPE_LABELS[entity.type], lang)}
                  />
                  <ProfileField label={t("当前状态", "Status")} value={statusLabel(entity, t)} />
                  <ProfileField
                    label={t("所属组织", "Organization")}
                    value={entity.vendor ?? "—"}
                  />
                  <ProfileField label={t("来源区域", "Region")} value={origin} />
                  <ProfileField
                    label={t("首次收录 / 发布", "First recorded / released")}
                    value={entity.firstReleasedAt ?? "—"}
                  />
                  <ProfileField
                    label={t("最近核验", "Last verified")}
                    value={entity.lastUpdatedAt}
                  />
                  <ProfileField
                    label={t("别名", "Aliases")}
                    value={entity.aliases?.join(" · ") || "—"}
                    wide
                  />
                  <ProfileField
                    label={t("标签", "Tags")}
                    value={entity.tags.join(" · ") || "—"}
                    wide
                  />
                </dl>
              </article>

              <article className="paper-card p-5 md:p-6">
                <h3 className="text-lg font-semibold">{t("关系概览", "Relationship summary")}</h3>
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
          </section>

          {claims.length > 0 && (
            <section
              data-reading-section="claims"
              style={{ order: sectionPresentation.claims.order }}
            >
              <SectionHeading
                eyebrow={sectionPresentation.claims.eyebrow}
                title={t("已审核事实", "Reviewed facts")}
                description={t(
                  "这些事实已经通过人工审核，并保留直接证据与最近核验时间。",
                  "These facts passed human review and retain direct evidence and verification dates.",
                )}
              />
              <ReviewedFacts key={entity.id} claims={claims} evidence={snapshot.evidence} />
            </section>
          )}

          <section
            data-reading-section="relationships"
            style={{ order: sectionPresentation.relationships.order }}
          >
            <SectionHeading
              eyebrow={sectionPresentation.relationships.eyebrow}
              title={t("它与谁有什么关系", "How this entity is connected")}
              description={t(
                "每条关系都明确显示起点、关系语义、终点和置信度；点击相关实体可继续追踪。",
                "Every row names its source, relationship, target and confidence. Open a related entity to continue exploring.",
              )}
              action={
                <Link
                  to="/graph"
                  search={{ entity: entity.id, mode: "ecosystem" }}
                  className="text-sm text-signal hover:underline"
                >
                  {t("打开关系洞察", "Open relationship insights")} →
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

          {timeline.length > 0 && (
            <section
              data-reading-section="timeline"
              style={{ order: sectionPresentation.timeline.order }}
            >
              <SectionHeading
                eyebrow={sectionPresentation.timeline.eyebrow}
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
              </div>
            </section>
          )}

          <section
            data-reading-section="evidence"
            style={{ order: sectionPresentation.evidence.order }}
          >
            <SectionHeading
              eyebrow={sectionPresentation.evidence.eyebrow}
              title={t("事实与关系证据", "Fact and relationship evidence")}
              description={t(
                "这里只列出直接支持本实体事实、关系或时间事件的来源。",
                "Only sources directly supporting this entity's facts, relationships or timeline are listed.",
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
