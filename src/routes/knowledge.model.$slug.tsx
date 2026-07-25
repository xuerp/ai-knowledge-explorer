import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import {
  CLAIMS,
  ENTITIES,
  ENTITY_TYPE_LABELS,
  RELATIONS,
  SOURCES,
  TIMELINE,
  findEntity,
  findEntityBySlug,
} from "@/lib/demo-data";
import { useApp, pick } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Entity } from "@/lib/demo-data";

export const Route = createFileRoute("/knowledge/model/$slug")({
  loader: ({ params }) => {
    const entity = findEntityBySlug(params.slug);
    if (!entity) throw notFound();
    return { entity };
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
  const { entity: e } = Route.useLoaderData() as { entity: Entity };
  const { t, lang, mode } = useApp();

  // Local graph: this entity + neighbors
  const neighborIds = useMemo(() => {
    const ids = new Set<string>([e.id]);
    RELATIONS.forEach((r) => {
      if (r.fromId === e.id) ids.add(r.toId);
      if (r.toId === e.id) ids.add(r.fromId);
    });
    return Array.from(ids);
  }, [e.id]);

  const timeline = TIMELINE[e.id] ?? [];
  const claims = CLAIMS.filter((c) => c.sourceIds.some((sid) => SOURCES.find((s) => s.id === sid)));
  const relatedRelations = RELATIONS.filter((r) => r.fromId === e.id || r.toId === e.id);

  const competitors = relatedRelations
    .filter((r) => r.kind === "competes-with")
    .map((r) => findEntity(r.fromId === e.id ? r.toId : r.fromId))
    .filter(Boolean);

  return (
    <AppShell>
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
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
              <h1 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
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
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 space-y-14">
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
          <div className="grid md:grid-cols-3 gap-4">
            <FactCard
              label={t("厂商 / 归属", "Vendor")}
              value={e.vendor ?? "—"}
              note={e.origin ? pick(e.origin, lang) : undefined}
            />
            <FactCard
              label={t("最新版本", "Latest version")}
              value={e.latestVersion ?? "—"}
              note={e.lastUpdatedAt}
            />
            <FactCard
              label={t("首次发布", "First released")}
              value={e.firstReleasedAt ?? "—"}
              note={t("状态", "Status") + ": " + e.status}
            />
          </div>

          {e.capabilities && (
            <div className="mt-6 paper-card p-5">
              <h4 className="font-serif font-semibold mb-4">{t("能力", "Capabilities")}</h4>
              <ul className="grid sm:grid-cols-2 gap-3">
                {e.capabilities.map((c, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Layers className="h-4 w-4 text-signal mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm text-foreground">{pick(c, lang)}</div>
                    </div>
                    <ConfidenceChip level={c.confidence} />
                  </li>
                ))}
              </ul>
            </div>
          )}

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
          <KnowledgeGraph entityIds={neighborIds} centerId={e.id} height={420} />
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
                <div className="flex flex-wrap items-baseline gap-3 mb-1">
                  <time className="font-mono text-sm text-signal">{ev.date}</time>
                  <h4 className="font-serif font-semibold text-foreground">
                    {pick(ev.title, lang)}
                  </h4>
                  <ConfidenceChip level={ev.confidence} />
                </div>
                <p className="text-sm text-ink-soft leading-relaxed">{pick(ev.summary, lang)}</p>
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
            {SOURCES.map((s) => (
              <SourceRow key={s.id} sourceId={s.id} />
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

function FactCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="paper-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
      <div className="text-lg font-serif font-semibold text-foreground">{value}</div>
      {note && <div className="text-xs text-muted-foreground mt-1">{note}</div>}
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
