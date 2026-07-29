import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Filter, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import type { EntityType } from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { useEntities } from "@/hooks/use-knowledge";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "知识库 · AI Radar" },
      {
        name: "description",
        content: "AI Radar 知识库：搜索、分类与筛选模型、Agent、框架、论文与评测。",
      },
      { property: "og:title", content: "AI Radar · 知识库" },
      { property: "og:description", content: "所有 AI 实体的搜索与浏览入口。" },
    ],
  }),
  component: KnowledgePage,
});

const TYPES: EntityType[] = ["model", "company", "framework", "benchmark", "paper", "application"];

function KnowledgePage() {
  const { t, lang } = useApp();
  const entitiesQuery = useEntities();
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<EntityType[]>([]);
  const [region, setRegion] = useState<"all" | "domestic" | "overseas">("all");
  const entities = entitiesQuery.data;

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (entities ?? []).filter((e) => {
      if (types.length && !types.includes(e.type)) return false;
      if (region === "domestic" && e.origin?.zh !== "中国") return false;
      if (region === "overseas" && (!e.origin || e.origin.zh === "中国")) return false;
      if (!kw) return true;
      return (
        e.name.zh.toLowerCase().includes(kw) ||
        e.name.en.toLowerCase().includes(kw) ||
        e.aliases?.some((a) => a.toLowerCase().includes(kw)) ||
        e.tags.some((t) => t.toLowerCase().includes(kw))
      );
    });
  }, [entities, q, types, region]);

  const toggleType = (t: EntityType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  if (!entitiesQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={entitiesQuery.error ? "error" : "loading"}
          title={t(
            entitiesQuery.error ? "知识库加载失败" : "正在加载知识库",
            entitiesQuery.error ? "Knowledge base failed to load" : "Loading knowledge base",
          )}
          description={t("请检查数据服务后重试。", "Check the data service and retry.")}
          onRetry={entitiesQuery.error ? () => entitiesQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={t("知识库", "Knowledge base")}
        subtitle={t(
          "所有实体、具体版本、关系与证据的入口。按类型、国内/海外和关键词定位研究对象。",
          "Entry point to entities, concrete versions, relations and evidence. Filter by type and region.",
        )}
      />
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 grid md:grid-cols-[240px_1fr] gap-8">
        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="paper-card p-4">
            <div className="text-xs uppercase tracking-widest text-signal font-medium mb-3 flex items-center gap-1">
              <Filter className="h-3 w-3" />
              {t("类型", "Type")}
            </div>
            <div className="flex flex-col gap-1">
              {TYPES.map((tp) => (
                <button
                  key={tp}
                  onClick={() => toggleType(tp)}
                  className={
                    "text-left text-sm px-2 py-1.5 rounded-md " +
                    (types.includes(tp)
                      ? "bg-signal/10 text-signal font-medium"
                      : "text-ink-soft hover:bg-accent")
                  }
                >
                  {pick(ENTITY_TYPE_LABELS[tp], lang)}
                </button>
              ))}
            </div>
          </div>
          <div className="paper-card p-4">
            <div className="text-xs uppercase tracking-widest text-signal font-medium mb-3">
              {t("地域", "Region")}
            </div>
            <div className="flex flex-col gap-1">
              {(["all", "domestic", "overseas"] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setRegion(o)}
                  className={
                    "text-left text-sm px-2 py-1.5 rounded-md " +
                    (region === o
                      ? "bg-signal/10 text-signal font-medium"
                      : "text-ink-soft hover:bg-accent")
                  }
                >
                  {o === "all"
                    ? t("全部", "All")
                    : o === "domestic"
                      ? t("国内", "Domestic")
                      : t("海外", "Overseas")}
                </button>
              ))}
            </div>
          </div>
          <div className="paper-card p-4 bg-accent/40">
            <div className="text-xs uppercase tracking-widest text-signal font-medium mb-2">
              {t("时间范围", "Time range")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "演示版：默认展示最近 90 天更新的实体。",
                "Demo: showing entities updated in the last 90 days.",
              )}
            </p>
          </div>
        </aside>

        {/* Main */}
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t(
                  "搜索 GPT · Claude · MCP · SWE-bench …",
                  "Search GPT, Claude, MCP, SWE-bench…",
                )}
                className="pl-10 h-11"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setQ("");
                setTypes([]);
                setRegion("all");
              }}
            >
              {t("重置", "Reset")}
            </Button>
          </div>

          <div className="text-sm text-muted-foreground mb-4 flex items-center gap-2">
            {t("共", "Showing")} {filtered.length} {t("个实体", "entities")}
            <DemoBadge />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {filtered.map((e) => (
              <Link
                key={e.id}
                to="/knowledge/$type/$slug"
                params={{ type: e.type, slug: e.slug }}
                className="paper-card p-5 hover:border-signal/60 transition-colors group flex flex-col"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="chip">{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
                  {e.vendor && <span className="text-xs text-muted-foreground">{e.vendor}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{e.lastUpdatedAt}</span>
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                  <h3 className="font-serif text-lg font-semibold text-foreground group-hover:text-signal">
                    {pick(e.name, lang)}
                  </h3>
                  {e.latestVersion && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {e.latestVersion}
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-soft leading-relaxed line-clamp-3 flex-1">
                  {pick(e.summary, lang)}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {e.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="text-[11px] text-muted-foreground">
                      #{tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 text-xs text-signal inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t("查看详情", "View detail")} <ArrowRight className="h-3 w-3" />
                </div>
              </Link>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-2 paper-card p-8 text-center text-muted-foreground">
                {t(
                  "没有匹配的实体，试试其他关键词或清除筛选。",
                  "No matches — try another keyword or clear filters.",
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
