import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Building2,
  Send,
  MessagesSquare,
  Sparkles,
  ArrowLeftRight,
  ExternalLink,
  Layers,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import { KnowledgeArticle } from "@/components/knowledge/KnowledgeArticle";
import { ReviewedFacts } from "@/components/knowledge/ReviewedFacts";
import { ReadingModeSelector } from "@/components/knowledge/ReadingModeSelector";
import { DemoBadge, ConfidenceChip, SectionHeading, SourceRow } from "@/components/common";
import {
  groupModelProductLines,
  isInactiveReleaseStage,
  isCurrentProductLineVersion,
  compareModelReleaseDates,
  type ProductLineGroup,
} from "@/domain/model-product-lines";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import { modelSpecChinese } from "@/domain/model-spec";
import { uniqueSourceLinks } from "@/domain/source-links";
import { familyEvolutionEvents } from "@/domain/family-evolution";
import {
  getEntitySectionPresentation,
  getVisibleEntitySections,
  type EntitySection,
} from "@/domain/reading-mode";
import { useApp, pick } from "@/lib/app-state";
import { bilingualModelDisplayName, modelDisplayName } from "@/lib/model-display";
import { knowledgeRepository } from "@/services/knowledge-repository";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  Entity,
  EntityDetail,
  KnowledgeSnapshot,
  ReadingMode,
  Source,
  TimelineEvent,
} from "@/domain/types";

const FAMILY_READING_CONTEXT: Record<
  ReadingMode,
  { description: { zh: string; en: string }; focusAreas: { zh: string; en: string }[] }
> = {
  general: {
    description: {
      zh: "先看各产品线做什么、当前有哪些代表版本，再理解整个家族的能力与边界。",
      en: "Start with what each line does and its representative release, then read the family's strengths and limits.",
    },
    focusAreas: [
      { zh: "产品线地图", en: "Product-line map" },
      { zh: "代表版本", en: "Representative releases" },
      { zh: "使用边界", en: "Usage limits" },
    ],
  },
  product: {
    description: {
      zh: "按任务筛选产品线，逐一核对可用入口、成本信息和采用条件。",
      en: "Choose a line by task, then check access, cost information, and adoption conditions.",
    },
    focusAreas: [
      { zh: "场景匹配", en: "Task fit" },
      { zh: "可用入口", en: "Access" },
      { zh: "成本口径", en: "Cost basis" },
    ],
  },
  technical: {
    description: {
      zh: "按具体版本核对 API 标识、发布时间、规格参数与原始证据。",
      en: "Inspect concrete release IDs, dates, specifications, and original evidence.",
    },
    focusAreas: [
      { zh: "版本谱系", en: "Release lineage" },
      { zh: "API 与规格", en: "APIs and specs" },
      { zh: "来源证据", en: "Sources" },
    ],
  },
};

export const Route = createFileRoute("/knowledge_/model/$slug")({
  loader: async ({ params }) => {
    const snapshot = await knowledgeRepository.getSnapshot().catch(() => DEMO_KNOWLEDGE_SNAPSHOT);
    const entity =
      snapshot.entities.find((item) => item.type === "model" && item.slug === params.slug) ?? null;
    if (!entity) throw notFound();
    return { entity, snapshot };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "未找到 · AI Radar" }] };
    const e = loaderData.entity;
    return {
      meta: [
        { title: `${bilingualModelDisplayName(e)} · AI Radar` },
        { name: "description", content: e.summary.zh },
        { property: "og:title", content: `${modelDisplayName(e, "zh")} · AI Radar` },
        { property: "og:description", content: e.summary.zh },
      ],
    };
  },
  component: EntityDetail,
});

