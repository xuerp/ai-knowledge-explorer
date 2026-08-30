import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import {
  Building2,
  Calendar,
  GitBranch,
  Send,
  MessagesSquare,
  Sparkles,
  ArrowLeftRight,
  ExternalLink,
  Layers,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeArticle } from "@/components/knowledge/KnowledgeArticle";
import { ReviewedFacts } from "@/components/knowledge/ReviewedFacts";
import {
  DemoBadge,
  ConfidenceChip,
  SectionHeading,
  SourceRow,
  EntityChip,
} from "@/components/common";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import {
  getEntitySectionPresentation,
  getReadingModeOption,
  getVisibleEntitySections,
  type EntitySection,
} from "@/domain/reading-mode";
import { useApp, pick } from "@/lib/app-state";
import { knowledgeRepository } from "@/services/knowledge-repository";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Entity, EntityDetail, KnowledgeSnapshot } from "@/domain/types";

export const Route = createFileRoute("/knowledge_/model/$slug")({
  loader: async ({ params }) => {
    const snapshot = await knowledgeRepository.getSnapshot();
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
        { title: `${e.name.zh} ${e.name.en} · AI Radar` },
        { name: "description", content: e.summary.zh },
        { property: "og:title", content: `${e.name.zh} · AI Radar` },
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
  const { t, lang, mode } = useApp();
  const { entities, evidence: allEvidence, timeline: allTimeline, graph } = snapshot;
  const relations = graph.edges;
  const findEntity = (id: string) => entities.find((entity) => entity.id === id);

  // Local graph: this entity + neighbors
  const neighborIds = useMemo(() => {
    const ids = new Set<string>([e.id]);
    relations.forEach((r) => {
      if (r.fromId === e.id) ids.add(r.toId);
      if (r.toId === e.id) ids.add(r.fromId);
    });
    return Array.from(ids);
  }, [e.id, relations]);

  const timeline = allTimeline[e.id] ?? [];
  const reviewedClaims = snapshot.claims.filter((claim) => claim.entityId === e.id);
  const recentChange = snapshot.changes.find((change) => change.entityId === e.id);
  const relatedRelations = relations.filter((r) => r.fromId === e.id || r.toId === e.id);
  const childVersions = entities
    .filter((entity) => entity.familyId === e.id)
    .sort((a, b) => (a.firstReleasedAt ?? "").localeCompare(b.firstReleasedAt ?? ""));
  const parentFamily = e.familyId ? findEntity(e.familyId) : undefined;
  const knowledge = e.knowledge ?? createVersionKnowledge(e, parentFamily);
  const relevantSourceIds = new Set([
    ...reviewedClaims.flatMap((claim) => claim.sourceIds),
    ...relatedRelations.flatMap((relation) => relation.sourceIds),
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
  const evidence = allEvidence.filter((source) => relevantSourceIds.has(source.id));

  const availableSections: EntitySection[] = [
    "guide",
    "profile",
    ...(reviewedClaims.length > 0 ? (["claims"] as const) : []),
    ...(childVersions.length > 0 ? (["lineage"] as const) : []),
    "relationships",
    "timeline",
    "comparison",
    "questions",
    "evidence",
  ];
  const visibleSections = getVisibleEntitySections(mode, "model", availableSections);
  const sectionVisible = (section: EntitySection) => visibleSections.includes(section);
  const sectionPresentation = getEntitySectionPresentation(mode, "model", visibleSections);
  const readingMode = getReadingModeOption(mode);
  const competitors = relatedRelations
    .filter((r) => r.kind === "competes-with")
    .map((r) => findEntity(r.fromId === e.id ? r.toId : r.fromId))
    .filter(Boolean);

  return (
    <AppShell>
      <div>
        <div className="page-container pb-5 pt-8 md:pt-10">
          <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
            <Link to="/knowledge" className="hover:text-signal">
              {t("知识库", "Knowledge")}
            </Link>
            <span>/</span>
            <span>{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
            <span>/</span>
            <span className="text-foreground">{pick(e.name, lang)}</span>
          </div>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="chip">{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
                {e.vendor && (
                  <span className="chip inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> {e.vendor}
                  </span>
                )}
                {e.latestVersion && <span className="chip font-mono">{e.latestVersion}</span>}
                <DemoBadge />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                {pick(e.name, lang)}
              </h1>
              <p className="mt-3 text-base text-ink-soft max-w-3xl leading-relaxed">
                {pick(e.summary, lang)}
              </p>
            </div>
            <div className="flex gap-2">
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
              <Link
                to="/graph"
                search={{ entity: e.id, mode: "ecosystem" }}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
              >
                <GitBranch className="h-4 w-4" />
                {t("分析关联", "Analyze relationships")}
              </Link>
              <Link
                to="/ask"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-signal text-signal-foreground text-sm font-medium hover:opacity-90"
              >
                <Sparkles className="h-4 w-4" />
                {t("向 AI 提问", "Ask AI")}
              </Link>
            </div>
          </div>
          {recentChange && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#f4c767] bg-[#fffbeb] px-4 py-3 text-sm">
              <span className="font-semibold text-[#b45309]">{t("最近变化", "Latest change")}</span>
              <span className="min-w-0 flex-1 text-[#92400e]">
                {pick(recentChange.summary, lang)}
              </span>
              <time className="font-mono text-[11px] text-[#b45309]">{recentChange.date}</time>
              <Link
                to="/graph"
                search={{ entity: e.id, mode: "impact" }}
                className="text-xs font-medium text-signal hover:underline"
              >
                {t("查看关联范围", "View relationship reach")} →
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="page-container flex flex-col gap-12 pb-12 pt-5">
        <div
          className="rounded-xl border border-signal/20 bg-signal/5 px-5 py-4"
          data-reading-focus={mode}
        >
          <div className="text-sm font-semibold text-signal">{pick(readingMode.label, lang)}</div>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            {pick(readingMode.description, lang)}{" "}
            {t(
              "页面只展开本模式的重点信息。",
              "Only this mode's priority information is expanded on the page.",
            )}
          </p>
        </div>

        <div data-reading-section="guide" style={{ order: sectionPresentation.guide.order }}>
          <KnowledgeArticle
            knowledge={knowledge}
            entityName={e.name}
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
            description={t(
              "关于该实体的核心事实、能力与最新指标，所有条目都标注置信度与来源。",
              "Core facts, capabilities and latest metrics — each carries a confidence label and sources.",
            )}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="paper-card p-5">
              <h3 className="mb-5 text-base font-semibold">
                {t("百科档案", "Encyclopedic profile")}
              </h3>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <ProfileField
                  label={t("中英文名称", "Name")}
                  value={`${e.name.zh} / ${e.name.en}`}
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
                  value={e.status === "active" ? t("已发布 / 活跃", "Released / active") : e.status}
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
                      value={e.specs.contextWindow ?? "—"}
                      mono
                    />
                    <ProfileField
                      label={t("输入价格", "Input price")}
                      value={e.specs.inputPrice ?? "—"}
                      mono
                    />
                    <ProfileField
                      label={t("输出价格", "Output price")}
                      value={e.specs.outputPrice ?? "—"}
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
                      value={t(`${childVersions.length} 个`, `${childVersions.length} versions`)}
                    />
                    <ProfileField
                      label={t("资料状态", "Evidence status")}
                      value={t("证据可追溯", "Traceable evidence")}
                    />
                  </>
                )}
              </dl>
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
            </article>
          </div>

          {e.metrics && (
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
                    {e.metrics.map((m, i) => (
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
              title={t("已审核事实", "Reviewed facts")}
              description={t(
                "人工审核通过的新事实会在这里与直接证据一起展示。",
                "New human-reviewed facts appear here with their direct evidence.",
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

        {childVersions.length > 0 && sectionVisible("lineage") && (
          <section
            data-reading-section="lineage"
            style={{ order: sectionPresentation.lineage.order }}
          >
            <SectionHeading
              eyebrow={sectionPresentation.lineage.eyebrow}
              title={t("版本谱系与迭代差异", "Version lineage and iteration changes")}
              description={t(
                "系列不是一个模糊的大标签：每个版本分别记录发布时间、上下文、价格和能力变化。",
                "Each release records its own date, context, price and capability changes.",
              )}
              action={
                <Link
                  to="/compare"
                  className="inline-flex items-center gap-1 text-sm text-signal hover:underline"
                >
                  {t("进入具体版本对比", "Compare concrete versions")}{" "}
                  <ArrowLeftRight className="h-3 w-3" />
                </Link>
              }
            />
            <div className="paper-card overflow-x-auto">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">{t("版本", "Version")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("发布日期", "Released")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("上下文", "Context")}</th>
                    <th className="px-4 py-3 text-left font-medium">
                      {t("输入 / 输出价格", "Input / output price")}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {t("主要变化", "Main change")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {childVersions.map((version) => (
                    <tr key={version.id} className="hover:bg-accent/30">
                      <td className="px-4 py-4">
                        <Link
                          to="/knowledge/model/$slug"
                          params={{ slug: version.slug }}
                          className="font-semibold text-signal hover:underline"
                        >
                          {pick(version.name, lang)}
                        </Link>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {version.latestVersion}
                        </div>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs">{version.firstReleasedAt}</td>
                      <td className="px-4 py-4">{version.specs?.contextWindow ?? "—"}</td>
                      <td className="px-4 py-4">
                        <div>{version.specs?.inputPrice ?? "—"}</div>
                        <div className="mt-1 text-muted-foreground">
                          {version.specs?.outputPrice ?? "—"}
                        </div>
                      </td>
                      <td className="max-w-sm px-4 py-4 text-ink-soft">
                        {version.capabilities?.[0]
                          ? pick(version.capabilities[0], lang)
                          : pick(version.summary, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 局部关系概览 */}
        <ReadingModeSection
          section="relationships"
          visible={sectionVisible("relationships")}
          order={sectionPresentation.relationships.order}
        >
          <SectionHeading
            eyebrow={sectionPresentation.relationships.eyebrow}
            title={t("关系概览", "Relationship overview")}
            description={t(
              `用来回答“${pick(e.name, "zh")} 属于哪个系列、继任谁、由谁研发、使用什么协议、在哪些评测中出现”。`,
              `Use it to inspect lineage, vendor, protocols, benchmarks and competitors around ${pick(e.name, "en")}.`,
            )}
            action={
              <Link
                to="/graph"
                search={{ entity: e.id, mode: "ecosystem" }}
                className="text-sm text-signal hover:underline inline-flex items-center gap-1"
              >
                {t("打开关系洞察", "Open insights")} <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <KnowledgeGraph
              entities={entities}
              relations={relations}
              entityIds={neighborIds}
              centerId={e.id}
              height={420}
            />
          </div>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {relatedRelations.slice(0, 6).map((r) => {
              const other = findEntity(r.fromId === e.id ? r.toId : r.fromId);
              if (!other) return null;
              return (
                <div key={r.id} className="paper-card p-3 flex items-center gap-3">
                  <span className="chip">{RELATION_LABEL[r.kind][lang]}</span>
                  <span className="text-sm text-foreground truncate">{pick(other.name, lang)}</span>
                  <div className="ml-auto">
                    <ConfidenceChip level={r.confidence} />
                  </div>
                </div>
              );
            })}
          </div>
        </ReadingModeSection>

        {/* Timeline */}
        <ReadingModeSection
          section="timeline"
          visible={sectionVisible("timeline")}
          order={sectionPresentation.timeline.order}
        >
          <SectionHeading
            eyebrow={sectionPresentation.timeline.eyebrow}
            title={t("版本演进时间线", "Version evolution timeline")}
            description={t(
              "每次迭代明确记录功能、上下文和价格变化；不会用最新值覆盖历史状态。",
              "Each iteration records capability, context and price changes without overwriting history.",
            )}
          />
          <ol className="relative border-l-2 border-border ml-3 space-y-6">
            {timeline.map((ev) => (
              <li key={ev.id} className="pl-6 relative">
                <span className="absolute -left-[9px] top-1.5 h-4 w-4 rounded-full bg-signal ring-4 ring-background" />
                <div className="paper-card flex flex-wrap items-baseline gap-3 p-4">
                  <time className="font-mono text-sm text-signal">{ev.date}</time>
                  <h4 className="font-serif font-semibold text-foreground">
                    {pick(ev.title, lang)}
                  </h4>
                  <ConfidenceChip level={ev.confidence} />
                  <p className="w-full text-sm leading-relaxed text-ink-soft">
                    {pick(ev.summary, lang)}
                  </p>
                </div>
              </li>
            ))}
            {timeline.length === 0 && (
              <li className="pl-6 text-sm text-muted-foreground">
                {t("尚无时间线数据。", "No timeline data yet.")}
              </li>
            )}
          </ol>
        </ReadingModeSection>

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
                    <th className="text-left py-3 px-4 font-medium">{t("最近更新", "Updated")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="bg-signal/5">
                    <td className="py-3 px-4 font-medium text-foreground">{pick(e.name, lang)}</td>
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
                    `${pick(e.name, "zh")} 与 Claude 4.5 在代码任务上的差异？`,
                    `Compare ${pick(e.name, "en")} vs Claude 4.5 on code`,
                  ),
                  t(
                    `${pick(e.name, "zh")} 最近 30 天最重要的更新？`,
                    `Most important updates in the last 30 days`,
                  ),
                  t(
                    `${pick(e.name, "zh")} 有哪些争议或未核验说法？`,
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
              "每条事实至少一个来源。列表按发布时间倒序。",
              "Every fact has at least one source. Sorted by publish date.",
            )}
          />
          <div className="paper-card divide-y divide-border">
            {evidence.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {t("阅读模式", "Reading mode")}: <span className="font-mono">{mode}</span>
            {" · "}
            {t(
              "三种深度共享同一份已审核知识。",
              "All three depths use the same reviewed knowledge.",
            )}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {competitors.slice(0, 4).map((c) => c && <EntityChip key={c.id} entity={c} />)}
          </div>
        </ReadingModeSection>
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

function createVersionKnowledge(
  entity: Entity,
  family?: Entity,
): NonNullable<EntityDetail["knowledge"]> {
  const familyName = family?.name ?? { zh: "所属模型系列", en: "its model family" };
  const release = entity.firstReleasedAt ?? "—";
  const context = entity.specs?.contextWindow ?? "未公开";
  const availability = entity.specs?.availability ?? "以官方平台为准";
  const inputPrice = entity.specs?.inputPrice ?? "未公开";
  const outputPrice = entity.specs?.outputPrice ?? "未公开";
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
          en: `Context: ${context}; availability: ${availability}.`,
        },
      },
      {
        title: { zh: "价格快照", en: "Price snapshot" },
        description: {
          zh: `输入：${inputPrice}；输出：${outputPrice}。价格是页面记录时的快照，使用前应复核官方计费页。`,
          en: `Input: ${inputPrice}; output: ${outputPrice}. Prices are snapshots and should be rechecked against the official pricing page before use.`,
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
      {
        zh: "页面中的演示价格、预览规格和未来时间数据均会明确标注；它们不能替代官方实时文档。",
        en: "Demo prices, preview specifications and future-dated data are explicitly labeled and do not replace live official documentation.",
      },
      {
        zh: "同系列不同版本的上下文、工具调用、延迟与计费可能完全不同，对比时必须选择具体版本。",
        en: "Context, tools, latency and pricing can differ materially between releases; comparisons should use concrete versions.",
      },
      {
        zh: "公开 Benchmark 只能反映部分能力，最终选择仍需要使用自己的任务、语言和数据进行评测。",
        en: "Public benchmarks cover only part of model quality; final selection requires evaluation on your own tasks, language and data.",
      },
    ],
    officialUrl: family?.knowledge?.officialUrl,
  };
}

function regionLabel(entity: Entity, t: (zh: string, en: string) => string) {
  if (!entity.origin) return "—";
  return ["中国", "国内", "China", "Domestic"].includes(entity.origin.zh) ||
    ["中国", "国内", "China", "Domestic"].includes(entity.origin.en)
    ? t("国内", "Domestic")
    : t("海外", "Overseas");
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

const RELATION_LABEL: Record<string, { zh: string; en: string }> = {
  "developed-by": { zh: "研发方", en: "Developed by" },
  "based-on": { zh: "基于", en: "Based on" },
  "competes-with": { zh: "竞品", en: "Competes with" },
  "benchmarked-on": { zh: "评测于", en: "Benchmarked on" },
  uses: { zh: "使用", en: "Uses" },
  "cited-by": { zh: "引用者", en: "Cited by" },
  "part-of": { zh: "属于", en: "Part of" },
  "successor-of": { zh: "继任", en: "Successor of" },
  "integrates-with": { zh: "集成", en: "Integrates with" },
};
