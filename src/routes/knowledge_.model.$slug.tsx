import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
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
import {
  DemoBadge,
  ConfidenceChip,
  SectionHeading,
  SourceRow,
  EntityChip,
} from "@/components/common";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import { useApp, pick } from "@/lib/app-state";
import { knowledgeRepository } from "@/services/knowledge-repository";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Entity, KnowledgeSnapshot } from "@/domain/types";

export const Route = createFileRoute("/knowledge_/model/$slug")({
  loader: async ({ params }) => {
    const snapshot = await knowledgeRepository.getSnapshot();
    const entity = snapshot.entities.find((item) => item.slug === params.slug);
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
  const { entities, evidence, claims: allClaims, timeline: allTimeline, graph } = snapshot;
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
  const recentChange = snapshot.changes.find((change) => change.entityId === e.id);
  const claims = allClaims.filter((c) =>
    c.sourceIds.some((sourceId) => evidence.some((source) => source.id === sourceId)),
  );
  const relatedRelations = relations.filter((r) => r.fromId === e.id || r.toId === e.id);

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
              <Link
                to="/graph"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
              >
                <GitBranch className="h-4 w-4" />
                {t("在图谱中查看", "View in graph")}
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
              <Link to="/graph" className="text-xs font-medium text-signal hover:underline">
                {t("查看关系变化", "View graph change")} →
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="page-container space-y-12 pb-12 pt-5">
        {/* 1. 结构化档案 */}
        <section>
          <SectionHeading
            eyebrow="01"
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
                <ProfileField
                  label={t("来源国家/地区", "Origin")}
                  value={e.origin ? pick(e.origin, lang) : "—"}
                />
                <ProfileField label={t("标签", "Tags")} value={e.tags.join(" · ")} wide />
              </dl>
            </article>

            <article className="paper-card p-5">
              <h3 className="mb-5 text-base font-semibold">
                {t("技术规格与核心能力", "Technical profile")}
              </h3>
              <dl className="mb-5 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <ProfileField
                  label={t("实体类型", "Entity type")}
                  value={pick(ENTITY_TYPE_LABELS[e.type], lang)}
                />
                <ProfileField label={t("最后核验", "Last verified")} value={e.lastUpdatedAt} mono />
                <ProfileField
                  label={t("知识图谱关系", "Graph relations")}
                  value={t(
                    `${relatedRelations.length} 条已建模关系`,
                    `${relatedRelations.length} modelled edges`,
                  )}
                />
                <ProfileField
                  label={t("资料状态", "Evidence status")}
                  value={t("证据可追溯", "Traceable evidence")}
                />
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
        </section>

        {/* 2. 局部图谱 */}
        <section>
          <SectionHeading
            eyebrow="02"
            title={t("局部知识图谱", "Local knowledge graph")}
            description={t(
              `以 ${pick(e.name, "zh")} 为中心的相关实体与关系。`,
              `Entities & relations centered on ${pick(e.name, "en")}.`,
            )}
            action={
              <Link
                to="/graph"
                className="text-sm text-signal hover:underline inline-flex items-center gap-1"
              >
                {t("展开完整图谱", "Full graph")} <ExternalLink className="h-3 w-3" />
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
        </section>

        {/* 3. Timeline */}
        <section>
          <SectionHeading
            eyebrow="03"
            title={t("时间线", "Timeline")}
            description={t(
              "所有历史状态都会保留，不会用最新值覆盖过去。",
              "All historical states preserved — the latest value never overwrites the past.",
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
        </section>

        {/* 4. Compare */}
        <section>
          <SectionHeading
            eyebrow="04"
            title={t("与竞品对比", "Competitor comparison")}
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
        </section>

        {/* 5. AI 问答 */}
        <section>
          <SectionHeading
            eyebrow="05"
            title={t("AI 问答", "Ask AI")}
            description={t(
              "所有 AI 回答均基于本页图谱数据，事实 / 推断 / 未核验分开呈现。",
              "AI answers grounded in this page's graph; fact / inference / unverified separated.",
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
        </section>

        {/* 6. 来源 */}
        <section>
          <SectionHeading
            eyebrow="06"
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
            {t("三种深度共享同一图谱知识。", "Three depths share the same graph knowledge.")}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {competitors.slice(0, 4).map((c) => c && <EntityChip key={c.id} entity={c} />)}
          </div>
        </section>
      </div>
    </AppShell>
  );
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
};
