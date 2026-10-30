import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowRight, Building2, ExternalLink, Layers3, MapPin, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfidenceChip, DemoBadge, SectionHeading, SourceRow } from "@/components/common";
import { ReviewedFacts } from "@/components/knowledge/ReviewedFacts";
import { EntityDossier } from "@/components/knowledge/EntityDossier";
import { KnowledgeArticle } from "@/components/knowledge/KnowledgeArticle";
import { TimelineHero } from "@/components/knowledge/TimelineHero";
import { ReadingModeSelector } from "@/components/knowledge/ReadingModeSelector";
import { parseEntitySearch, knowledgeReturnSearch } from "@/domain/knowledge-browse";
import { catalogTypeLabel, RELATION_LABELS } from "@/domain/labels";
import {
  getEntitySectionPresentation,
  REFERENCE_READING_CONTEXT,
  getReadingModeOption,
  getVisibleEntitySections,
  type EntitySection,
} from "@/domain/reading-mode";
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
  validateSearch: parseEntitySearch,
  loader: async ({ params }) => {
    if (!ENTITY_TYPES.has(params.type as EntityType)) throw notFound();
    const entityType = params.type as EntityType;
    const snapshot = await knowledgeRepository.getSnapshot();
    const entity =
      snapshot.entities.find((item) => item.type === entityType && item.slug === params.slug) ??
      null;
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
  const { t, lang, mode, setMode } = useApp();
  const { browse } = Route.useSearch();
  const returnSearch = knowledgeReturnSearch(entity.type, browse);
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
    ...(entity.knowledge?.sections ?? []).flatMap((section) => section.sourceIds),
  ]);
  const sources = snapshot.evidence.filter((source) => sourceIds.has(source.id));
  const origin =
    entity.origin?.zh === "中国" || entity.origin?.zh === "国内"
      ? t("国内", "Domestic")
      : entity.origin
        ? t("海外", "Overseas")
        : "—";
  const availableSections: EntitySection[] = [
    ...(entity.knowledge ? (["guide"] as const) : []),
    "profile",
    ...(claims.length > 0 ? (["claims"] as const) : []),
    "relationships",
    ...(timeline.length > 0 ? (["timeline"] as const) : []),
    "evidence",
  ];
  const visibleSections = getVisibleEntitySections(mode, "generic", availableSections);
  const sectionVisible = (section: EntitySection) => visibleSections.includes(section);
  const sectionPresentation = getEntitySectionPresentation(mode, "generic", visibleSections);
  const readingMode = getReadingModeOption(mode);

  return (
    <AppShell>
      <div className="entity-reference-page model-detail-page">
        <div className="entity-reference">
          <nav className="mb-5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Link
              to="/knowledge"
              search={returnSearch}
              hash={entity.id}
              className="hover:text-signal"
            >
              {t("知识库", "Knowledge")}
            </Link>
            <span>/</span>
            <span>{pick(catalogTypeLabel(entity), lang)}</span>
            <span>/</span>
            <span className="text-foreground">{pick(entity.name, lang)}</span>
          </nav>

          <header className="entity-reference__header flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="chip">{pick(catalogTypeLabel(entity), lang)}</span>
                {entity.vendor && (
                  <span className="chip inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {entity.vendor}
                  </span>
                )}
                <DemoBadge mode={snapshot.meta.mode} updatedAt={snapshot.meta.retrievedAt} />
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
              <a
                href={`/ask?candidates=${encodeURIComponent(entity.id)}&taskType=${
                  entity.type === "framework" || entity.type === "agent"
                    ? "agent-development"
                    : entity.type === "model" || entity.type === "api"
                      ? "model-api"
                      : "coding-product"
                }&task=${encodeURIComponent(
                  t(
                    `评估 ${pick(entity.name, lang)} 是否适合我的任务`,
                    `Evaluate ${pick(entity.name, lang)} for my task`,
                  ),
                )}`}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-signal px-4 text-sm font-medium text-signal-foreground hover:opacity-90"
              >
                <Sparkles className="h-4 w-4" />
                {t("让决策助手分析", "Analyze with the assistant")}
              </a>
            </div>
          </header>

          {/* Reading Mode Selector */}
          <div className="mt-5">
            <ReadingModeSelector
              value={mode}
              onChange={setMode}
              context={REFERENCE_READING_CONTEXT}
            />
          </div>

          <div className="entity-reference__sections flex flex-col gap-6 pt-5">
            {entity.knowledge && (
              <ReadingModeSection
                section="guide"
                visible={sectionVisible("guide")}
                order={sectionPresentation.guide.order}
              >
                {entity.knowledge.sections?.length ? (
                  <EntityDossier entity={entity} snapshot={snapshot} />
                ) : (
                  <KnowledgeArticle
                    knowledge={entity.knowledge}
                    entityName={entity.name}
                    sectionEyebrow=""
                    sources={sources}
                    articleTitle={{
                      zh:
                        entity.type === "company"
                          ? `${entity.name.zh} 提供什么？`
                          : entity.type === "benchmark"
                            ? `${entity.name.zh} 衡量什么？`
                            : `${entity.name.zh} 的工作方式`,
                      en:
                        entity.type === "company"
                          ? `What does ${entity.name.en} provide?`
                          : entity.type === "benchmark"
                            ? `What does ${entity.name.en} measure?`
                            : `How ${entity.name.en} works`,
                    }}
                  />
                )}
              </ReadingModeSection>
            )}

            {sectionVisible("profile") && (
              <ReadingModeSection
                section="profile"
                visible={sectionVisible("profile")}
                order={sectionPresentation.profile.order}
              >
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
                  <article className="paper-card p-5 md:p-6">
                    <h3 className="text-lg font-semibold">
                      {t("结构化档案", "Structured profile")}
                    </h3>
                    <dl className="mt-5 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
                      <ProfileField
                        label={t("实体类型", "Entity type")}
                        value={pick(catalogTypeLabel(entity), lang)}
                      />
                      <ProfileField
                        label={t("当前状态", "Status")}
                        value={statusLabel(entity, t)}
                      />
                      <ProfileField
                        label={t("所属组织", "Organization")}
                        value={entity.vendor ?? "—"}
                      />
                      <ProfileField label={t("来源区域", "Region")} value={origin} />
                      <ProfileField
                        label={t("资料更新", "Reference updated")}
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
                    <h3 className="text-lg font-semibold">
                      {t("关联的模型与产品", "Related models & products")}
                    </h3>
                    <div className="mt-4 grid gap-2">
                      {[
                        ...new Set(
                          relations.map((edge) =>
                            edge.fromId === entity.id ? edge.toId : edge.fromId,
                          ),
                        ),
                      ]
                        .map((id) => entityById.get(id))
                        .filter((item): item is Entity => Boolean(item) && !item?.familyId)
                        .slice(0, 5)
                        .map((related) => (
                          <EntityLink key={related.id} entity={related} browse={browse} />
                        ))}
                      <a href="#entity-evidence" className="text-sm text-signal hover:underline">
                        {t(
                          `查看 ${sources.length} 个直接来源`,
                          `View ${sources.length} direct sources`,
                        )}{" "}
                        →
                      </a>
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
              </ReadingModeSection>
            )}

            {claims.length > 0 && sectionVisible("claims") && (
              <section
                data-reading-section="claims"
                style={{ order: sectionPresentation.claims.order }}
              >
                <SectionHeading
                  title={t("事实与依据", "Facts & evidence")}
                  description={t(
                    "用可追溯的依据判断能力与采用条件；可检索全部记录，逐条查看来源和日期。",
                    "Use traceable evidence to assess capabilities and adoption; search records and inspect sources and dates.",
                  )}
                />
                <ReviewedFacts
                  key={entity.id}
                  entityId={entity.id}
                  claims={claims}
                  evidence={snapshot.evidence}
                />
              </section>
            )}

            <ReadingModeSection
              section="timeline"
              visible={timeline.length > 0 && sectionVisible("timeline")}
              order={sectionPresentation.timeline.order}
            >
              {timeline.length > 1 ? (
                <TimelineHero
                  events={timeline}
                  sources={sources}
                  entityName={pick(entity.name, lang)}
                />
              ) : (
                <details className="paper-card p-5">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("资料记录", "Reference record")} · {timeline[0]?.date}
                  </summary>
                  {timeline.map((event) => (
                    <p className="mt-3 text-sm text-muted-foreground" key={event.id}>
                      {pick(event.title, lang)} · {pick(event.summary, lang)}
                    </p>
                  ))}
                </details>
              )}
            </ReadingModeSection>

            <ReadingModeSection
              section="relationships"
              visible={sectionVisible("relationships")}
              order={sectionPresentation.relationships.order}
            >
              <SectionHeading
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
                    {t("查看完整关系网络", "View full relationship network")} →
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
                      <EntityLink entity={from} browse={browse} />
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-signal">
                        <ArrowRight className="h-3.5 w-3.5" />
                        {pick(RELATION_LABELS[edge.kind], lang)}
                      </span>
                      <EntityLink entity={to} browse={browse} />
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
            </ReadingModeSection>

            <ReadingModeSection
              section="evidence"
              visible={sectionVisible("evidence")}
              order={sectionPresentation.evidence.order}
            >
              <SectionHeading
                title={t("事实与关系证据", "Fact and relationship evidence")}
                description={t(
                  "这里只列出直接支持本实体事实、关系或时间事件的来源。",
                  "Only sources directly supporting this entity's facts, relationships or timeline are listed.",
                )}
              />
              <div id="entity-evidence" className="paper-card divide-y divide-border">
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
            </ReadingModeSection>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ReadingModeSection({
  section,
  visible,
  order,
  children,
}: {
  section: EntitySection;
  visible: boolean;
  order: number;
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <section data-reading-section={section} style={{ order }}>
      {children}
    </section>
  );
}

function EntityLink({ entity, browse }: { entity: Entity; browse?: string }) {
  const { lang } = useApp();
  const content = (
    <>
      <span className="block truncate font-medium text-foreground">{pick(entity.name, lang)}</span>
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        {pick(catalogTypeLabel(entity), lang)}
      </span>
    </>
  );
  const className =
    "min-w-0 rounded-md border border-border bg-background px-3 py-2 hover:border-signal/50 hover:bg-accent/40";

  if (entity.type === "model") {
    return (
      <Link to="/knowledge/model/$slug" params={{ slug: entity.slug }} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <Link
      to="/knowledge/$type/$slug"
      params={{ type: entity.type, slug: entity.slug }}
      search={{ browse }}
      className={className}
    >
      {content}
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

function statusLabel(entity: Entity, t: (zh: string, en: string) => string) {
  return {
    active: t("活跃", "Active"),
    deprecated: t("已停止维护", "Deprecated"),
    preview: t("预览", "Preview"),
    rumor: t("传闻 / 未核验", "Rumor / unverified"),
  }[entity.status];
}
