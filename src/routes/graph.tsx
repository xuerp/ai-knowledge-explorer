import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Clock,
  ExternalLink,
  Filter,
  List,
  Network,
  Route as RouteIcon,
  Search,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";
import {
  CONFIDENCE_TYPES,
  NODE_TYPES,
  RELATION_TYPES,
  type NodeShape,
} from "@/components/graph/config";
import { ConfidenceChip, DemoBadge } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import { CONFIDENCE_LABELS, ENTITY_TYPE_LABELS, RELATION_LABELS } from "@/domain/labels";
import { expandNeighborhood, filterGraphEdges, findShortestPath } from "@/domain/graph";
import type {
  Confidence,
  Entity,
  EntityType,
  GraphEdge,
  KnowledgeSnapshot,
  RelationKind,
} from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { Slider } from "@/components/ui/slider";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

export const Route = createFileRoute("/graph")({
  head: () => ({
    meta: [
      { title: "AI 生态关系图谱 · AI Radar" },
      {
        name: "description",
        content: "查询 AI 模型的版本继承、研发方、工具生态、评测与证据关系。",
      },
      { property: "og:title", content: "AI Radar · AI 生态关系图谱" },
      {
        property: "og:description",
        content: "在可搜索、可筛选的时间图谱中探索 AI 技术生态。",
      },
    ],
  }),
  component: GraphPage,
});

type Depth = 1 | 2 | "all";
type ViewMode = "graph" | "list";

const initialEntityFilters = Object.fromEntries(
  NODE_TYPES.map(({ type }) => [type, true]),
) as Record<EntityType, boolean>;
const initialRelationFilters = Object.fromEntries(
  RELATION_TYPES.map((type) => [type, true]),
) as Record<RelationKind, boolean>;
const initialConfidenceFilters = Object.fromEntries(
  CONFIDENCE_TYPES.map((type) => [type, true]),
) as Record<Confidence, boolean>;

function useCompactLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

function GraphPage() {
  const { t } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "图谱加载失败" : "正在加载图谱",
            snapshotQuery.error ? "Graph failed to load" : "Loading graph",
          )}
          description={t(
            "请稍后重试；页面不会把缺失数据伪装成实时结果。",
            "Retry shortly; the UI will not disguise missing data as live.",
          )}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }
  return <GraphWorkspace snapshot={snapshotQuery.data} />;
}

