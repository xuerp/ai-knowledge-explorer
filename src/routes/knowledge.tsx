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
      <div className="page-container grid gap-8 py-6 md:grid-cols-[220px_minmax(0,1fr)] md:py-8">
        {/* Sidebar */}
        <aside className="self-start md:sticky md:top-20 md:border-r md:border-border md:pr-6">
          <div className="border-b border-border pb-5">
            <div className="section-label mb-3 flex items-center gap-1 text-signal">
              <Filter className="h-3 w-3" />
              {t("类型", "Type")}
            </div>
            <div className="flex flex-col gap-1">
              {TYPES.map((tp) => (
                <button
                  key={tp}
                  onClick={() => toggleType(tp)}
                  className={
                    "border-l-2 px-3 py-1.5 text-left text-sm " +
                    (types.includes(tp)
                      ? "border-signal bg-accent/70 font-medium text-signal"
                      : "border-transparent text-ink-soft hover:border-border-strong hover:bg-muted")
                  }
                >
                  {pick(ENTITY_TYPE_LABELS[tp], lang)}
                </button>
              ))}
            </div>
          </div>
          <div className="border-b border-border py-5">
            <div className="section-label mb-3 text-signal">{t("地域", "Region")}</div>
            <div className="flex flex-col gap-1">
              {(["all", "domestic", "overseas"] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setRegion(o)}
                  className={
                    "border-l-2 px-3 py-1.5 text-left text-sm " +
                    (region === o
                      ? "border-signal bg-accent/70 font-medium text-signal"
                      : "border-transparent text-ink-soft hover:border-border-strong hover:bg-muted")
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
          <div className="py-5">
            <div className="section-label mb-2 text-signal">{t("时间范围", "Time range")}</div>
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
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t(
                  "搜索 GPT · Claude · MCP · SWE-bench …",
                  "Search GPT, Claude, MCP, SWE-bench…",
                )}
                className="h-10 bg-card pl-10"
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

          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            {t("共", "Showing")} {filtered.length} {t("个实体", "entities")}
            <DemoBadge />
          </div>

          <div className="border-b border-border">
            {filtered.map((e, index) => (
              <Link
                key={e.id}
                to="/knowledge/$type/$slug"
                params={{ type: e.type, slug: e.slug }}
                className="data-row group grid gap-3 px-3 py-4 hover:border-signal hover:bg-accent/35 sm:grid-cols-[36px_minmax(150px,0.7fr)_minmax(220px,1.3fr)_110px] sm:items-start sm:px-4"
              >
                <span className="hidden pt-0.5 font-mono text-[10px] text-muted-foreground sm:block">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <div className="section-label text-signal">
                    {pick(ENTITY_TYPE_LABELS[e.type], lang)}
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <h3 className="text-base font-semibold text-foreground group-hover:text-signal">
                      {pick(e.name, lang)}
                    </h3>
                    {e.latestVersion && (
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {e.latestVersion}
                      </span>
                    )}
                  </div>
                  {e.vendor && <div className="mt-1 text-xs text-muted-foreground">{e.vendor}</div>}
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm leading-6 text-ink-soft">
                    {pick(e.summary, lang)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    {e.tags.slice(0, 4).map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {e.lastUpdatedAt}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-signal">
                    {t("查看档案", "Open profile")} <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            ))}
            {filtered.length === 0 && (
              <div className="border-t border-border bg-card p-8 text-center text-muted-foreground">
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
