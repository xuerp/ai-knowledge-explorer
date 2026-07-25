import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { X, ArrowRight, Filter, Clock } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeGraph, NODE_TYPES } from "@/components/graph/KnowledgeGraph";
import { DemoBadge, ConfidenceChip } from "@/components/common";
import {
  ENTITIES,
  ENTITY_TYPE_LABELS,
  RELATIONS,
  findEntity,
  type Entity,
  type EntityType,
} from "@/lib/demo-data";
import { useApp, pick } from "@/lib/app-context";
import { Slider } from "@/components/ui/slider";

export const Route = createFileRoute("/graph")({
  head: () => ({
    meta: [
      { title: "2D 知识图谱 · AI Radar" },
      { name: "description", content: "以图的方式浏览 AI 模型、Agent、框架与论文的关系与时间。" },
      { property: "og:title", content: "AI Radar · 2D 知识图谱" },
      { property: "og:description", content: "沉浸式深色画布中的 AI 技术生态。" },
    ],
  }),
  component: GraphPage,
});

function GraphPage() {
  const { t, lang } = useApp();
  const [selected, setSelected] = useState<Entity | null>(null);
  const [enabled, setEnabled] = useState<Record<EntityType, boolean>>({
    model: true,
    company: true,
    framework: true,
    benchmark: true,
    paper: true,
    application: true,
    agent: true,
    dataset: true,
    api: true,
    tool: true,
  });
  const [year, setYear] = useState([2017, 2026]);

  const ids = ENTITIES.filter(
    (e) =>
      enabled[e.type] &&
      (!e.firstReleasedAt || parseInt(e.firstReleasedAt.slice(0, 4)) <= year[1]) &&
      parseInt(e.lastUpdatedAt.slice(0, 4)) >= year[0],
  ).map((e) => e.id);

  const selectedRelations = selected
    ? RELATIONS.filter((r) => r.fromId === selected.id || r.toId === selected.id)
    : [];

  return (
    <AppShell dark>
      <div className="bg-graph-bg text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2"><DemoBadge /></div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">
              {t("2D 知识图谱", "2D Knowledge Graph")}
            </h1>
            <p className="text-sm text-white/70 mt-2 max-w-2xl">
              {t(
                "深色画布中的 AI 技术生态。节点大小表示重要性，虚线关系为未核验。",
                "The AI ecosystem on a dark canvas. Node size = importance; dashed edges = unverified.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {NODE_TYPES.map((n) => (
              <button
                key={n.type}
                onClick={() => setEnabled((p) => ({ ...p, [n.type]: !p[n.type] }))}
                className={
                  "px-2.5 py-1 rounded-full border transition-colors " +
                  (enabled[n.type]
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-white/10 text-white/40")
                }
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ backgroundColor: `var(--graph-node-${n.type})` }}
                />
                {lang === "zh" ? n.zh : n.en}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 md:px-6 pb-8 grid lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-3">
            <KnowledgeGraph
              entityIds={ids}
              onSelect={(e) => setSelected(e)}
              selectedId={selected?.id}
              height={620}
            />
            <div className="paper-card !bg-white/5 !border-white/10 p-4 text-white">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/60 mb-3">
                <Clock className="h-3 w-3" />
                {t("时间范围", "Time range")}: {year[0]} – {year[1]}
              </div>
              <Slider
                value={year}
                onValueChange={setYear}
                min={2015}
                max={2026}
                step={1}
              />
            </div>
          </div>

          <aside className="paper-card !bg-white/5 !border-white/10 text-white p-5 h-fit sticky top-16">
            {selected ? (
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="chip !bg-white/10 !border-white/20 !text-white/90">
                    {pick(ENTITY_TYPE_LABELS[selected.type], lang)}
                  </span>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-white/50 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <h3 className="font-serif text-2xl font-semibold">{pick(selected.name, lang)}</h3>
                {selected.vendor && (
                  <div className="text-xs text-white/60 mt-1">{selected.vendor}</div>
                )}
                <p className="text-sm text-white/80 mt-3 leading-relaxed">
                  {pick(selected.summary, lang)}
                </p>

                <div className="mt-5">
                  <div className="text-xs uppercase tracking-widest text-white/50 mb-2">
                    {t("关系", "Relations")}
                  </div>
                  <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {selectedRelations.map((r) => {
                      const other = findEntity(r.fromId === selected.id ? r.toId : r.fromId);
                      if (!other) return null;
                      return (
                        <li key={r.id} className="text-sm flex items-center gap-2">
                          <span className="text-white/50 text-xs w-20 shrink-0">
                            {RELATION_LABEL[r.kind][lang]}
                          </span>
                          <span className="text-white flex-1 truncate">{pick(other.name, lang)}</span>
                          <ConfidenceChip level={r.confidence} />
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <Link
                  to="/knowledge/model/$slug"
                  params={{ slug: selected.slug }}
                  className="mt-5 inline-flex items-center gap-1 h-9 px-3 rounded-md bg-white text-graph-bg text-sm font-medium hover:bg-white/90"
                >
                  {t("查看完整详情", "Full detail")} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <div className="text-white/70 text-sm">
                <div className="flex items-center gap-2 text-white/50 uppercase tracking-widest text-xs mb-2">
                  <Filter className="h-3 w-3" />
                  {t("提示", "Tip")}
                </div>
                <p>
                  {t(
                    "点击画布上的任一节点查看详情与关系；上方筛选器可打开或关闭类型；下方滑块可缩放时间范围。",
                    "Click any node to inspect it. Toggle types above; scrub time below.",
                  )}
                </p>
                <ul className="mt-4 space-y-2 text-xs text-white/60">
                  <li>• {t("实线：已核验关系", "Solid line = verified relation")}</li>
                  <li>• {t("虚线：未核验或推断", "Dashed = unverified / inferred")}</li>
                  <li>• {t("节点半径反映重要性", "Node radius = importance")}</li>
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

const RELATION_LABEL: Record<string, { zh: string; en: string }> = {
  "developed-by": { zh: "研发方", en: "Developed by" },
  "based-on": { zh: "基于", en: "Based on" },
  "competes-with": { zh: "竞品", en: "Competes" },
  "benchmarked-on": { zh: "评测", en: "Bench" },
  "uses": { zh: "使用", en: "Uses" },
  "cited-by": { zh: "被引", en: "Cited" },
  "part-of": { zh: "属于", en: "Part of" },
  "successor-of": { zh: "继任", en: "Succeeds" },
};