function GraphWorkspace({ snapshot }: { snapshot: KnowledgeSnapshot }) {
  const { t, lang } = useApp();
  const compact = useCompactLayout();
  const { entities, evidence, graph } = snapshot;
  const relations = graph.edges;
  const [selectedNode, setSelectedNode] = useState<Entity | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [enabledTypes, setEnabledTypes] =
    useState<Record<EntityType, boolean>>(initialEntityFilters);
  const [enabledRelations, setEnabledRelations] =
    useState<Record<RelationKind, boolean>>(initialRelationFilters);
  const [enabledConfidences, setEnabledConfidences] =
    useState<Record<Confidence, boolean>>(initialConfidenceFilters);
  const [year, setYear] = useState([2015, 2026]);
  const [depth, setDepth] = useState<Depth>(1);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [query, setQuery] = useState("");
  const [focusNodeId, setFocusNodeId] = useState<string | null>("e-gpt");
  const [pathStart, setPathStart] = useState("");
  const [pathEnd, setPathEnd] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );
  const evidenceById = useMemo(
    () => new Map(evidence.map((source) => [source.id, source])),
    [evidence],
  );
  const timeAndTypeIds = useMemo(
    () =>
      new Set(
        entities
          .filter((entity) => {
            const released = entity.firstReleasedAt
              ? Number.parseInt(entity.firstReleasedAt.slice(0, 4), 10)
              : year[0];
            const updated = Number.parseInt(entity.lastUpdatedAt.slice(0, 4), 10);
            return enabledTypes[entity.type] && released <= year[1] && updated >= year[0];
          })
          .map((entity) => entity.id),
      ),
    [enabledTypes, entities, year],
  );
  const filteredRelations = useMemo(() => {
    const relationKinds = new Set(RELATION_TYPES.filter((kind) => enabledRelations[kind]));
    const confidences = new Set(
      CONFIDENCE_TYPES.filter((confidence) => enabledConfidences[confidence]),
    );
    return filterGraphEdges(relations, { relationKinds, confidences }).filter(
      (edge) => timeAndTypeIds.has(edge.fromId) && timeAndTypeIds.has(edge.toId),
    );
  }, [enabledConfidences, enabledRelations, relations, timeAndTypeIds]);
  const path = useMemo(
    () => (pathStart && pathEnd ? findShortestPath(filteredRelations, pathStart, pathEnd) : null),
    [filteredRelations, pathEnd, pathStart],
  );
  const visibleIds = useMemo(() => {
    let ids = new Set(timeAndTypeIds);
    const centerId = selectedNode?.id ?? focusNodeId;
    if (depth !== "all" && centerId && timeAndTypeIds.has(centerId)) {
      ids = expandNeighborhood(filteredRelations, centerId, depth);
      ids = new Set([...ids].filter((id) => timeAndTypeIds.has(id)));
    }
    path?.nodeIds.forEach((id) => ids.add(id));
    if (compact && ids.size > 24) {
      return [
        ...new Set([...(path?.nodeIds ?? []), ...(centerId ? [centerId] : []), ...ids]),
      ].slice(0, 24);
    }
    return [...ids];
  }, [compact, depth, filteredRelations, focusNodeId, path, selectedNode, timeAndTypeIds]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const visibleRelations = useMemo(
    () =>
      filteredRelations.filter(
        (edge) => visibleIdSet.has(edge.fromId) && visibleIdSet.has(edge.toId),
      ),
    [filteredRelations, visibleIdSet],
  );
  const visibleEntities = useMemo(
    () => entities.filter((entity) => visibleIdSet.has(entity.id)),
    [entities, visibleIdSet],
  );
  const searchResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return entities
      .filter((entity) =>
        [entity.name.zh, entity.name.en, entity.vendor ?? "", ...entity.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized),
      )
      .slice(0, 6);
  }, [entities, query]);

  const selectNode = (entity: Entity) => {
    setSelectedNode(entity);
    setSelectedEdge(null);
    setFocusNodeId(entity.id);
  };
  const selectEdge = (edge: GraphEdge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
  };
  const clearSelection = () => {
    setSelectedNode(null);
    setSelectedEdge(null);
  };
  const chooseSearchResult = (entity: Entity) => {
    setQuery(pick(entity.name, lang));
    selectNode(entity);
  };

  const filterPanel = (
    <GraphFilters
      enabledTypes={enabledTypes}
      enabledRelations={enabledRelations}
      enabledConfidences={enabledConfidences}
      year={year}
      depth={depth}
      onToggleType={(type) =>
        setEnabledTypes((current) => ({ ...current, [type]: !current[type] }))
      }
      onToggleRelation={(kind) =>
        setEnabledRelations((current) => ({ ...current, [kind]: !current[kind] }))
      }
      onToggleConfidence={(confidence) =>
        setEnabledConfidences((current) => ({
          ...current,
          [confidence]: !current[confidence],
        }))
      }
      onYearChange={setYear}
      onDepthChange={setDepth}
    />
  );
  const inspector = (
    <GraphInspector
      selectedNode={selectedNode}
      selectedEdge={selectedEdge}
      relations={visibleRelations}
      entityById={entityById}
      evidenceById={evidenceById}
      onClose={clearSelection}
      onSelectEdge={selectEdge}
    />
  );

  return (
    <AppShell>
      <main className="graph-light-page min-h-[calc(100vh-3.5rem)] bg-background text-foreground">
        <header className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4 py-6 md:px-6">
          <div>
            <DemoBadge />
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight md:text-4xl">
              {t("AI 生态关系图谱", "AI ecosystem relationship graph")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/70">
              {t(
                "它不是装饰性的 3D 展示，而是关系查询工具：追踪版本继承、厂商生态、工具依赖和评测证据。点击节点看对象，点击连线看关系与来源。",
                "This is a relationship query tool, not decorative 3D. Trace version lineage, vendor ecosystems, tool dependencies and benchmark evidence.",
              )}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
            <ModeButton
              active={viewMode === "graph"}
              icon={<Network className="h-4 w-4" />}
              label={t("图谱", "Graph")}
              onClick={() => setViewMode("graph")}
            />
            <ModeButton
              active={viewMode === "list"}
              icon={<List className="h-4 w-4" />}
              label={t("列表", "List")}
              onClick={() => setViewMode("list")}
            />
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 pb-8 md:px-6">
          <section
            aria-label={t("图谱工具", "Graph tools")}
            className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/45" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && searchResults[0]) {
                      chooseSearchResult(searchResults[0]);
                    }
                  }}
                  placeholder={t(
                    "搜索名称、厂商或标签，回车定位",
                    "Search name, vendor, or tag; Enter to focus",
                  )}
                  className="h-9 w-full rounded-md border border-white/15 bg-black/20 pl-9 pr-9 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/40"
                  aria-label={t("搜索图谱实体", "Search graph entities")}
                />
                {query && (
                  <>
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-2 grid h-5 w-5 place-items-center text-white/50 hover:text-white"
                      aria-label={t("清除搜索", "Clear search")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-lg border border-white/15 bg-graph-surface shadow-2xl">
                      {searchResults.length ? (
                        searchResults.map((entity) => (
                          <button
                            key={entity.id}
                            type="button"
                            onClick={() => chooseSearchResult(entity)}
                            className="flex w-full items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-left last:border-b-0 hover:bg-white/10"
                          >
                            <span className="truncate text-sm">{pick(entity.name, lang)}</span>
                            <span className="shrink-0 text-xs text-white/50">
                              {pick(ENTITY_TYPE_LABELS[entity.type], lang)}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-sm text-white/55">
                          {t("没有匹配结果", "No matching results")}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <RouteIcon className="h-4 w-4 text-white/50" />
                <PathSelect
                  label={t("起点", "Start")}
                  value={pathStart}
                  entities={entities}
                  onChange={setPathStart}
                />
                <ArrowRight className="h-3.5 w-3.5 text-white/35" />
                <PathSelect
                  label={t("终点", "End")}
                  value={pathEnd}
                  entities={entities}
                  onChange={setPathEnd}
                />
                {(pathStart || pathEnd) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPathStart("");
                      setPathEnd("");
                    }}
                    className="h-8 px-2 text-xs text-white/50 hover:text-white"
                  >
                    {t("清除路径", "Clear path")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-3 text-xs text-white/80 hover:bg-white/10 lg:hidden"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {t("筛选", "Filters")}
                </button>
              </div>
            </div>
            {pathStart && pathEnd && (
              <p
                className={`mt-2 text-xs ${path ? "text-white/65" : "text-conflict"}`}
                role="status"
              >
                {path
                  ? t(
                      `已找到 ${path.edgeIds.length} 段最短路径，画布中以主题强调色高亮。`,
                      `Shortest path found: ${path.edgeIds.length} edges, highlighted with the theme accent.`,
                    )
                  : t(
                      "当前筛选条件下没有可用路径。",
                      "No path is available under the current filters.",
                    )}
              </p>
            )}
          </section>

          <section className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 text-xs md:grid-cols-3">
            <div>
              <div className="font-semibold text-foreground">{t("① 看节点", "1. Read nodes")}</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {t(
                  "颜色和形状区分模型、公司、框架、评测与论文。",
                  "Color and shape distinguish models, companies, frameworks, benchmarks, and papers.",
                )}
              </p>
            </div>
            <div>
              <div className="font-semibold text-foreground">{t("② 看关系", "2. Read edges")}</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {t(
                  "例如：GPT 系列 —研发方→ OpenAI；GPT 系列 —评测于→ SWE-bench。",
                  "Example: GPT —developed by→ OpenAI; GPT —benchmarked on→ SWE-bench.",
                )}
              </p>
            </div>
            <div>
              <div className="font-semibold text-foreground">
                {t("③ 核验证据", "3. Verify evidence")}
              </div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {t(
                  "实线表示已核验，虚线表示推断或未核验；点击任意连线查看来源。",
                  "Solid lines are verified; dashed lines are inferred or unverified. Select any edge for sources.",
                )}
              </p>
            </div>
          </section>

          <section className="mb-4 flex flex-wrap items-center gap-2">
            <span className="mr-2 text-xs font-semibold text-foreground">
              {t("用图谱完成任务：", "Use the graph to:")}
            </span>
            <button
              type="button"
              onClick={() => {
                setFocusNodeId("e-gpt-45");
                setDepth(2);
                setPathStart("e-gpt-5");
                setPathEnd("e-gpt-4o");
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-foreground hover:border-signal/40 hover:bg-accent"
            >
              <RouteIcon className="h-3.5 w-3.5 text-signal" />
              {t("查看 GPT 版本继承链", "Trace GPT version lineage")}
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusNodeId("e-openai");
                setDepth(1);
                setPathStart("");
                setPathEnd("");
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-foreground hover:border-signal/40 hover:bg-accent"
            >
              <Network className="h-3.5 w-3.5 text-signal" />
              {t("查看厂商与产品生态", "Explore vendor ecosystems")}
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusNodeId("e-gpt-5");
                setDepth(1);
                setPathStart("");
                setPathEnd("");
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs text-foreground hover:border-signal/40 hover:bg-accent"
            >
              <Check className="h-3.5 w-3.5 text-signal" />
              {t("核对版本与评测证据", "Verify versions and benchmarks")}
            </button>
          </section>

          <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_300px]">
            <aside className="hidden h-fit lg:block">{filterPanel}</aside>
            <section className="min-w-0 space-y-3">
              {viewMode === "graph" ? (
                <KnowledgeGraph
                  entities={entities}
                  relations={visibleRelations}
                  entityIds={visibleIds}
                  centerId={selectedNode?.id ?? focusNodeId ?? undefined}
                  onSelectNode={selectNode}
                  onSelectEdge={selectEdge}
                  selectedNodeId={selectedNode?.id}
                  selectedEdgeId={selectedEdge?.id}
                  highlightedNodeIds={path?.nodeIds}
                  highlightedEdgeIds={path?.edgeIds}
                  focusNodeId={focusNodeId}
                  height={compact ? 720 : 660}
                  canvasWidth={compact ? 640 : 780}
                />
              ) : (
                <GraphList
                  entities={visibleEntities}
                  relations={visibleRelations}
                  onSelect={selectNode}
                />
              )}
              <GraphLegend />
              <p className="text-xs text-white/45" aria-live="polite">
                {t(
                  `当前显示 ${visibleEntities.length} 个实体、${visibleRelations.length} 条关系。`,
                  `Showing ${visibleEntities.length} entities and ${visibleRelations.length} relationships.`,
                )}
                {compact && timeAndTypeIds.size > 24
                  ? t(" 移动端已限制为 24 个节点。", " Mobile view is capped at 24 nodes.")
                  : ""}
              </p>
            </section>
            <aside className="hidden h-fit lg:block">{inspector}</aside>
          </div>
        </div>
      </main>

      <Drawer open={filtersOpen && compact} onOpenChange={setFiltersOpen}>
        <DrawerContent className="max-h-[88vh] border-border bg-card text-foreground">
          <DrawerHeader>
            <DrawerTitle>{t("图谱筛选", "Graph filters")}</DrawerTitle>
            <DrawerDescription className="text-muted-foreground">
              {t(
                "限制实体、关系、可信度与时间范围。",
                "Limit entities, relationships, confidence, and time.",
              )}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-8">{filterPanel}</div>
        </DrawerContent>
      </Drawer>
      <Drawer
        open={compact && Boolean(selectedNode || selectedEdge)}
        onOpenChange={(open) => {
          if (!open) clearSelection();
        }}
      >
        <DrawerContent className="max-h-[88vh] border-border bg-card text-foreground">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t("图谱详情", "Graph details")}</DrawerTitle>
            <DrawerDescription>
              {t("所选节点或关系的详情与证据。", "Details and evidence for the selection.")}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-8 pt-3">{inspector}</div>
        </DrawerContent>
      </Drawer>
    </AppShell>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${
        active ? "bg-white text-graph-bg" : "text-white/60 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function PathSelect({
  label,
  value,
  entities,
  onChange,
}: {
  label: string;
  value: string;
  entities: Entity[];
  onChange: (value: string) => void;
}) {
  const { lang } = useApp();
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 max-w-36 rounded-md border border-white/15 bg-graph-surface px-2 text-xs text-white outline-none focus:border-white/40 sm:max-w-44"
        aria-label={label}
      >
        <option value="">{label}</option>
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {pick(entity.name, lang)}
          </option>
        ))}
      </select>
    </label>
  );
}

function GraphFilters({
  enabledTypes,
  enabledRelations,
  enabledConfidences,
  year,
  depth,
  onToggleType,
  onToggleRelation,
  onToggleConfidence,
  onYearChange,
  onDepthChange,
}: {
  enabledTypes: Record<EntityType, boolean>;
  enabledRelations: Record<RelationKind, boolean>;
  enabledConfidences: Record<Confidence, boolean>;
  year: number[];
  depth: Depth;
  onToggleType: (type: EntityType) => void;
  onToggleRelation: (kind: RelationKind) => void;
  onToggleConfidence: (confidence: Confidence) => void;
  onYearChange: (value: number[]) => void;
  onDepthChange: (depth: Depth) => void;
}) {
  const { t, lang } = useApp();
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
      <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-widest text-white/55">
        <Filter className="h-3.5 w-3.5" />
        {t("筛选器", "Filters")}
      </div>
      <FilterGroup title={t("实体类型", "Entity types")}>
        <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
          {NODE_TYPES.map(({ type, shape, color, label }) => (
            <FilterToggle
              key={type}
              active={enabledTypes[type]}
              label={pick(label, lang)}
              marker={<ShapeSwatch shape={shape} color={color} />}
              onClick={() => onToggleType(type)}
            />
          ))}
        </div>
      </FilterGroup>
      <FilterGroup title={t("关系类型", "Relation types")}>
        <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
          {RELATION_TYPES.map((kind) => (
            <FilterToggle
              key={kind}
              active={enabledRelations[kind]}
              label={pick(RELATION_LABELS[kind], lang)}
              onClick={() => onToggleRelation(kind)}
            />
          ))}
        </div>
      </FilterGroup>
      <FilterGroup title={t("可信度", "Confidence")}>
        <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
          {CONFIDENCE_TYPES.map((confidence) => (
            <FilterToggle
              key={confidence}
              active={enabledConfidences[confidence]}
              label={pick(CONFIDENCE_LABELS[confidence], lang)}
              marker={<LineSwatch confidence={confidence} />}
              onClick={() => onToggleConfidence(confidence)}
            />
          ))}
        </div>
      </FilterGroup>
      <FilterGroup title={t("邻域深度", "Neighborhood depth")}>
        <div className="grid grid-cols-3 gap-1">
          {([1, 2, "all"] as Depth[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onDepthChange(value)}
              aria-pressed={depth === value}
              className={`h-8 rounded-md border text-xs ${
                depth === value
                  ? "border-white/60 bg-white text-graph-bg"
                  : "border-white/15 text-white/60 hover:bg-white/10"
              }`}
            >
              {value === "all" ? t("全部", "All") : value}
            </button>
          ))}
        </div>
      </FilterGroup>
      <div>
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-white/65">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {t("时间范围", "Time range")}
          </span>
          <span className="tabular-nums">
            {year[0]}–{year[1]}
          </span>
        </div>
        <Slider value={year} onValueChange={onYearChange} min={2015} max={2026} step={1} />
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 text-[11px] uppercase tracking-wider text-white/45">{title}</legend>
      {children}
    </fieldset>
  );
}