function EntityDetail() {
  const { entity: e, snapshot } = Route.useLoaderData() as {
    entity: Entity;
    snapshot: KnowledgeSnapshot;
  };
  const { t, lang, mode, setMode } = useApp();

  if (e.familyId) {
    return <ModelVersionDetail entity={e} snapshot={snapshot} />;
  }

  const { entities, evidence: allEvidence, timeline: allTimeline, graph } = snapshot;
  const relations = graph.edges;
  const findEntity = (id: string) => entities.find((entity) => entity.id === id);

  const timeline = familyEvolutionEvents(allTimeline[e.id] ?? []);
  const hasMetrics = (e.metrics?.length ?? 0) > 0;
  const reviewedClaims = snapshot.claims.filter((claim) => claim.entityId === e.id);
  const recentChange = snapshot.changes.find((change) => change.entityId === e.id);
  const relatedRelations = relations.filter((r) => r.fromId === e.id || r.toId === e.id);
  const familyId = e.familyId ?? e.id;
  const familyVersions = entities
    .filter((entity) => entity.familyId === familyId)
    .sort(compareModelReleaseDates);
  const productLineGroups = groupModelProductLines(familyVersions);
  const parentFamily = e.familyId ? findEntity(e.familyId) : undefined;
  const knowledge = e.knowledge ?? createVersionKnowledge(e, parentFamily);
  const relevantSourceIds = new Set([
    ...reviewedClaims.flatMap((claim) => claim.sourceIds),
    ...timeline.flatMap((event) => event.sourceIds),
    ...(e.metrics ?? []).flatMap((metric) => metric.sourceIds ?? []),
    ...knowledge.keyPoints.flatMap((point) => point.sourceIds ?? []),
    ...(recentChange?.sourceIds ?? []),
  ]);
  if (e.familyId) {
    parentFamily?.knowledge?.keyPoints.forEach((point) =>
      point.sourceIds?.forEach((sourceId) => relevantSourceIds.add(sourceId)),
    );
  }
  const evidence = allEvidence
    .filter((source) => relevantSourceIds.has(source.id))
    .sort(
      (left, right) =>
        Number(right.type === "official") - Number(left.type === "official") ||
        right.publishedAt.localeCompare(left.publishedAt),
    );
  const sourceLinks = uniqueSourceLinks(evidence);

  const availableSections: EntitySection[] = [
    "guide",
    "profile",
    ...(reviewedClaims.length > 0 ? (["claims"] as const) : []),
    ...(familyVersions.length > 0 ? (["lineage"] as const) : []),
    ...(timeline.length > 0 ? (["timeline"] as const) : []),
    "comparison",
    "questions",
    "evidence",
  ];
  const visibleSections = getVisibleEntitySections(mode, "model", availableSections);
  const sectionVisible = (section: EntitySection) => visibleSections.includes(section);
  const sectionPresentation = getEntitySectionPresentation(mode, "model", visibleSections);
  const competitors = relatedRelations
    .filter((r) => r.kind === "competes-with")
    .map((r) => findEntity(r.fromId === e.id ? r.toId : r.fromId))
    .filter(Boolean);
  const relatedModels = [parentFamily, ...competitors]
    .filter((item): item is Entity => Boolean(item && item.id !== e.id))
    .filter(
      (item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .slice(0, 3);
  const displayName = modelDisplayName(e, lang);
  const displayLocalizedName = {
    zh: modelDisplayName(e, "zh"),
    en: modelDisplayName(e, "en"),
  };
  const verifiedRecordCount =
    reviewedClaims.filter((claim) => claim.confidence === "verified").length +
    timeline.filter((event) => event.confidence === "verified").length +
    (e.metrics ?? []).filter((metric) => metric.confidence === "verified").length;

  return (
    <AppShell>
      <div className="model-detail-page">
        <div className="page-container model-detail__hero pb-5 pt-8 md:pt-10">
          <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
            <Link to="/knowledge" className="hover:text-signal">
              {t("知识库", "Knowledge")}
            </Link>
            <span>/</span>
            <span>{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
            <span>/</span>
            <span className="text-foreground">{displayName}</span>
          </div>
          <div className="model-detail__hero-card">
            <div className="model-detail__identity">
              <span className={`model-detail__mark is-${e.slug}`} aria-hidden="true">
                {modelMarkText(e)}
              </span>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="chip">{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
                  {e.vendor && (
                    <span className="chip inline-flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {e.vendor}
                    </span>
                  )}
                  {familyVersions.length > 0 && (
                    <span className="chip">
                      {t(
                        `${productLineGroups.length} 条产品线 · ${familyVersions.length} 个版本`,
                        `${productLineGroups.length} product lines · ${familyVersions.length} releases`,
                      )}
                    </span>
                  )}
                  <DemoBadge />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                  {displayName}
                </h1>
                <p className="mt-3 text-base text-ink-soft max-w-3xl leading-relaxed">
                  {pick(e.summary, lang)}
                </p>
              </div>
            </div>
            <div className="model-detail__actions">
              {knowledge.officialUrl && (
                <a
                  href={knowledge.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm hover:bg-accent"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("官方资料", "Official source")}
                </a>
              )}
              <a
                href={`/ask?candidates=${encodeURIComponent(e.id)}&task=${encodeURIComponent(
                  t(`评估 ${displayName} 是否适合我的任务`, `Evaluate ${displayName} for my task`),
                )}`}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-signal text-signal-foreground text-sm font-medium hover:opacity-90"
              >
                <Sparkles className="h-4 w-4" />
                {t("让决策助手比较", "Compare with the assistant")}
              </a>
            </div>
          </div>
          {recentChange && (
            <div className="model-detail__change mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#f4c767] bg-[#fffbeb] px-4 py-3 text-sm">
              <span className="font-semibold text-[#b45309]">{t("最近变化", "Latest change")}</span>
              <span className="min-w-0 flex-1 text-[#92400e]">
                {pick(recentChange.summary, lang)}
              </span>
              <time className="font-mono text-[11px] text-[#b45309]">{recentChange.date}</time>
              {timeline.length > 0 && (
                <a
                  href="#family-timeline"
                  className="text-xs font-medium text-signal hover:underline"
                >
                  {t("查看演进节点", "View milestones")} →
                </a>
              )}
            </div>
          )}
        </div>

        <div className="page-container model-detail__body flex flex-col gap-12 pb-12 pt-5">
          <div className="model-detail__mode flex flex-wrap items-center justify-between gap-4">
            <ReadingModeSelector value={mode} onChange={setMode} context={FAMILY_READING_CONTEXT} />
          </div>

          <aside className="model-detail__aside" aria-label={t("模型补充信息", "Model context")}>
            <section>
              <h2>{t("产品线导航", "Product-line navigation")}</h2>
              {productLineGroups.length > 0 ? (
                <div className="model-family__line-nav">
                  {productLineGroups.map((line) => (
                    <div key={line.id}>
                      <div className="model-family__line-nav-head">
                        <strong>{pick(line.name, lang)}</strong>
                        <span>
                          {t(`${line.versions.length} 个版本`, `${line.versions.length} releases`)}
                        </span>
                      </div>
                      <p>{pick(line.positioning, lang)}</p>
                      <div className="model-family__line-nav-links">
                        {line.versions.slice(0, 3).map((version) => (
                          <Link
                            key={version.id}
                            to="/knowledge/model/$slug"
                            params={{ slug: version.slug }}
                          >
                            <span>{modelDisplayName(version, lang)}</span>
                            {isCurrentProductLineVersion(line, version) && (
                              <em>{t("当前", "Current")}</em>
                            )}
                            <small>
                              {version.release?.releasedAt ?? version.firstReleasedAt ?? "—"} ·{" "}
                              {releaseStageLabel(version.release?.stage ?? "stable", t)}
                            </small>
                          </Link>
                        ))}
                        {line.versions.length > 3 && (
                          <a
                            className="model-family__line-nav-all"
                            href={`#product-line-${line.id}`}
                          >
                            <span>
                              {mode === "technical"
                                ? t("查看完整版本链", "View full release history")
                                : t("查看产品线与版本", "View line and releases")}
                            </span>
                            <em>{line.versions.length}</em>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="model-detail__related-list">
                  {relatedModels.map((model) => (
                    <Link key={model.id} to="/knowledge/model/$slug" params={{ slug: model.slug }}>
                      <span
                        className={`model-detail__related-mark is-${model.slug}`}
                        aria-hidden="true"
                      >
                        {modelMarkText(model)}
                      </span>
                      <span>
                        <strong>{modelDisplayName(model, lang)}</strong>
                        <small>{model.latestVersion || pick(model.summary, lang)}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2>{t("提供商信息", "Provider")}</h2>
              <div className="model-detail__provider">
                <span aria-hidden="true">
                  <Building2 />
                </span>
                <div>
                  <strong>{e.vendor || t("未标注", "Unspecified")}</strong>
                  <small>{regionLabel(e, t)}</small>
                </div>
              </div>
              <dl className="model-detail__aside-facts">
                <div>
                  <dt>{t("首次发布", "First released")}</dt>
                  <dd>{e.firstReleasedAt || "—"}</dd>
                </div>
                <div>
                  <dt>{t("产品线 / 版本", "Lines / releases")}</dt>
                  <dd>{`${productLineGroups.length} / ${familyVersions.length}`}</dd>
                </div>
                {knowledge.officialUrl && (
                  <div>
                    <dt>{t("官网", "Website")}</dt>
                    <dd>
                      <a href={knowledge.officialUrl} target="_blank" rel="noreferrer">
                        {t("打开", "Open")}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="model-detail__evidence-card">
              <h2>{t("证据统计", "Evidence")}</h2>
              <dl className="model-detail__aside-facts">
                <div>
                  <dt>{t("已核验记录", "Verified records")}</dt>
                  <dd>{verifiedRecordCount}</dd>
                </div>
                <div>
                  <dt>{t("证据来源", "Sources")}</dt>
                  <dd>{sourceLinks.length}</dd>
                </div>
                <div>
                  <dt>{t("最后更新", "Last updated")}</dt>
                  <dd>{e.lastUpdatedAt}</dd>
                </div>
              </dl>
            </section>
          </aside>

          {timeline.length > 0 && (
            <ReadingModeSection
              section="timeline"
              id="family-timeline"
              visible={sectionVisible("timeline")}
              order={sectionPresentation.timeline.order}
            >
              <FamilyTimeline
                events={timeline}
                sources={evidence}
                number={sectionPresentation.timeline.eyebrow}
              />
            </ReadingModeSection>
          )}

          <div data-reading-section="guide" style={{ order: sectionPresentation.guide.order }}>
            <KnowledgeArticle
              knowledge={knowledge}
              entityName={displayLocalizedName}
              sectionEyebrow={sectionPresentation.guide.eyebrow}
              articleLabel={
                e.familyId
                  ? { zh: "具体版本导读", en: "Model release guide" }
                  : { zh: "模型系列导读", en: "Model family guide" }
              }
              articleTitle={
                e.familyId
                  ? {
                      zh: `${e.name.zh} 是什么版本？`,
                      en: `Where does ${e.name.en} fit?`,
                    }
                  : undefined
              }
            />
          </div>

          {/* 1. 结构化档案 */}
          <ReadingModeSection
            section="profile"
            visible={sectionVisible("profile")}
            order={sectionPresentation.profile.order}
          >
            <SectionHeading
              eyebrow={sectionPresentation.profile.eyebrow}
              title={t("结构化档案", "Structured profile")}
              description={
                hasMetrics
                  ? t(
                      "关于该实体的核心事实、能力与最新指标，所有条目都标注置信度与来源。",
                      "Core facts, capabilities and latest metrics — each carries a confidence label and sources.",
                    )
                  : t(
                      "关于该实体的核心事实与能力，所有条目都标注置信度与来源。",
                      "Core facts and capabilities — each carries a confidence label and sources.",
                    )
              }
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <article className="paper-card p-5">
                <h3 className="mb-5 text-base font-semibold">
                  {t("百科档案", "Encyclopedic profile")}
                </h3>
                <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                  <ProfileField
                    label={t("中英文名称", "Name")}
                    value={`${displayLocalizedName.zh} / ${displayLocalizedName.en}`}
                  />
                  <ProfileField label={t("所属组织", "Organization")} value={e.vendor ?? "—"} />
                  <ProfileField
                    label={t("一句话定义", "Definition")}
                    value={pick(e.summary, lang)}
                    wide
                  />
                  <ProfileField
                    label={t("首次出现", "First released")}
                    value={e.firstReleasedAt ?? "—"}
                  />
                  <ProfileField
                    label={t("当前版本", "Current version")}
                    value={e.latestVersion ?? "—"}
                    mono
                  />
                  <ProfileField
                    label={t("当前状态", "Status")}
                    value={
                      e.status === "active" ? t("已发布 / 活跃", "Released / active") : e.status
                    }
                  />
                  <ProfileField label={t("地域归属", "Region")} value={regionLabel(e, t)} />
                  <ProfileField label={t("标签", "Tags")} value={e.tags.join(" · ")} wide />
                </dl>
              </article>

              <article className="paper-card p-5">
                <h3 className="mb-5 text-base font-semibold">
                  {t("技术规格与核心能力", "Technical profile")}
                </h3>
                <dl className="mb-5 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                  {e.specs ? (
                    <>
                      <ProfileField
                        label={t("上下文窗口", "Context window")}
                        value={localizeModelSpec(e.specs.contextWindow, lang)}
                        mono
                      />
                      <ProfileField
                        label={t("输入价格", "Input price")}
                        value={localizeModelSpec(e.specs.inputPrice, lang)}
                        mono
                      />
                      <ProfileField
                        label={t("输出价格", "Output price")}
                        value={localizeModelSpec(e.specs.outputPrice, lang)}
                        mono
                      />
                      <ProfileField
                        label={t("输入模态", "Modalities")}
                        value={e.specs.modalities ?? "—"}
                      />
                      <ProfileField
                        label={t("工具与 Agent", "Tools & agents")}
                        value={e.specs.toolUse ?? "—"}
                      />
                      <ProfileField
                        label={t("可用范围", "Availability")}
                        value={e.specs.availability ?? "—"}
                      />
                    </>
                  ) : (
                    <>
                      <ProfileField
                        label={t("实体类型", "Entity type")}
                        value={pick(ENTITY_TYPE_LABELS[e.type], lang)}
                      />
                      <ProfileField
                        label={t("最后核验", "Last verified")}
                        value={e.lastUpdatedAt}
                        mono
                      />
                      <ProfileField
                        label={t("已收录具体版本", "Concrete versions")}
                        value={t(
                          `${familyVersions.length} 个`,
                          `${familyVersions.length} versions`,
                        )}
                      />
                      <ProfileField
                        label={t("资料状态", "Evidence status")}
                        value={t("证据可追溯", "Traceable evidence")}
                      />
                    </>
                  )}
                </dl>
                {(e.capabilities?.length ?? 0) > 0 && (
                  <div className="border-t border-border pt-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("核心能力", "Core capabilities")}
                    </div>
                    <ul className="space-y-3">
                      {(e.capabilities ?? []).map((capability, index) => (
                        <li key={index} className="flex items-center gap-3">
                          <Layers className="h-4 w-4 shrink-0 text-signal" />
                          <span className="min-w-0 flex-1 text-sm">{pick(capability, lang)}</span>
                          <ConfidenceChip level={capability.confidence} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            </div>

            {hasMetrics && (
              <div className="mt-4 paper-card p-5">
                <h4 className="font-serif font-semibold mb-4">{t("最新指标", "Latest metrics")}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-4 font-medium">{t("指标", "Metric")}</th>
                        <th className="py-2 pr-4 font-medium">{t("数值", "Value")}</th>
                        <th className="py-2 pr-4 font-medium">{t("评测", "Benchmark")}</th>
                        <th className="py-2 pr-4 font-medium">{t("日期", "Date")}</th>
                        <th className="py-2 pr-4 font-medium">{t("置信度", "Confidence")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {e.metrics?.map((m, i) => (
                        <tr key={i}>
                          <td className="py-2.5 pr-4 text-foreground">{m.name}</td>
                          <td className="py-2.5 pr-4 font-mono text-foreground">{m.value}</td>
                          <td className="py-2.5 pr-4 text-ink-soft">{m.benchmark}</td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{m.date}</td>
                          <td className="py-2.5 pr-4">
                            <ConfidenceChip level={m.confidence} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </ReadingModeSection>

          {reviewedClaims.length > 0 && sectionVisible("claims") && (
            <section
              data-reading-section="claims"
              style={{ order: sectionPresentation.claims.order }}
            >
              <SectionHeading
                eyebrow={sectionPresentation.claims.eyebrow}
                title={t("事实与依据", "Facts & evidence")}
                description={t(
                  "用事实核对模型能力、价格和接入条件；更多记录可按关键词、主题和分页查阅。",
                  "Check capabilities, pricing and access against facts; browse further records by query, topic and page.",
                )}
              />
              <ReviewedFacts
                key={e.id}
                entityId={e.id}
                claims={reviewedClaims}
                evidence={allEvidence}
              />
            </section>
          )}

          {familyVersions.length > 0 && sectionVisible("lineage") && (
            <section
              data-reading-section="lineage"
              style={{ order: sectionPresentation.lineage.order }}
            >
              <SectionHeading
                eyebrow={sectionPresentation.lineage.eyebrow}
                title={
                  mode === "general"
                    ? t("家族产品线", "The family at a glance")
                    : mode === "product"
                      ? t("按任务选择产品线", "Choose a product line")
                      : t("版本谱系与规格", "Release lineage and specifications")
                }
                description={
                  mode === "general"
                    ? t(
                        "同一家族里的产品线各有定位；从这里进入具体版本。",
                        "Each line has a distinct role. Open a concrete release from here.",
                      )
                    : mode === "product"
                      ? t(
                          "先比较定位与可用渠道，价格缺失时不会用其他型号代替。",
                          "Compare positioning and access first. Missing prices are not borrowed from another release.",
                        )
                      : t(
                          "逐版本查看发布时间、API 标识、上下文和价格快照。",
                          "Inspect release dates, API IDs, context and price snapshots per release.",
                        )
                }
                action={
                  mode === "product" ? (
                    <Link
                      to="/compare"
                      search={{ models: undefined }}
                      className="inline-flex items-center gap-1 text-sm text-signal hover:underline"
                    >
                      {t("进入具体版本对比", "Compare concrete versions")}{" "}
                      <ArrowLeftRight className="h-3 w-3" />
                    </Link>
                  ) : undefined
                }
              />
              {mode === "technical" ? (
                <div className="model-family__lineage">
                  {productLineGroups.map((line) => (
                    <article
                      key={line.id}
                      id={`product-line-${line.id}`}
                      className="paper-card model-family__lineage-group"
                    >
                      <header>
                        <div>
                          <span>{t("产品线", "Product line")}</span>
                          <h3>{pick(line.name, lang)}</h3>
                          <p>{pick(line.positioning, lang)}</p>
                        </div>
                        <strong>
                          {t(`${line.versions.length} 个版本`, `${line.versions.length} releases`)}
                        </strong>
                      </header>
                      <div className="model-family__release-rows">
                        {line.versions.map((version) => (
                          <Link
                            key={version.id}
                            to="/knowledge/model/$slug"
                            params={{ slug: version.slug }}
                          >
                            <div className="model-family__release-heading">
                              <span className="model-family__release-name">
                                <strong>{modelDisplayName(version, lang)}</strong>
                                <code>{version.release?.releaseId ?? version.slug}</code>
                              </span>
                              <span className="model-family__release-status">
                                <em className={`is-${version.release?.stage ?? "stable"}`}>
                                  {releaseStageLabel(version.release?.stage ?? "stable", t)}
                                </em>
                                {isCurrentProductLineVersion(line, version) && (
                                  <small>{t("当前版本", "Current release")}</small>
                                )}
                              </span>
                              <span className="model-family__release-date">
                                <small>{t("发布", "Released")}</small>
                                <strong>
                                  {version.release?.releasedAt ?? version.firstReleasedAt ?? "—"}
                                </strong>
                              </span>
                            </div>
                            <div className="model-family__release-specs">
                              <span>
                                <small>{t("上下文", "Context")}</small>
                                <strong>
                                  <ModelSpecValue
                                    value={version.specs?.contextWindow}
                                    lang={lang}
                                  />
                                </strong>
                              </span>
                              <span>
                                <small>{t("输入", "Input")}</small>
                                <strong>
                                  <ModelSpecValue value={version.specs?.inputPrice} lang={lang} />
                                </strong>
                              </span>
                              <span>
                                <small>{t("输出", "Output")}</small>
                                <strong>
                                  <ModelSpecValue value={version.specs?.outputPrice} lang={lang} />
                                </strong>
                              </span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <FamilyLineSummary lines={productLineGroups} mode={mode} />
              )}
            </section>
          )}

          {/* Compare */}
          <ReadingModeSection
            section="comparison"
            visible={sectionVisible("comparison")}
            order={sectionPresentation.comparison.order}
          >
            <SectionHeading
              eyebrow={sectionPresentation.comparison.eyebrow}
              title={t("进入具体版本对比", "Compare concrete versions")}
              action={
                <Link
                  to="/compare"
                  search={{ models: undefined }}
                  className="text-sm text-signal hover:underline inline-flex items-center gap-1"
                >
                  {t("详细对比", "Detailed compare")} <ArrowLeftRight className="h-3 w-3" />
                </Link>
              }
            />
            <div className="paper-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left py-3 px-4 font-medium">{t("对象", "Model")}</th>
                      <th className="text-left py-3 px-4 font-medium">{t("最新版本", "Latest")}</th>
                      <th className="text-left py-3 px-4 font-medium">{t("特色", "Focus")}</th>
                      <th className="text-left py-3 px-4 font-medium">
                        {t("最近更新", "Updated")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr className="bg-signal/5">
                      <td className="py-3 px-4 font-medium text-foreground">{displayName}</td>
                      <td className="py-3 px-4 font-mono text-foreground">
                        {e.latestVersion ?? "—"}
                      </td>
                      <td className="py-3 px-4 text-ink-soft">{e.tags.slice(0, 3).join(" · ")}</td>
                      <td className="py-3 px-4 text-muted-foreground">{e.lastUpdatedAt}</td>
                    </tr>
                    {competitors.map(
                      (c) =>
                        c && (
                          <tr key={c.id}>
                            <td className="py-3 px-4">
                              <Link
                                to="/knowledge/model/$slug"
                                params={{ slug: c.slug }}
                                className="text-foreground hover:text-signal"
                              >
                                {pick(c.name, lang)}
                              </Link>
                            </td>
                            <td className="py-3 px-4 font-mono text-foreground">
                              {c.latestVersion ?? "—"}
                            </td>
                            <td className="py-3 px-4 text-ink-soft">
                              {c.tags.slice(0, 3).join(" · ")}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">{c.lastUpdatedAt}</td>
                          </tr>
                        ),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </ReadingModeSection>

          {/* AI 问答 */}
          <ReadingModeSection
            section="questions"
            visible={sectionVisible("questions")}
            order={sectionPresentation.questions.order}
          >
            <SectionHeading
              eyebrow={sectionPresentation.questions.eyebrow}
              title={t("AI 问答", "Ask AI")}
              description={t(
                "所有 AI 回答均基于已审核数据与来源证据，事实 / 推断 / 未核验分开呈现。",
                "AI answers use reviewed data and source evidence; facts, inferences, and unverified claims remain distinct.",
              )}
            />
            <div className="paper-card p-5">
              <Tabs defaultValue="suggested">
                <TabsList>
                  <TabsTrigger value="suggested">{t("推荐问题", "Suggested")}</TabsTrigger>
                  <TabsTrigger value="ask">{t("我来提问", "Ask")}</TabsTrigger>
                </TabsList>
                <TabsContent value="suggested" className="mt-4 space-y-2">
                  {[
                    t(
                      `${displayLocalizedName.zh} 当前有哪些型号适合代码任务？`,
                      `Which current ${displayLocalizedName.en} models suit coding tasks?`,
                    ),
                    t(
                      `${displayLocalizedName.zh} 最近 30 天最重要的更新？`,
                      `Most important updates in the last 30 days`,
                    ),
                    t(
                      `${displayLocalizedName.zh} 有哪些争议或未核验说法？`,
                      `What claims about it are unverified or disputed?`,
                    ),
                  ].map((q, i) => (
                    <Link
                      key={i}
                      to="/ask"
                      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent/60 text-sm"
                    >
                      <MessagesSquare className="h-4 w-4 text-signal" />
                      <span className="flex-1">{q}</span>
                      <span className="text-xs text-signal">→</span>
                    </Link>
                  ))}
                </TabsContent>
                <TabsContent value="ask" className="mt-4">
                  <div className="flex gap-2">
                    <input
                      disabled
                      placeholder={t(
                        "演示版：请到 AI 研究页面提问",
                        "Demo: use the Ask page for full flow",
                      )}
                      className="flex-1 h-10 px-3 rounded-md border border-input bg-muted/40 text-sm"
                    />
                    <Button asChild>
                      <Link to="/ask">
                        <Send className="h-4 w-4" />
                        {t("去提问", "Go ask")}
                      </Link>
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ReadingModeSection>

          {/* 来源 */}
          <ReadingModeSection
            section="evidence"
            visible={sectionVisible("evidence")}
            order={sectionPresentation.evidence.order}
          >
            <SectionHeading
              eyebrow={sectionPresentation.evidence.eyebrow}
              title={t("来源", "Sources")}
              description={t(
                "这些是本页引用的资料；价格、渠道和规格请进入具体版本核对，并以官方页面为准。",
                "Sources cited on this page. Check each concrete release and its official page for pricing, access, and specifications.",
              )}
            />
            {sourceLinks.length > 0 ? (
              <div className="paper-card model-family__sources">
                {(mode === "technical" ? sourceLinks : sourceLinks.slice(0, 4)).map((source) => (
                  <SourceRow key={source.id} source={source} />
                ))}
                {mode !== "technical" && sourceLinks.length > 4 && (
                  <details>
                    <summary>
                      {t(
                        `展开其余 ${sourceLinks.length - 4} 个来源`,
                        `Show ${sourceLinks.length - 4} more sources`,
                      )}
                    </summary>
                    {sourceLinks.slice(4).map((source) => (
                      <SourceRow key={source.id} source={source} />
                    ))}
                  </details>
                )}
              </div>
            ) : (
              <p className="model-family__source-empty">
                {t(
                  "尚无可直接打开的来源。请以具体版本的官方资料为准。",
                  "No direct source links are available yet. Check each release's official documentation.",
                )}
              </p>
            )}
          </ReadingModeSection>
        </div>
      </div>
    </AppShell>
  );
}

function ModelVersionDetail({ entity, snapshot }: { entity: Entity; snapshot: KnowledgeSnapshot }) {
  const { t, lang } = useApp();
  const [activeTab, setActiveTab] = useState("overview");
  const family = snapshot.entities.find((item) => item.id === entity.familyId);
  const release = entity.release;
  const knowledge = entity.knowledge ?? createVersionKnowledge(entity, family);
  const familyVersions = snapshot.entities
    .filter((item) => item.familyId === entity.familyId)
    .sort(compareModelReleaseDates);
  const productLineVersions = release?.productLine
    ? familyVersions.filter((item) => item.release?.productLine?.id === release.productLine?.id)
    : familyVersions;
  const productLines = groupModelProductLines(familyVersions);
  const timeline = snapshot.timeline[entity.id] ?? [];
  const claims = snapshot.claims.filter((claim) => claim.entityId === entity.id);
  const recentChange = snapshot.changes.find((change) => change.entityId === entity.id);
  const relevantSourceIds = new Set([
    ...claims.flatMap((claim) => claim.sourceIds),
    ...timeline.flatMap((event) => event.sourceIds),
    ...(entity.metrics ?? []).flatMap((metric) => metric.sourceIds ?? []),
    ...(recentChange?.sourceIds ?? []),
    ...(snapshot.graph?.edges ?? [])
      .filter((relation) => relation.fromId === entity.id || relation.toId === entity.id)
      .flatMap((relation) => relation.sourceIds),
  ]);
  knowledge.keyPoints.forEach((point) =>
    point.sourceIds?.forEach((sourceId) => relevantSourceIds.add(sourceId)),
  );
  const officialUrls = new Set(
    release?.accessChannels.map((channel) => channel.url).filter(Boolean),
  );
  const evidence = snapshot.evidence.filter(
    (source) => relevantSourceIds.has(source.id) || officialUrls.has(source.url),
  );
  const sourceLinks = uniqueSourceLinks(evidence);
  const verifiedCount =
    claims.filter((claim) => claim.confidence === "verified").length +
    timeline.filter((event) => event.confidence === "verified").length +
    (entity.metrics ?? []).filter((metric) => metric.confidence === "verified").length +
    (entity.capabilities ?? []).filter((capability) => capability.confidence === "verified").length;
  const displayName = modelDisplayName(entity, lang);
  const familyName = family ? modelDisplayName(family, lang) : t("模型家族", "Model family");
  const capabilities = entity.capabilities ?? [];
  const releaseIndex = productLineVersions.findIndex((item) => item.id === entity.id);
  const latestUpdate = [
    entity.lastUpdatedAt,
    release?.lastVerifiedAt,
    recentChange?.date,
    timeline[0]?.date,
  ]
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const isPendingRelease = release?.stage === "pending";
  const specValue = (value?: string) => localizeModelSpec(value, lang);
  const specCards = [
    {
      label: t("上下文窗口", "Context window"),
      value: entity.specs?.contextWindow,
      hint: t("单次请求可处理的上下文", "Context available per request"),
    },
    {
      label: t("输入 / 输出模态", "Input / output"),
      value: entity.specs?.modalities,
      hint: t("官方支持的输入与输出类型", "Officially supported input and output types"),
    },
    {
      label: t("工具调用", "Tool use"),
      value: entity.specs?.toolUse,
      hint: t("函数与外部工具支持", "Functions and external tools"),
    },
    {
      label: t("版本标识", "Release ID"),
      value: release?.releaseId ?? entity.latestVersion ?? entity.slug,
      hint: t("用于区分具体发布版本", "Identifies this concrete release"),
    },
  ].filter((item) => item.value);
  const hasTokenPricing = Boolean(entity.specs?.inputPrice || entity.specs?.outputPrice);
  const showVersionAside = activeTab === "overview" || activeTab === "specs";
  const siblingVersions = productLineVersions.filter((version) => version.id !== entity.id);
  const nextVersions =
    siblingVersions.length > 0
      ? siblingVersions.slice(0, 3)
      : productLines
          .filter((line) => line.latest.id !== entity.id)
          .slice(0, 3)
          .map((line) => line.latest);

  return (
    <AppShell>
      <main className="model-version-page">
        <div className="model-version__breadcrumb">
          <Link to="/knowledge">{t("知识库", "Knowledge")}</Link>
          <span>/</span>
          {family ? (
            <Link to="/knowledge/model/$slug" params={{ slug: family.slug }}>
              {familyName}
            </Link>
          ) : (
            <span>{t("模型", "Models")}</span>
          )}
          <span>/</span>
          <strong>{displayName}</strong>
        </div>

        <div className="model-version__shell">
          <section className="model-version__header">
            <div className="model-version__header-main">
              <span
                className={`model-version__mark is-${family?.slug ?? entity.slug}`}
                aria-hidden="true"
              >
                {modelMarkText(family ?? entity)}
              </span>
              <div className="model-version__header-copy">
                <div className="model-version__title-row">
                  <h1>{displayName}</h1>
                  <span className="model-version__verified">
                    <span aria-hidden="true">✓</span>
                    {verifiedCount > 0
                      ? t("资料已验证", "Evidence verified")
                      : t("资料已收录", "Profile catalogued")}
                  </span>
                  {release && (
                    <span className={`model-version__stage is-${release.stage}`}>
                      {releaseStageLabel(release.stage, t)}
                    </span>
                  )}
                  <DemoBadge />
                </div>
                <div className="model-version__meta">
                  <span>
                    <Building2 aria-hidden="true" /> {entity.vendor ?? family?.vendor ?? "—"}
                  </span>
                  <i aria-hidden="true" />
                  <span>{familyName}</span>
                  <i aria-hidden="true" />
                  {release?.productLine && (
                    <>
                      <span>{pick(release.productLine.name, lang)}</span>
                      <i aria-hidden="true" />
                    </>
                  )}
                  <span>
                    {release?.releasedAt || entity.firstReleasedAt
                      ? `${t("发布于", "Released")} ${release?.releasedAt ?? entity.firstReleasedAt}`
                      : t("发布日期待核实", "Release date not verified")}
                  </span>
                </div>
                <p>{pick(entity.summary, lang)}</p>
              </div>
            </div>

            {capabilities.length > 0 && (
              <div className="model-version__tags" aria-label={t("能力标签", "Capabilities")}>
                {capabilities.slice(0, 6).map((capability, index) => (
                  <span key={`${capability.zh}-${index}`}>{pick(capability, lang)}</span>
                ))}
              </div>
            )}

            <div className="model-version__actions">
              {isPendingRelease ? (
                <span className="model-version__primary-action is-disabled" aria-disabled="true">
                  <ArrowLeftRight aria-hidden="true" />
                  {t(
                    "规格与入口核实后参与对比",
                    "Comparison requires verified specifications and access",
                  )}
                </span>
              ) : (
                <a
                  href={`/compare?models=${encodeURIComponent(entity.id)}`}
                  className="model-version__primary-action"
                >
                  <ArrowLeftRight aria-hidden="true" />
                  {t("进入模型对比", "Compare this release")}
                </a>
              )}
              {knowledge.officialUrl && (
                <a href={knowledge.officialUrl} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  {t("官方资料", "Official source")}
                </a>
              )}
            </div>
          </section>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="model-version__tabs-root">
            <div className="model-version__tabs-bar">
              <TabsList>
                <TabsTrigger value="overview" onClick={() => setActiveTab("overview")}>
                  {t("概览", "Overview")}
                </TabsTrigger>
                <TabsTrigger value="specs" onClick={() => setActiveTab("specs")}>
                  {t("技术规格", "Specifications")}
                </TabsTrigger>
                <TabsTrigger value="pricing" onClick={() => setActiveTab("pricing")}>
                  {t("定价", "Pricing")}
                </TabsTrigger>
                <TabsTrigger value="history" onClick={() => setActiveTab("history")}>
                  {t("更新历史", "History")}
                </TabsTrigger>
                <TabsTrigger value="evidence" onClick={() => setActiveTab("evidence")}>
                  {t("证据链", "Evidence")}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className={`model-version__layout${showVersionAside ? "" : " is-compact"}`}>
              <div className="model-version__main">
                <TabsContent value="overview">
                  <section className="model-version__panel">
                    <h2>{t("核心参数", "Key specifications")}</h2>
                    <div className="model-version__spec-grid">
                      {specCards.map((item) => (
                        <div key={item.label}>
                          <span>{item.label}</span>
                          <strong>{specValue(item.value)}</strong>
                          <small>{item.hint}</small>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="model-version__panel">
                    <h2>{t("核心能力", "Core capabilities")}</h2>
                    <div className="model-version__capabilities">
                      {capabilities.map((capability, index) => (
                        <div key={`${capability.zh}-${index}`}>
                          <span className="model-version__capability-icon" aria-hidden="true">
                            <Layers />
                          </span>
                          <div>
                            <strong>{pick(capability, lang)}</strong>
                          </div>
                          <ConfidenceChip level={capability.confidence} />
                        </div>
                      ))}
                      {capabilities.length === 0 && (
                        <p>{t("暂无已审核的能力记录。", "No reviewed capabilities yet.")}</p>
                      )}
                    </div>
                  </section>

                  {hasTokenPricing && (
                    <section className="model-version__panel">
                      <h2>{t("价格", "Pricing")}</h2>
                      <div className="model-version__price-grid">
                        <div>
                          <span>{t("输入定价", "Input price")}</span>
                          <strong>{specValue(entity.specs?.inputPrice)}</strong>
                          <small>
                            {t("以官方当前计费页为准", "Check the current official pricing page")}
                          </small>
                        </div>
                        <div>
                          <span>{t("输出定价", "Output price")}</span>
                          <strong>{specValue(entity.specs?.outputPrice)}</strong>
                          <small>
                            {t("价格为收录时点快照", "Price is a point-in-time snapshot")}
                          </small>
                        </div>
                      </div>
                    </section>
                  )}

                  {knowledge.useCases.length > 0 && (
                    <section className="model-version__panel">
                      <h2>{t("典型应用场景", "Typical use cases")}</h2>
                      <div className="model-version__use-cases">
                        {knowledge.useCases.map((useCase) => (
                          <span key={useCase.title.zh}>{pick(useCase.title, lang)}</span>
                        ))}
                      </div>
                    </section>
                  )}

                  {(timeline.length > 0 || recentChange) && (
                    <section className="model-version__panel">
                      <h2>{t("最近更新", "Recent updates")}</h2>
                      <VersionTimeline
                        timeline={timeline.slice(0, 3)}
                        fallback={recentChange}
                        lang={lang}
                        t={t}
                      />
                    </section>
                  )}
                </TabsContent>

                <TabsContent value="specs">
                  <section className="model-version__panel">
                    <div className="model-version__section-intro">
                      <div>
                        <span>{t("当前版本", "Current release")}</span>
                        <h2>{t("技术规格", "Technical specifications")}</h2>
                      </div>
                      <time>{entity.lastUpdatedAt}</time>
                    </div>
                    <dl className="model-version__spec-list">
                      <div>
                        <dt>{t("上下文窗口", "Context window")}</dt>
                        <dd>{specValue(entity.specs?.contextWindow)}</dd>
                      </div>
                      <div>
                        <dt>{t("输入 / 输出模态", "Input / output")}</dt>
                        <dd>{specValue(entity.specs?.modalities)}</dd>
                      </div>
                      <div>
                        <dt>{t("工具调用", "Tool use")}</dt>
                        <dd>{specValue(entity.specs?.toolUse)}</dd>
                      </div>
                      <div>
                        <dt>{t("可用渠道", "Availability")}</dt>
                        <dd>
                          {specValue(
                            entity.specs?.availability ??
                              release?.accessChannels
                                .map((channel) => channel.provider)
                                .join(" · "),
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("版本发布日期", "Release date")}</dt>
                        <dd>
                          {release?.releasedAt ??
                            entity.firstReleasedAt ??
                            t("待核实", "Not verified")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("状态", "Status")}</dt>
                        <dd>
                          {release
                            ? releaseStageLabel(release.stage, t)
                            : statusLabel(entity.status, t)}
                        </dd>
                      </div>
                      {release?.apiModelIds.length ? (
                        <div>
                          <dt>{t("API 型号", "API model IDs")}</dt>
                          <dd>{release.apiModelIds.join(" · ")}</dd>
                        </div>
                      ) : null}
                      {release?.lastVerifiedAt && (
                        <div>
                          <dt>{t("资料核验日期", "Last verified")}</dt>
                          <dd>{release.lastVerifiedAt}</dd>
                        </div>
                      )}
                    </dl>
                  </section>

                  {(entity.metrics?.length ?? 0) > 0 && (
                    <section className="model-version__panel">
                      <h2>{t("公开指标", "Published metrics")}</h2>
                      <div className="model-version__metrics">
                        {entity.metrics?.map((metric) => (
                          <div key={`${metric.name}-${metric.benchmark}`}>
                            <span>{metric.name}</span>
                            <strong>{metric.value}</strong>
                            <small>
                              {metric.benchmark} · {metric.date}
                            </small>
                            <ConfidenceChip level={metric.confidence} />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="model-version__panel">
                    <h2>{t("使用限制", "Limitations")}</h2>
                    <ul className="model-version__limitations">
                      {knowledge.limitations.map((item, index) => (
                        <li key={index}>{pick(item, lang)}</li>
                      ))}
                    </ul>
                  </section>
                </TabsContent>

                <TabsContent value="pricing">
                  <section className="model-version__panel">
                    <div className="model-version__section-intro">
                      <div>
                        <span>{t("收录快照", "Catalogued snapshot")}</span>
                        <h2>{t("定价与可用渠道", "Pricing and availability")}</h2>
                      </div>
                      <time>{entity.lastUpdatedAt}</time>
                    </div>
                    {hasTokenPricing ? (
                      <div className="model-version__price-grid is-large">
                        <div>
                          <span>{t("输入定价", "Input price")}</span>
                          <strong>{specValue(entity.specs?.inputPrice)}</strong>
                          <small>
                            {t(
                              "官方口径；可能随地区与批量方案变化",
                              "Official rate; region and batch plans may vary",
                            )}
                          </small>
                        </div>
                        <div>
                          <span>{t("输出定价", "Output price")}</span>
                          <strong>{specValue(entity.specs?.outputPrice)}</strong>
                          <small>
                            {t(
                              "使用前复核最新官方计费页",
                              "Recheck the latest official pricing page",
                            )}
                          </small>
                        </div>
                      </div>
                    ) : (
                      <p className="model-version__empty">
                        {t(
                          "本次未收录已核实的价格；请打开官方资料，核对具体渠道及计费单位。",
                          "This review has no verified price. Open the official source to check the exact channel and billing unit.",
                        )}
                      </p>
                    )}
                    <div className="model-version__availability">
                      <span>{t("可用渠道", "Availability")}</span>
                      <strong>
                        {specValue(
                          entity.specs?.availability ??
                            release?.accessChannels.map((channel) => channel.provider).join(" · "),
                        )}
                      </strong>
                    </div>
                    {release?.accessChannels.length ? (
                      <div className="model-version__channel-list">
                        {release.accessChannels.map((channel, index) => {
                          const content = (
                            <>
                              <strong>{channel.provider}</strong>
                              <span>{channel.modelId ?? accessChannelLabel(channel.type, t)}</span>
                            </>
                          );
                          return channel.url ? (
                            <a
                              key={`${channel.provider}-${channel.modelId ?? index}`}
                              href={channel.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {content}
                              <ExternalLink aria-hidden="true" />
                            </a>
                          ) : (
                            <div key={`${channel.provider}-${channel.modelId ?? index}`}>
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                </TabsContent>

                <TabsContent value="history">
                  <section className="model-version__panel">
                    <div className="model-version__section-intro">
                      <div>
                        <span>{familyName}</span>
                        <h2>{t("此版本的更新记录", "Updates for this release")}</h2>
                      </div>
                      <time>{latestUpdate}</time>
                    </div>
                    <VersionTimeline
                      timeline={timeline}
                      fallback={recentChange}
                      officialUrl={knowledge.officialUrl}
                      lang={lang}
                      t={t}
                    />
                  </section>
                </TabsContent>

                <TabsContent value="evidence">
                  {claims.length > 0 && (
                    <section className="model-version__panel mb-5">
                      <div className="model-version__section-intro">
                        <div>
                          <span>{t("审核结论", "Reviewed findings")}</span>
                          <h2>{t("事实与依据", "Facts & evidence")}</h2>
                        </div>
                      </div>
                      <ReviewedFacts entityId={entity.id} claims={claims} evidence={evidence} />
                    </section>
                  )}
                  <section className="model-version__panel">
                    <div className="model-version__section-intro">
                      <div>
                        <span>{t("可追溯资料", "Traceable records")}</span>
                        <h2>{t("证据来源", "Evidence sources")}</h2>
                      </div>
                      <strong>
                        {t(`${sourceLinks.length} 条`, `${sourceLinks.length} sources`)}
                      </strong>
                    </div>
                    {sourceLinks.length > 0 ? (
                      <div className="model-version__sources">
                        {sourceLinks.map((source) => (
                          <SourceRow key={source.id} source={source} />
                        ))}
                      </div>
                    ) : (
                      <p className="model-version__empty">
                        {t("暂无可直接展示的来源记录。", "No directly displayable sources yet.")}
                      </p>
                    )}
                  </section>
                </TabsContent>
                {!showVersionAside && family && (
                  <nav
                    className="model-version__next-releases"
                    aria-label={t("继续查看模型版本", "Explore more model releases")}
                  >
                    <span>
                      {siblingVersions.length > 0
                        ? t("继续查看同产品线", "More from this line")
                        : t("继续查看家族", "Explore the family")}
                    </span>
                    <div>
                      {nextVersions.map((version) => (
                        <Link
                          key={version.id}
                          to="/knowledge/model/$slug"
                          params={{ slug: version.slug }}
                        >
                          {modelDisplayName(version, lang)} <span aria-hidden="true">→</span>
                        </Link>
                      ))}
                      <Link to="/knowledge/model/$slug" params={{ slug: family.slug }}>
                        {t("全部产品线", "All product lines")} <span aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </nav>
                )}
              </div>

              {showVersionAside && (
                <aside className="model-version__aside">
                  <section>
                    <div className="model-version__aside-title">
                      <h2>
                        {release?.productLine
                          ? t("同产品线版本", "Product-line releases")
                          : t("同家族版本", "Family releases")}
                      </h2>
                      {family && (
                        <Link to="/knowledge/model/$slug" params={{ slug: family.slug }}>
                          {t("查看系列", "Family page")}
                        </Link>
                      )}
                    </div>
                    <div className="model-version__release-list">
                      {productLineVersions.map((version, index) => (
                        <Link
                          key={version.id}
                          to="/knowledge/model/$slug"
                          params={{ slug: version.slug }}
                          className={version.id === entity.id ? "is-current" : undefined}
                          aria-current={version.id === entity.id ? "page" : undefined}
                        >
                          <span
                            className={`model-version__release-mark is-${family?.slug ?? version.slug}`}
                            aria-hidden="true"
                          >
                            {modelMarkText(family ?? version)}
                          </span>
                          <span>
                            <strong>{modelDisplayName(version, lang)}</strong>
                            <small>
                              {version.release?.releasedAt ??
                                version.firstReleasedAt ??
                                t("日期未收录", "Date not catalogued")}
                            </small>
                          </span>
                          {(version.id === entity.id || index === 0) && (
                            <em>
                              {version.id === entity.id
                                ? t("当前", "Current")
                                : t("代表", "Representative")}
                            </em>
                          )}
                        </Link>
                      ))}
                    </div>
                  </section>

                  {productLines.length > 1 && (
                    <section>
                      <div className="model-version__aside-title">
                        <h2>{t("家族产品线", "Product lines")}</h2>
                      </div>
                      <div className="model-version__line-list">
                        {productLines.map((line) => (
                          <Link
                            key={line.id}
                            to="/knowledge/model/$slug"
                            params={{ slug: line.latest.slug }}
                            className={
                              line.id === release?.productLine?.id ? "is-current" : undefined
                            }
                          >
                            <strong>{pick(line.name, lang)}</strong>
                            <small>
                              {t(
                                `${line.versions.length} 个版本`,
                                `${line.versions.length} release${line.versions.length === 1 ? "" : "s"}`,
                              )}
                              {" · "}
                              {modelDisplayName(line.latest, lang)}
                            </small>
                          </Link>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <h2>{t("提供商信息", "Provider")}</h2>
                    <div className="model-version__provider">
                      <span aria-hidden="true">
                        <Building2 />
                      </span>
                      <div>
                        <strong>{entity.vendor ?? family?.vendor ?? "—"}</strong>
                        <small>{regionLabel(entity, t)}</small>
                      </div>
                    </div>
                    <dl className="model-version__facts">
                      <div>
                        <dt>{t("所属系列", "Model family")}</dt>
                        <dd>{familyName}</dd>
                      </div>
                      <div>
                        <dt>{t("系列版本", "Releases")}</dt>
                        <dd>{t(`${familyVersions.length} 个`, `${familyVersions.length}`)}</dd>
                      </div>
                      {release?.productLine && (
                        <div>
                          <dt>{t("所属产品线", "Product line")}</dt>
                          <dd>{pick(release.productLine.name, lang)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>{t("当前序位", "Release order")}</dt>
                        <dd>
                          {releaseIndex >= 0
                            ? `${releaseIndex + 1} / ${productLineVersions.length}`
                            : "—"}
                        </dd>
                      </div>
                      {release && (
                        <div>
                          <dt>{t("代际 / 型号", "Generation / variant")}</dt>
                          <dd>{`${release.generation} · ${release.variant}`}</dd>
                        </div>
                      )}
                    </dl>
                  </section>

                  <section className="model-version__evidence-card">
                    <h2>{t("证据统计", "Evidence overview")}</h2>
                    <dl>
                      <div>
                        <dt>{t("已验证记录", "Verified records")}</dt>
                        <dd>{verifiedCount}</dd>
                      </div>
                      <div>
                        <dt>{t("证据来源", "Sources")}</dt>
                        <dd>{sourceLinks.length}</dd>
                      </div>
                      <div>
                        <dt>{t("最后更新", "Last updated")}</dt>
                        <dd>{latestUpdate}</dd>
                      </div>
                    </dl>
                  </section>
                </aside>
              )}
            </div>
          </Tabs>
        </div>
      </main>
    </AppShell>
  );
}

function VersionTimeline({
  timeline,
  fallback,
  officialUrl,
  lang,
  t,
}: {
  timeline: KnowledgeSnapshot["timeline"][string];
  fallback?: KnowledgeSnapshot["changes"][number];
  officialUrl?: string;
  lang: "zh" | "en";
  t: (zh: string, en: string) => string;
}) {
  const items = timeline.length
    ? timeline.map((item) => ({
        id: item.id,
        date: item.date,
        title: pick(item.title, lang),
        summary: pick(item.summary, lang),
        kind: item.changeKind ?? item.kind,
        confidence: item.confidence,
      }))
    : fallback
      ? [
          {
            id: fallback.id,
            date: fallback.date,
            title: t("资料更新", "Profile update"),
            summary: pick(fallback.summary, lang),
            kind: fallback.kind,
            confidence: fallback.confidence,
          },
        ]
      : [];

  if (items.length === 0) {
    return (
      <div className="model-version__history-empty">
        <p>
          {t(
            "本页尚无可直接展示的后续更新；查看官方资料可核对当前发布说明。",
            "No later update is catalogued here. Check the official source for current model details.",
          )}
        </p>
        {officialUrl && (
          <a href={officialUrl} target="_blank" rel="noreferrer">
            {t("查看官方资料", "Open official source")} <ExternalLink aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="model-version__timeline">
      {items.map((item) => (
        <article key={item.id}>
          <time>
            <span>{item.date.slice(0, 7)}</span>
            <strong>{item.date.slice(8, 10) || "—"}</strong>
          </time>
          <div>
            <div>
              <span>{timelineKindLabel(item.kind, t)}</span>
              <ConfidenceChip level={item.confidence} />
            </div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function timelineKindLabel(kind: string, t: (zh: string, en: string) => string) {
  const labels: Record<string, [string, string]> = {
    release: ["版本发布", "Release"],
    update: ["能力更新", "Update"],
    paper: ["研究资料", "Research"],
    benchmark: ["评测更新", "Benchmark"],
    incident: ["事件记录", "Incident"],
    deprecation: ["停止支持", "Deprecation"],
    new: ["新增资料", "New record"],
    updated: ["资料更新", "Updated"],
    pricing: ["价格与额度", "Pricing & limits"],
    availability: ["开放与访问", "Access"],
    deprecated: ["状态变化", "Status change"],
    rumor: ["待核传闻", "Unverified report"],
  };
  const label = labels[kind] ?? ["资料更新", "Update"];
  return t(label[0], label[1]);
}

function statusLabel(status: Entity["status"], t: (zh: string, en: string) => string) {
  const labels: Record<Entity["status"], [string, string]> = {
    active: ["可用", "Active"],
    preview: ["预览", "Preview"],
    deprecated: ["已停用", "Deprecated"],
    rumor: ["待核实", "Unverified"],
  };
  return t(labels[status][0], labels[status][1]);
}

function releaseStageLabel(
  stage: NonNullable<Entity["release"]>["stage"],
  t: (zh: string, en: string) => string,
) {
  const labels: Record<NonNullable<Entity["release"]>["stage"], [string, string]> = {
    stable: ["正式版", "Stable"],
    preview: ["预览版本", "Preview"],
    pending: ["待核实", "Not verified"],
    deprecated: ["停止新增接入", "Deprecated"],
    retired: ["已退役", "Retired"],
  };
  return t(labels[stage][0], labels[stage][1]);
}

function accessChannelLabel(
  type: NonNullable<Entity["release"]>["accessChannels"][number]["type"],
  t: (zh: string, en: string) => string,
) {
  const labels: Record<
    NonNullable<Entity["release"]>["accessChannels"][number]["type"],
    [string, string]
  > = {
    "official-api": ["官方 API", "Official API"],
    "first-party-product": ["第一方产品", "First-party product"],
    "managed-cloud": ["云平台托管", "Managed cloud"],
    "open-weights": ["开放权重", "Open weights"],
    "restricted-access": ["受限访问", "Restricted access"],
  };
  return t(labels[type][0], labels[type][1]);
}

function FamilyLineSummary({
  lines,
  mode,
}: {
  lines: ProductLineGroup[];
  mode: "general" | "product";
}) {
  const { t, lang } = useApp();

  return (
    <div className={`model-family__atlas is-${mode}`}>
      {lines.map((line) => {
        const inputPrice = line.latest.specs?.inputPrice;
        const outputPrice = line.latest.specs?.outputPrice;
        const channels = line.latest.release?.accessChannels
          .map((channel) => channel.provider)
          .filter((provider, index, providers) => providers.indexOf(provider) === index)
          .join(" · ");
        const capabilities = (line.latest.capabilities ?? [])
          .filter((capability) => capability.confidence === "verified")
          .slice(0, 2);

        return (
          <article key={line.id} id={`product-line-${line.id}`}>
            <div className="model-family__atlas-heading">
              <h3>{pick(line.name, lang)}</h3>
              <span>{t(`${line.versions.length} 个版本`, `${line.versions.length} releases`)}</span>
            </div>
            <p>{pick(line.positioning, lang)}</p>
            {capabilities.length > 0 && (
              <div
                className="model-family__atlas-capabilities"
                aria-label={t("已核验能力", "Verified capabilities")}
              >
                {capabilities.map((capability) => (
                  <span key={capability.zh}>{pick(capability, lang)}</span>
                ))}
              </div>
            )}
            <Link
              className="model-family__atlas-latest"
              to="/knowledge/model/$slug"
              params={{ slug: line.latest.slug }}
            >
              <span>{t("代表版本", "Representative release")}</span>
              <strong>{modelDisplayName(line.latest, lang)}</strong>
              <span aria-hidden="true">→</span>
            </Link>

            {mode === "product" && (
              <dl className="model-family__adoption-facts">
                <div>
                  <dt>{t("可用入口", "Access")}</dt>
                  <dd>{channels || t("未收录渠道", "No channel catalogued")}</dd>
                </div>
                <div>
                  <dt>{t("输入 / 输出价格", "Input / output price")}</dt>
                  <dd>
                    {inputPrice && outputPrice
                      ? `${localizeModelSpec(inputPrice, lang)} / ${localizeModelSpec(outputPrice, lang)}`
                      : t("未收录可比单价", "No comparable rate catalogued")}
                  </dd>
                </div>
                <div>
                  <dt>{t("上下文窗口", "Context window")}</dt>
                  <dd>{localizeModelSpec(line.latest.specs?.contextWindow, lang)}</dd>
                </div>
                <div>
                  <dt>{t("版本状态 · 发布", "Stage · released")}</dt>
                  <dd>
                    {releaseStageLabel(line.latest.release?.stage ?? "stable", t)} ·{" "}
                    {line.latest.release?.releasedAt ?? line.latest.firstReleasedAt ?? "—"}
                  </dd>
                </div>
              </dl>
            )}

            {line.versions.length > 1 && (
              <details className="model-family__all-versions">
                <summary>
                  {t(
                    `查看全部 ${line.versions.length} 个版本`,
                    `Show all ${line.versions.length} releases`,
                  )}
                </summary>
                <div>
                  {line.versions.map((version) => (
                    <Link
                      key={version.id}
                      to="/knowledge/model/$slug"
                      params={{ slug: version.slug }}
                    >
                      <span>{modelDisplayName(version, lang)}</span>
                      <small>
                        {version.release?.releasedAt ?? version.firstReleasedAt ?? "—"} ·{" "}
                        {releaseStageLabel(version.release?.stage ?? "stable", t)}
                      </small>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}

function FamilyTimeline({
  events,
  sources,
  number,
}: {
  events: TimelineEvent[];
  sources: Source[];
  number: string;
}) {
  const { t, lang } = useApp();
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const sortedEvents = familyEvolutionEvents(events);
  const recentEvents = sortedEvents.slice(0, 3);
  const earlierEvents = sortedEvents.slice(3);
  const renderEvent = (event: TimelineEvent) => {
    const source = event.sourceIds.map((id) => sourcesById.get(id)).find(Boolean);
    return (
      <li key={event.id}>
        <time dateTime={event.date}>{event.date}</time>
        <div>
          <h3>{pick(event.title, lang)}</h3>
          <p>{pick(event.summary, lang)}</p>
          {source && (
            <a href={source.url} target="_blank" rel="noreferrer">
              {t("核对来源", "Check source")} <ExternalLink aria-hidden="true" />
            </a>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="model-family__timeline">
      <div className="model-family__timeline-heading">
        <h2>
          <span aria-hidden="true">{number}</span>
          {t("演进时间线", "Evolution timeline")}
        </h2>
        <span>{t(`${sortedEvents.length} 个关键节点`, `${sortedEvents.length} milestones`)}</span>
      </div>
      <ol>{recentEvents.map(renderEvent)}</ol>
      {earlierEvents.length > 0 && (
        <details className="model-family__timeline-archive">
          <summary>
            {t(
              `查看更早的 ${earlierEvents.length} 个节点`,
              `Show ${earlierEvents.length} earlier milestones`,
            )}
          </summary>
          <ol>{earlierEvents.map(renderEvent)}</ol>
        </details>
      )}
    </div>
  );
}

function ReadingModeSection({
  section,
  id,
  visible,
  order,
  children,
}: {
  section: EntitySection;
  id?: string;
  visible: boolean;
  order: number;
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <section id={id} className="scroll-mt-24" data-reading-section={section} style={{ order }}>
      {children}
    </section>
  );
}

const MODEL_SPEC_EN: Record<string, string> = {
  "256K tokens（1M 未核验）": "256K tokens (1M unverified)",
  "256K tokens（演示）": "256K tokens (demo)",
  "2M tokens（预览）": "2M tokens (preview)",
  "32K 示例配置；依具体变体而定": "32K sample configuration; varies by model variant",
  官方发布页未单列: "Not listed separately on the official release page",
  官方模型页未单列: "Not listed separately on the official model page",
  "训练阶段扩展至 128K tokens": "Extended to 128K tokens during training",
  文本: "Text",
  "文本 · 图像": "Text · Image",
  "文本 · 图像 · 音频": "Text · Image · Audio",
  "文本 · 图像 · 视频": "Text · Image · Video",
  "文本 · 图像 · 视频 · 音频": "Text · Image · Video · Audio",
  "文本 · 图像 · 音频 · 视频": "Text · Image · Audio · Video",
  "文本 · 图像 · 视频 · 音频 · PDF 输入；文本输出":
    "Text, image, video, audio and PDF input; text output",
  "文本 · 图像 · 视频 · 音频输入；文本输出": "Text, image, video and audio input; text output",
  "文本 · 图像 · 音频 · 视频输入；文本 · 音频输出":
    "Text, image, audio and video input; text and audio output",
  "语音输入；翻译语音输出": "Speech input; translated speech output",
  "语音输入；语音输出": "Speech input; speech output",
  "音频 · 视频输入；音频输出": "Audio and video input; audio output",
  "文本输入；音频输出": "Text input; audio output",
  "音频输入；文本输出": "Audio input; text output",
  "文本 · 图像输入；图像输出": "Text and image input; image output",
  "文本 · 图像 · 视频输入；视频输出": "Text, image and video input; video output",
  "文本输入；引用报告输出": "Text input; cited-report output",
  "异步函数调用 · 搜索 Grounding · Live API":
    "Asynchronous function calling · Search grounding · Live API",
  "函数调用 · 代码执行 · 结构化输出 · 搜索 Grounding":
    "Function calling · Code execution · Structured outputs · Search grounding",
  "函数调用 · 代码执行 · 计算机操作 · 结构化输出":
    "Function calling · Code execution · Computer use · Structured outputs",
  "函数调用 · 代码执行 · 结构化输出": "Function calling · Code execution · Structured outputs",
  "Gemini Developer API（Live API）": "Gemini Developer API (Live API)",
  "Gemini Developer API（Live API 预览）": "Gemini Developer API (Live API preview)",
  "Gemini Developer API（预览）": "Gemini Developer API (preview)",
  "Gemini Developer API（既有项目）": "Gemini Developer API (existing projects)",
  已停用: "Shut down",
  "文本 · 图像 · 视频理解": "Text · Image · Video understanding",
  "文本 · 以官方 API 目录为准": "Text · See the official API catalog",
  "文本 · 以具体服务入口为准": "Text · Varies by service endpoint",
  函数调用: "Function calling",
  "函数调用 · 结构化输出": "Function calling · Structured outputs",
  "函数调用 · JSON 输出": "Function calling · JSON output",
  "函数调用 · 代码执行": "Function calling · Code execution",
  "函数调用 · 代码执行 · 搜索增强": "Function calling · Code execution · Search augmentation",
  "函数调用 · 代码沙箱 · Agent 编排": "Function calling · Code sandbox · Agent orchestration",
  "并行工具调用 · Agent 编排": "Parallel tool calls · Agent orchestration",
  "并行工具调用 · Computer use": "Parallel tool calls · Computer use",
  "并行工具调用 · MCP · Computer use": "Parallel tool calls · MCP · Computer use",
  "工具调用 · Computer use": "Tool use · Computer use",
  "代码 · 深度推理 · 平台工具生态": "Code · Deep reasoning · Platform tool ecosystem",
  "复杂指令 · 长程 Agent · 工具调用": "Complex instructions · Long-horizon agents · Tool use",
  "思考模式 · 代码 Agent · 工具调用": "Thinking mode · Coding agents · Tool use",
  "思考模式 · FastDeploy · OpenAI 兼容接口": "Thinking mode · FastDeploy · OpenAI-compatible API",
  "搜索 · 代码 · GUI Agent · 三种思考模式": "Search · Code · GUI agents · Three thinking modes",
  "推理 · 代码 · Agent 工具使用": "Reasoning · Code · Agent tool use",
  "Agent · 深度搜索 · 代码沙箱 · 工具调用": "Agents · Deep search · Code sandbox · Tool use",
  "百炼 API · 通义千问": "Model Studio API · Qwen",
  "百炼 API": "Model Studio API",
  "火山方舟 · 豆包": "Volcano Engine Ark · Doubao",
  "火山方舟 API · 豆包专家模式": "Volcano Engine Ark API · Doubao expert mode",
  "文心 · 千帆大模型平台": "ERNIE · Qianfan platform",
  "文心 · AI Studio · 千帆大模型平台": "ERNIE · AI Studio · Qianfan platform",
  "预览 API · 开放权重计划": "Preview API · Planned open-weight release",
  "API · 开放权重": "API · Open weights",
  "Hugging Face · 飞桨 · AI Studio": "Hugging Face · PaddlePaddle · AI Studio",
  火山方舟实时计费: "Live pricing on Volcano Engine Ark",
  "开放权重 / 云平台实时计费": "Open weights / live cloud-platform pricing",
  "开放权重 / API（演示）": "Open weights / API (demo)",
  千帆平台实时计费: "Live pricing on the Qianfan platform",
  随地区与云平台计费: "Varies by region and cloud platform",
  "随地区与云平台计费（演示）": "Varies by region and cloud platform (demo)",
  "API 或自托管（随平台变化）": "API or self-hosted (varies by platform)",
};

function ModelSpecValue({ value, lang }: { value?: string; lang: "zh" | "en" }) {
  return localizeModelSpec(value, lang)
    .split(" · ")
    .map((part, index) => (
      <span className="model-spec__segment" key={index}>
        {index > 0 ? " · " : ""}
        {part}
      </span>
    ));
}

function localizeModelSpec(value: string | undefined, lang: "zh" | "en") {
  if (!value) return lang === "zh" ? "待核实" : "Not verified";
  if (lang === "zh") return modelSpecChinese(value);
  if (MODEL_SPEC_EN[value]) return MODEL_SPEC_EN[value];
  return value.replaceAll("（演示）", " (demo)").replaceAll("（预览）", " (preview)");
}

function createVersionKnowledge(
  entity: Entity,
  family?: Entity,
): NonNullable<EntityDetail["knowledge"]> {
  const familyName = family
    ? { zh: modelDisplayName(family, "zh"), en: modelDisplayName(family, "en") }
    : { zh: "所属模型", en: "its model family" };
  const release = entity.firstReleasedAt ?? "—";
  const context = entity.specs?.contextWindow ?? "待核实";
  const availability = entity.specs?.availability ?? "以官方平台为准";
  const inputPrice = entity.specs?.inputPrice ?? "待核实";
  const outputPrice = entity.specs?.outputPrice ?? "待核实";
  const topCapabilities = (entity.capabilities ?? []).slice(0, 3);

  return {
    introduction: [
      {
        zh: `${entity.name.zh} 是 ${familyName.zh} 中的一个具体版本，而不是整个模型系列。它的价值要结合发布时间、上下文窗口、可用渠道、工具能力和价格一起判断。`,
        en: `${entity.name.en} is a concrete release in ${familyName.en}, not the entire family. Its value should be judged using release date, context window, availability, tool support and price together.`,
      },
      entity.summary,
    ],
    significance: {
      zh: `选择模型时，具体版本比系列名称更有决策价值。${entity.name.zh} 的规格代表某个时间点的产品状态，不能直接套用到同系列的更早或更新版本。`,
      en: `Concrete releases are more useful for decisions than family names. The specifications for ${entity.name.en} describe one point in time and should not be applied to every release in the same family.`,
    },
    keyPoints: [
      {
        title: { zh: "版本位置", en: "Release position" },
        description: {
          zh: `属于 ${familyName.zh}；首次发布于 ${release}。`,
          en: `Part of ${familyName.en}; first released on ${release}.`,
        },
      },
      {
        title: { zh: "上下文与渠道", en: "Context and access" },
        description: {
          zh: `上下文：${context}；可用渠道：${availability}。`,
          en: `Context: ${localizeModelSpec(context, "en")}; availability: ${localizeModelSpec(availability, "en")}.`,
        },
      },
      {
        title: { zh: "价格快照", en: "Price snapshot" },
        description: {
          zh: `输入：${inputPrice}；输出：${outputPrice}。价格是页面记录时的快照，使用前应复核官方计费页。`,
          en: `Input: ${localizeModelSpec(inputPrice, "en")}; output: ${localizeModelSpec(outputPrice, "en")}. Prices are snapshots and should be rechecked against the official pricing page before use.`,
        },
      },
    ],
    useCases:
      topCapabilities.length > 0
        ? topCapabilities.map((capability) => ({
            title: { zh: capability.zh, en: capability.en },
            description: {
              zh: `当任务核心需求是“${capability.zh}”时，可将该版本纳入候选，并继续核对成本、延迟与部署限制。`,
              en: `Shortlist this release when the task requires ${capability.en.toLowerCase()}, then verify cost, latency and deployment constraints.`,
            },
          }))
        : [
            {
              title: { zh: "通用任务评估", en: "General task evaluation" },
              description: {
                zh: "先用真实业务样本进行小规模评测，再决定是否进入生产环境。",
                en: "Evaluate with real task samples before adopting it in production.",
              },
            },
          ],
    limitations: [
      ...(entity.release?.stage === "retired"
        ? [
            {
              zh: "该 API 型号已下线，仅保留历史资料，不应作为新项目候选。",
              en: "This API model is shut down and is retained for historical reference, not new projects.",
            },
          ]
        : entity.release?.stage === "deprecated"
          ? [
              {
                zh: `官方已公布迁移或下线计划${entity.release.retirementNotBefore ? `；最早下线日期为 ${entity.release.retirementNotBefore}` : ""}。`,
                en: `Google has announced a migration or shutdown plan${entity.release.retirementNotBefore ? `; the earliest shutdown date is ${entity.release.retirementNotBefore}` : ""}.`,
              },
            ]
          : entity.release?.stage === "preview"
            ? [
                {
                  zh: "预览版接口与可用范围可能调整，上线前应复核官方型号页。",
                  en: "Preview endpoints and availability may change; recheck the official model page before production use.",
                },
              ]
            : []),
      {
        zh: "未收录的规格或价格不表示该能力不存在、免费或不可用，应以具体 API 渠道的官方文档为准。",
        en: "Missing specifications or prices do not mean a feature is absent, free, or unavailable; check the official documentation for the actual API channel.",
      },
      {
        zh: "同产品线不同版本的能力、限制与计费可能不同，对比时应选择具体型号。",
        en: "Capabilities, limits and billing can vary across releases in the same product line; compare concrete model IDs.",
      },
    ],
    officialUrl:
      entity.release?.accessChannels.find((channel) => channel.url)?.url ??
      family?.knowledge?.officialUrl,
  };
}

function regionLabel(entity: Entity, t: (zh: string, en: string) => string) {
  if (!entity.origin) return "—";
  return ["中国", "国内", "China", "Domestic"].includes(entity.origin.zh) ||
    ["中国", "国内", "China", "Domestic"].includes(entity.origin.en)
    ? t("国内", "Domestic")
    : t("海外", "Overseas");
}

function modelMarkText(entity: Entity) {
  const initials: Record<string, string> = {
    gpt: "G",
    claude: "C",
    gemini: "G",
    deepseek: "DS",
    qwen: "Q",
    kimi: "K",
    doubao: "D",
    ernie: "E",
  };
  if (initials[entity.slug]) return initials[entity.slug];
  return (entity.name.en || entity.name.zh).slice(0, 2);
}

function ProfileField({
  label,
  value,
  wide = false,
  mono = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`mt-1 leading-relaxed text-foreground ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