function FilterToggle({
  active,
  label,
  marker,
  onClick,
}: {
  active: boolean;
  label: string;
  marker?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-8 w-full items-center gap-2 rounded-md border px-2.5 text-left text-xs ${
        active ? "border-white/25 bg-white/10 text-white" : "border-white/10 text-white/35"
      }`}
    >
      {marker}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check className="h-3 w-3 shrink-0" />}
    </button>
  );
}

function ShapeSwatch({ shape, color }: { shape: NodeShape; color: string }) {
  const shapeClass =
    shape === "circle"
      ? "rounded-full"
      : shape === "diamond"
        ? "rotate-45 rounded-[2px]"
        : shape === "hexagon"
          ? "[clip-path:polygon(25%_0,75%_0,100%_50%,75%_100%,25%_100%,0_50%)]"
          : "rounded-[2px]";
  return (
    <span
      className={`h-2.5 w-2.5 shrink-0 ${shapeClass}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

function LineSwatch({ confidence }: { confidence: Confidence }) {
  const borderStyle =
    confidence === "verified" ? "solid" : confidence === "unverified" ? "dotted" : "dashed";
  return (
    <span
      className="w-5 shrink-0 border-t-2"
      style={{
        borderTopStyle: borderStyle,
        borderTopColor: confidence === "conflict" ? "var(--conflict)" : "currentColor",
      }}
      aria-hidden="true"
    />
  );
}

function GraphLegend() {
  const { t } = useApp();
  return (
    <div
      className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/55"
      aria-label={t("图例", "Legend")}
    >
      <span>{t("形状表示实体类型", "Shape = entity type")}</span>
      <span className="inline-flex items-center gap-1.5">
        <LineSwatch confidence="verified" />
        {t("实线：已核验", "Solid: verified")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LineSwatch confidence="inferred" />
        {t("虚线：推断", "Dashed: inferred")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LineSwatch confidence="unverified" />
        {t("点线：未核验", "Dotted: unverified")}
      </span>
    </div>
  );
}

function GraphList({
  entities,
  relations,
  onSelect,
}: {
  entities: Entity[];
  relations: GraphEdge[];
  onSelect: (entity: Entity) => void;
}) {
  const { t, lang } = useApp();
  const degrees = useMemo(() => {
    const result = new Map<string, number>();
    relations.forEach((edge) => {
      result.set(edge.fromId, (result.get(edge.fromId) ?? 0) + 1);
      result.set(edge.toId, (result.get(edge.toId) ?? 0) + 1);
    });
    return result;
  }, [relations]);
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/45">
            <tr>
              <th className="px-4 py-3 font-medium">{t("实体", "Entity")}</th>
              <th className="px-4 py-3 font-medium">{t("类型", "Type")}</th>
              <th className="px-4 py-3 font-medium">{t("厂商", "Vendor")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("关系数", "Relations")}</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr
                key={entity.id}
                className="border-b border-white/10 last:border-b-0 hover:bg-white/5"
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onSelect(entity)}
                    className="font-medium text-white hover:underline"
                  >
                    {pick(entity.name, lang)}
                  </button>
                </td>
                <td className="px-4 py-3 text-white/60">
                  {pick(ENTITY_TYPE_LABELS[entity.type], lang)}
                </td>
                <td className="px-4 py-3 text-white/60">{entity.vendor ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-white/70">
                  {degrees.get(entity.id) ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!entities.length && (
        <p className="p-8 text-center text-sm text-white/55">
          {t("当前筛选条件下没有实体。", "No entities match the current filters.")}
        </p>
      )}
    </div>
  );
}

function GraphInspector({
  selectedNode,
  selectedEdge,
  relations,
  entityById,
  evidenceById,
  onClose,
  onSelectEdge,
}: {
  selectedNode: Entity | null;
  selectedEdge: GraphEdge | null;
  relations: GraphEdge[];
  entityById: Map<string, Entity>;
  evidenceById: Map<string, KnowledgeSnapshot["evidence"][number]>;
  onClose: () => void;
  onSelectEdge: (edge: GraphEdge) => void;
}) {
  const { t, lang } = useApp();
  if (!selectedNode && !selectedEdge) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-sm text-white/65">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-white/45">
          <Filter className="h-3.5 w-3.5" />
          {t("检查器", "Inspector")}
        </div>
        <p>
          {t(
            "选择节点查看详情，或选择连线核验关系及其来源证据。",
            "Select a node for details, or an edge to verify its relationship and sources.",
          )}
        </p>
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("关系示例 · 点击查看证据", "Relationship examples · select for evidence")}
          </div>
          <div className="space-y-2">
            {relations.slice(0, 4).map((edge) => {
              const from = entityById.get(edge.fromId);
              const to = entityById.get(edge.toId);
              return (
                <button
                  key={edge.id}
                  type="button"
                  onClick={() => onSelectEdge(edge)}
                  className="w-full rounded-lg border border-border bg-card p-3 text-left hover:border-signal/40 hover:bg-accent"
                >
                  <span className="block text-xs font-medium text-foreground">
                    {from ? pick(from.name, lang) : edge.fromId}
                  </span>
                  <span className="my-1 flex items-center gap-1 text-[11px] font-medium text-signal">
                    <ArrowRight className="h-3 w-3" />
                    {pick(RELATION_LABELS[edge.kind], lang)}
                  </span>
                  <span className="block text-xs font-medium text-foreground">
                    {to ? pick(to.name, lang) : edge.toId}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  if (selectedEdge) {
    const from = entityById.get(selectedEdge.fromId);
    const to = entityById.get(selectedEdge.toId);
    const sources = selectedEdge.sourceIds
      .map((id) => evidenceById.get(id))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-white">
        <InspectorHeader eyebrow={t("关系证据", "Relationship evidence")} onClose={onClose} />
        <h2 className="font-serif text-xl font-semibold">
          {pick(RELATION_LABELS[selectedEdge.kind], lang)}
        </h2>
        <div className="mt-3 rounded-lg border border-white/10 bg-black/15 p-3 text-sm">
          <div className="font-medium">{from ? pick(from.name, lang) : selectedEdge.fromId}</div>
          <div className="my-2 flex items-center gap-2 text-xs text-white/45">
            <ArrowRight className="h-3.5 w-3.5" />
            {pick(RELATION_LABELS[selectedEdge.kind], lang)}
          </div>
          <div className="font-medium">{to ? pick(to.name, lang) : selectedEdge.toId}</div>
        </div>
        <div className="mt-3">
          <ConfidenceChip level={selectedEdge.confidence} />
        </div>
        <div className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-white/45">
            {t("来源证据", "Source evidence")}
          </h3>
          {sources.length ? (
            <ul className="space-y-2">
              {sources.map((source) => (
                <li key={source.id}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border border-white/10 p-3 hover:bg-white/10"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{pick(source.title, lang)}</span>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" />
                    </span>
                    <span className="mt-1 block text-[11px] text-white/45">
                      {source.publisher} · {source.publishedAt}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/55">
              {t("该关系尚未绑定来源。", "No source is attached to this relationship.")}
            </p>
          )}
        </div>
      </div>
    );
  }

  const node = selectedNode!;
  const related = relations.filter((edge) => edge.fromId === node.id || edge.toId === node.id);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-white">
      <InspectorHeader eyebrow={pick(ENTITY_TYPE_LABELS[node.type], lang)} onClose={onClose} />
      <h2 className="font-serif text-2xl font-semibold">{pick(node.name, lang)}</h2>
      {node.vendor && <p className="mt-1 text-xs text-white/50">{node.vendor}</p>}
      <p className="mt-3 text-sm leading-relaxed text-white/75">{pick(node.summary, lang)}</p>
      <div className="mt-5">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-white/45">
          {t("可见关系", "Visible relationships")} · {related.length}
        </h3>
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {related.map((edge) => {
            const otherId = edge.fromId === node.id ? edge.toId : edge.fromId;
            const other = entityById.get(otherId);
            const relationLabel = pick(RELATION_LABELS[edge.kind], lang);
            const direction =
              edge.fromId === node.id
                ? `${pick(node.name, lang)} —${relationLabel}→ ${other ? pick(other.name, lang) : otherId}`
                : `${other ? pick(other.name, lang) : otherId} —${relationLabel}→ ${pick(node.name, lang)}`;
            return (
              <li key={edge.id}>
                <button
                  type="button"
                  onClick={() => onSelectEdge(edge)}
                  className="flex w-full items-center gap-2 rounded-md border border-white/10 p-2 text-left hover:bg-white/10"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {other ? pick(other.name, lang) : otherId}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-white/45">
                      {direction}
                    </span>
                  </span>
                  <ConfidenceChip level={edge.confidence} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <Link
        to="/knowledge/model/$slug"
        params={{ slug: node.slug }}
        className="mt-5 inline-flex h-9 items-center gap-1 rounded-md bg-signal px-3 text-sm font-medium text-white hover:opacity-90"
      >
        {t("查看完整详情", "Full detail")}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function InspectorHeader({ eyebrow, onClose }: { eyebrow: string; onClose: () => void }) {
  const { t } = useApp();
  return (
    <div className="mb-2 flex items-start justify-between gap-2">
      <span className="text-xs uppercase tracking-widest text-white/45">{eyebrow}</span>
      <button
        type="button"
        onClick={onClose}
        className="grid h-7 w-7 place-items-center rounded-md text-white/50 hover:bg-white/10 hover:text-white"
        aria-label={t("关闭详情", "Close details")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
