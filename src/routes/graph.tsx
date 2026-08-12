import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ExternalLink,
  GitCompareArrows,
  Network,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfidenceChip, DemoBadge } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import { KnowledgeGraph } from "@/components/graph/KnowledgeGraph";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ENTITY_TYPE_LABELS, RELATION_LABELS } from "@/domain/labels";
import {
  connectionPath,
  connectionPaths,
  ecosystemGroups,
  impactLeads,
  impactScope,
  incidentRelations,
  relationshipStats,
} from "@/domain/relationship-insights";
import type { Entity, Evidence, GraphEdge, KnowledgeSnapshot } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { pick, useApp } from "@/lib/app-state";

type InsightMode = "ecosystem" | "connection" | "impact";
type InsightSearch = { entity?: string; target?: string; mode?: InsightMode };

export const Route = createFileRoute("/graph")({
  validateSearch: (search: Record<string, unknown>): InsightSearch => {
    const validated: InsightSearch = {};
    if (typeof search.entity === "string") validated.entity = search.entity;
    if (typeof search.target === "string") validated.target = search.target;
    if (search.mode === "ecosystem" || search.mode === "connection" || search.mode === "impact") {
      validated.mode = search.mode;
    }
    return validated;
  },
  head: () => ({
    meta: [
      { title: "关系洞察 · AI Radar" },
      {
        name: "description",
        content: "解释 AI 实体之间的关系、生态组成与潜在影响范围，并核验每段关系的证据。",
      },
      { property: "og:title", content: "AI Radar · 关系洞察" },
      {
        property: "og:description",
        content: "从已审核关系中获得可读结论，而不是只看一张节点图。",
      },
    ],
  }),
  component: RelationshipInsightsPage,
});

const MODE_META = {
  ecosystem: {
    icon: Building2,
    zh: "生态组成",
    en: "Ecosystem",
    descZh: "看清一个对象连接的公司、版本、协议、工具与评测。",
    descEn: "Map the companies, versions, protocols, tools, and benchmarks around one entity.",
  },
  connection: {
    icon: GitCompareArrows,
    zh: "关系解释",
    en: "Connection",
    descZh: "选择两个对象，逐段解释它们为什么有关。",
    descEn: "Choose two entities and explain why they are connected, step by step.",
  },
  impact: {
    icon: Radar,
    zh: "关联范围",
    en: "Reach",
    descZh: "区分直接关系与二跳线索，发现值得继续调查的对象。",
    descEn: "Separate direct links from two-hop leads worth investigating.",
  },
} as const;

function RelationshipInsightsPage() {
  const { t } = useApp();
  const search = Route.useSearch();
  const snapshotQuery = useKnowledgeSnapshot();
  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "关系数据加载失败" : "正在加载关系洞察",
            snapshotQuery.error ? "Relationship data failed to load" : "Loading insights",
          )}
          description={t(
            "请稍后重试；页面不会用缺失关系生成推断。",
            "Retry shortly; missing relationships are never replaced with invented inferences.",
          )}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }
  return <RelationshipWorkspace snapshot={snapshotQuery.data} initialSearch={search} />;
}

function RelationshipWorkspace({
  snapshot,
  initialSearch,
}: {
  snapshot: KnowledgeSnapshot;
  initialSearch: { entity?: string; target?: string; mode?: InsightMode };
}) {
  const { t, lang } = useApp();
  const navigate = Route.useNavigate();
  const entities = snapshot.entities;
  const relations = snapshot.graph.edges;
  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );
  const evidenceById = useMemo(
    () => new Map(snapshot.evidence.map((source) => [source.id, source])),
    [snapshot.evidence],
  );
  const defaultPrimary =
    initialSearch.entity && entityById.has(initialSearch.entity)
      ? initialSearch.entity
      : entityById.has("e-gpt")
        ? "e-gpt"
        : (entities[0]?.id ?? "");
  const defaultSecondary =
    initialSearch.target && entityById.has(initialSearch.target)
      ? initialSearch.target
      : entityById.has("e-claude")
        ? "e-claude"
        : (entities.find((entity) => entity.id !== defaultPrimary)?.id ?? "");
  const [mode, setMode] = useState<InsightMode>(initialSearch.mode ?? "ecosystem");
  const [primaryId, setPrimaryId] = useState(defaultPrimary);
  const [secondaryId, setSecondaryId] = useState(defaultSecondary);
  const [impactDepth, setImpactDepth] = useState<1 | 2>(2);
  const [connectionIndex, setConnectionIndex] = useState(0);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");

  useEffect(() => {
    void navigate({
      search: {
        entity: primaryId,
        target: mode === "connection" ? secondaryId : undefined,
        mode,
      },
      replace: true,
    });
  }, [mode, navigate, primaryId, secondaryId]);

  useEffect(() => {
    if (initialSearch.entity && entityById.has(initialSearch.entity)) {
      setPrimaryId(initialSearch.entity);
    }
    if (initialSearch.target && entityById.has(initialSearch.target)) {
      setSecondaryId(initialSearch.target);
    }
    if (initialSearch.mode) setMode(initialSearch.mode);
  }, [entityById, initialSearch.entity, initialSearch.mode, initialSearch.target]);

  const primary = entityById.get(primaryId) ?? entities[0];
  const secondary = entityById.get(secondaryId);
  const groups = useMemo(
    () => (primary ? ecosystemGroups(entities, relations, primary.id) : []),
    [entities, primary, relations],
  );
  const primaryRelations = useMemo(
    () => (primary ? incidentRelations(relations, primary.id) : []),
    [primary, relations],
  );
  const connection = useMemo(
    () => connectionPath(entities, relations, primaryId, secondaryId),
    [entities, primaryId, relations, secondaryId],
  );
  const alternativeConnections = useMemo(
    () => connectionPaths(entities, relations, primaryId, secondaryId, 3),
    [entities, primaryId, relations, secondaryId],
  );
  const activeConnection = alternativeConnections[connectionIndex] ?? connection;
  const stats = useMemo(
    () => (primary ? relationshipStats(relations, primary.id) : null),
    [primary, relations],
  );
  const leads = useMemo(
    () => (primary ? impactLeads(relations, primary.id) : []),
    [primary, relations],
  );
  const scope = useMemo(
    () =>
      primary
        ? impactScope(entities, relations, primary.id, impactDepth)
        : { entityIds: [], directIds: new Set<string>(), indirectIds: new Set<string>() },
    [entities, impactDepth, primary, relations],
  );
  const selectedEdge = relations.find((edge) => edge.id === selectedEdgeId) ?? null;
  const relevantRelations = useMemo(() => {
    if (mode === "connection") {
      const ids = new Set(activeConnection.path?.edgeIds ?? []);
      return relations.filter((edge) => ids.has(edge.id));
    }
    if (mode === "impact") {
      const ids = new Set([primaryId, ...scope.entityIds]);
      return relations
        .filter((edge) => ids.has(edge.fromId) && ids.has(edge.toId))
        .sort(
          (left, right) =>
            Number(right.fromId === primaryId || right.toId === primaryId) -
            Number(left.fromId === primaryId || left.toId === primaryId),
        );
    }
    return primaryRelations;
  }, [
    activeConnection.path?.edgeIds,
    mode,
    primaryId,
    primaryRelations,
    relations,
    scope.entityIds,
  ]);

  const graphEntityIds = useMemo(() => {
    if (!primary) return [];
    if (mode === "connection") return activeConnection.path?.nodeIds ?? [primary.id];
    if (mode === "impact") return [primary.id, ...scope.entityIds].slice(0, 20);
    const directIds = groups.flatMap((group) => group.entities.map((entity) => entity.id));
    return [primary.id, ...directIds].slice(0, 20);
  }, [activeConnection.path?.nodeIds, groups, mode, primary, scope.entityIds]);
  const graphIdSet = useMemo(() => new Set(graphEntityIds), [graphEntityIds]);
  const graphRelations = useMemo(
    () =>
      relevantRelations.filter((edge) => graphIdSet.has(edge.fromId) && graphIdSet.has(edge.toId)),
    [graphIdSet, relevantRelations],
  );

  const switchMode = (nextMode: InsightMode) => {
    setMode(nextMode);
    setConnectionIndex(0);
    setSelectedEdgeId("");
  };

  if (!primary) return null;

  return (
    <AppShell>
      <main className="min-h-[calc(100vh-3.5rem)] min-w-0 overflow-x-hidden bg-background text-foreground">
        <div className="page-container min-w-0 pb-14 pt-8 md:pt-10">
          <header className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <DemoBadge />
              <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                {t("关系均来自已收录数据", "Relationships use recorded data only")}
              </span>
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              {t("关系洞察", "Relationship insights")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              {t(
                "先回答问题，再用局部关系图解释答案。查看生态组成、解释两个对象为何相关，或发现值得继续核验的关联范围。",
                "Start with an answer, then use a local graph to explain it. Map an ecosystem, explain a connection, or identify relationships worth further review.",
              )}
            </p>
          </header>

          <section
            className="mt-7 grid gap-3 md:grid-cols-3"
            aria-label={t("洞察任务", "Insight tasks")}
          >
            {(Object.keys(MODE_META) as InsightMode[]).map((key) => {
              const item = MODE_META[key];
              const Icon = item.icon;
              const active = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchMode(key)}
                  aria-pressed={active}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    active
                      ? "border-signal bg-signal/5 shadow-sm"
                      : "border-border bg-card hover:border-signal/40 hover:bg-accent/40"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-lg ${
                        active ? "bg-signal text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="font-semibold">{t(item.zh, item.en)}</span>
                    {active && <CheckCircle2 className="ml-auto h-4 w-4 text-signal" />}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {t(item.descZh, item.descEn)}
                  </p>
                </button>
              );
            })}
          </section>

          <section className="mt-5 rounded-xl border border-border bg-card p-4 md:p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <EntityPicker
                label={
                  mode === "connection"
                    ? t("起点对象", "Start entity")
                    : t("分析对象", "Entity to analyze")
                }
                value={primaryId}
                entities={entities}
                onChange={(value) => {
                  setPrimaryId(value);
                  setConnectionIndex(0);
                  if (value === secondaryId) {
                    setSecondaryId(entities.find((entity) => entity.id !== value)?.id ?? "");
                  }
                  setSelectedEdgeId("");
                }}
              />
              {mode === "connection" ? (
                <EntityPicker
                  label={t("终点对象", "Destination entity")}
                  value={secondaryId}
                  entities={entities.filter((entity) => entity.id !== primaryId)}
                  onChange={(value) => {
                    setSecondaryId(value);
                    setConnectionIndex(0);
                    setSelectedEdgeId("");
                  }}
                />
              ) : (
                <div className="hidden md:block" />
              )}
              {mode === "impact" && (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("分析深度", "Analysis depth")}
                  </div>
                  <div className="inline-flex rounded-lg border border-border bg-background p-1">
                    {[1, 2].map((depth) => (
                      <button
                        key={depth}
                        type="button"
                        onClick={() => setImpactDepth(depth as 1 | 2)}
                        className={`h-8 rounded-md px-3 text-xs ${
                          impactDepth === depth
                            ? "bg-signal text-white"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {depth === 1 ? t("直接", "Direct") : t("含二跳", "Two hops")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <InsightAnswer
                mode={mode}
                primary={primary}
                secondary={secondary}
                groups={groups}
                directCount={scope.directIds.size}
                indirectCount={scope.indirectIds.size}
                pathLength={activeConnection.path?.edgeIds.length ?? null}
              />

              {stats && <RelationshipOverview stats={stats} />}

              {mode === "ecosystem" && (
                <EcosystemResult groups={groups} primary={primary} relations={relations} />
              )}
              {mode === "connection" && (
                <ConnectionResult
                  primary={primary}
                  secondary={secondary}
                  paths={alternativeConnections}
                  activeIndex={connectionIndex}
                  onChangePath={(index) => {
                    setConnectionIndex(index);
                    setSelectedEdgeId("");
                  }}
                  steps={activeConnection.steps}
                  onSelectEdge={setSelectedEdgeId}
                />
              )}
              {mode === "impact" && (
                <ImpactResult
                  entities={entities}
                  edges={relations}
                  directIds={scope.directIds}
                  indirectIds={scope.indirectIds}
                  leads={impactDepth === 2 ? leads : []}
                  centerId={primary.id}
                  onSelectEdge={setSelectedEdgeId}
                />
              )}

              <section className="rounded-xl border border-border bg-card p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 font-semibold">
                      <Network className="h-4 w-4 text-signal" />
                      {t("局部关系视图", "Local relationship view")}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        "图形只用于解释上面的结论；点击连线可核验证据。",
                        "The graph explains the result above. Select an edge to verify evidence.",
                      )}
                    </p>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {graphEntityIds.length} {t("个对象", "entities")} · {graphRelations.length}{" "}
                    {t("条关系", "relationships")}
                  </span>
                </div>
                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                  <KnowledgeGraph
                    entities={entities}
                    relations={graphRelations}
                    entityIds={graphEntityIds}
                    centerId={primary.id}
                    selectedEdgeId={selectedEdge?.id}
                    highlightedNodeIds={activeConnection.path?.nodeIds}
                    highlightedEdgeIds={activeConnection.path?.edgeIds}
                    onSelectEdge={(edge) => setSelectedEdgeId(edge.id)}
                    height={480}
                    canvasWidth={900}
                  />
                </div>
              </section>
            </div>

            <aside className="h-fit xl:sticky xl:top-20">
              <EvidencePanel
                edge={selectedEdge}
                fallbackEdges={relevantRelations}
                entityById={entityById}
                evidenceById={evidenceById}
                onSelectEdge={setSelectedEdgeId}
              />
            </aside>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function InsightAnswer({
  mode,
  primary,
  secondary,
  groups,
  directCount,
  indirectCount,
  pathLength,
}: {
  mode: InsightMode;
  primary: Entity;
  secondary?: Entity;
  groups: ReturnType<typeof ecosystemGroups>;
  directCount: number;
  indirectCount: number;
  pathLength: number | null;
}) {
  const { t, lang } = useApp();
  const primaryName = pick(primary.name, lang);
  let answer: string;
  if (mode === "connection") {
    const secondaryName = secondary
      ? pick(secondary.name, lang)
      : t("所选对象", "the selected entity");
    answer =
      pathLength === null
        ? t(
            `${primaryName} 与 ${secondaryName} 在当前已审核关系中没有可解释路径。`,
            `No explainable path connects ${primaryName} and ${secondaryName} in the reviewed relationships.`,
          )
        : t(
            `${primaryName} 与 ${secondaryName} 通过 ${pathLength} 段已收录关系相连。下方逐段展示关系方向、可信度和证据。`,
            `${primaryName} and ${secondaryName} are connected through ${pathLength} recorded relationship${pathLength === 1 ? "" : "s"}. Each step, confidence level, and source appears below.`,
          );
  } else if (mode === "impact") {
    answer = t(
      `${primaryName} 当前有 ${directCount} 个直接关联对象${indirectCount ? `，以及 ${indirectCount} 个二跳线索` : ""}。这些是调查范围，不代表已经证明的因果影响。`,
      `${primaryName} currently has ${directCount} direct relationships${indirectCount ? ` and ${indirectCount} two-hop leads` : ""}. This is an investigation scope, not proof of causal impact.`,
    );
  } else {
    answer = t(
      `${primaryName} 的直接生态覆盖 ${groups.length} 类对象、${groups.reduce((total, group) => total + group.entities.length, 0)} 个关联实体。`,
      `${primaryName}'s direct ecosystem spans ${groups.length} entity types and ${groups.reduce((total, group) => total + group.entities.length, 0)} related entities.`,
    );
  }
  return (
    <section className="rounded-xl border border-signal/25 bg-signal/5 p-5 md:p-6">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-signal">
        <Sparkles className="h-4 w-4" />
        {t("洞察结论", "Insight")}
      </div>
      <p className="mt-3 text-lg font-medium leading-8 text-foreground">{answer}</p>
    </section>
  );
}

function EcosystemResult({
  groups,
  primary,
  relations,
}: {
  groups: ReturnType<typeof ecosystemGroups>;
  primary: Entity;
  relations: GraphEdge[];
}) {
  const { t, lang } = useApp();
  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <SectionHeading
        icon={<CircleDot className="h-4 w-4" />}
        title={t("生态组成", "Ecosystem composition")}
        description={t(
          "只统计与分析对象直接相连的关系。",
          "Only direct relationships are counted.",
        )}
      />
      {groups.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <div key={group.type} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {pick(ENTITY_TYPE_LABELS[group.type], lang)}
                </h3>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {group.entities.length}
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {group.entities.map((entity) => {
                  const edge = relations.find(
                    (item) =>
                      (item.fromId === primary.id && item.toId === entity.id) ||
                      (item.toId === primary.id && item.fromId === entity.id),
                  );
                  return (
                    <li key={entity.id}>
                      <Link
                        to="/knowledge/$type/$slug"
                        params={{ type: entity.type, slug: entity.slug }}
                        className="group flex items-center gap-2 rounded-md p-2 hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {pick(entity.name, lang)}
                          </span>
                          {edge && (
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {pick(RELATION_LABELS[edge.kind], lang)}
                            </span>
                          )}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-signal" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <EmptyResult>
          {t("当前对象还没有直接关系。", "No direct relationships are recorded yet.")}
        </EmptyResult>
      )}
    </section>
  );
}

function RelationshipOverview({ stats }: { stats: ReturnType<typeof relationshipStats> }) {
  const { t } = useApp();
  const verifiedRate = stats.relationshipCount
    ? Math.round((stats.verifiedCount / stats.relationshipCount) * 100)
    : 0;
  const sourcedRate = stats.relationshipCount
    ? Math.round((stats.sourcedCount / stats.relationshipCount) * 100)
    : 0;
  const items = [
    {
      label: t("关联对象", "Related entities"),
      value: stats.relatedEntityCount,
      note: t(`${stats.relationKindCount} 种关系类型`, `${stats.relationKindCount} relation types`),
    },
    {
      label: t("已核验关系", "Verified relationships"),
      value: `${verifiedRate}%`,
      note: `${stats.verifiedCount} / ${stats.relationshipCount}`,
    },
    {
      label: t("证据覆盖", "Evidence coverage"),
      value: `${sourcedRate}%`,
      note: t(`${stats.sourceCount} 个独立来源`, `${stats.sourceCount} distinct sources`),
    },
  ];
  return (
    <section
      className="grid gap-3 sm:grid-cols-3"
      aria-label={t("关系质量概览", "Relationship quality")}
    >
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{item.note}</div>
        </div>
      ))}
    </section>
  );
}

function ConnectionResult({
  primary,
  secondary,
  paths,
  activeIndex,
  onChangePath,
  steps,
  onSelectEdge,
}: {
  primary: Entity;
  secondary?: Entity;
  paths: ReturnType<typeof connectionPaths>;
  activeIndex: number;
  onChangePath: (index: number) => void;
  steps: ReturnType<typeof connectionPath>["steps"];
  onSelectEdge: (id: string) => void;
}) {
  const { t, lang } = useApp();
  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <SectionHeading
        icon={<GitCompareArrows className="h-4 w-4" />}
        title={t("关系解释", "Connection explanation")}
        description={t(
          "最短路径只是最紧凑的已有解释，不代表唯一关系。",
          "The shortest path is the most compact recorded explanation, not the only possible one.",
        )}
      />
      {steps.length ? (
        <>
          {paths.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs text-muted-foreground">
                {t("可用解释", "Available explanations")}
              </span>
              {paths.map((item, index) => (
                <button
                  key={item.path.edgeIds.join("|")}
                  type="button"
                  onClick={() => onChangePath(index)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    index === activeIndex
                      ? "border-signal bg-signal text-white"
                      : "border-border bg-background hover:border-signal/40"
                  }`}
                >
                  {index === 0
                    ? t("最短路径", "Shortest")
                    : t(`备选 ${index}`, `Alternative ${index}`)}{" "}
                  · {item.path.edgeIds.length} {t("段", "steps")}
                </button>
              ))}
            </div>
          )}
          <ol className="mt-5 space-y-3">
            {steps.map((step, index) => {
              const forward = step.edge.fromId === step.from.id;
              return (
                <li key={step.edge.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEdge(step.edge.id)}
                    className="w-full rounded-lg border border-border bg-background p-4 text-left hover:border-signal/40 hover:bg-accent/40"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-signal text-[10px] font-semibold text-white">
                        {index + 1}
                      </span>
                      {t("关系步骤", "Relationship step")}
                      <ConfidenceChip level={step.edge.confidence} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span>{pick(step.from.name, lang)}</span>
                      <span className="inline-flex items-center gap-1 text-signal">
                        {forward ? "—" : "←"}
                        {pick(RELATION_LABELS[step.edge.kind], lang)}
                        {forward ? "→" : "—"}
                      </span>
                      <span>{pick(step.to.name, lang)}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {step.edge.sourceIds.length
                        ? t(
                            `关联 ${step.edge.sourceIds.length} 条来源证据，点击核验。`,
                            `${step.edge.sourceIds.length} source${step.edge.sourceIds.length === 1 ? "" : "s"} attached; select to verify.`,
                          )
                        : t("该关系尚未绑定来源。", "No source is attached to this relationship.")}
                    </p>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <EmptyResult>
          {t(
            `${pick(primary.name, lang)} 与 ${secondary ? pick(secondary.name, lang) : "所选对象"} 之间没有可用路径。可更换对象，或等待更多关系通过审核。`,
            `No path is available between ${pick(primary.name, lang)} and ${secondary ? pick(secondary.name, lang) : "the selected entity"}. Choose another entity or wait for more reviewed relationships.`,
          )}
        </EmptyResult>
      )}
    </section>
  );
}

function ImpactResult({
  entities,
  edges,
  directIds,
  indirectIds,
  leads,
  centerId,
  onSelectEdge,
}: {
  entities: Entity[];
  edges: GraphEdge[];
  directIds: Set<string>;
  indirectIds: Set<string>;
  leads: ReturnType<typeof impactLeads>;
  centerId: string;
  onSelectEdge: (id: string) => void;
}) {
  const { t, lang } = useApp();
  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <SectionHeading
        icon={<Radar className="h-4 w-4" />}
        title={t("关联范围", "Relationship reach")}
        description={t(
          "直接关系可用于核验；二跳对象只是研究线索，不能自动视为受影响对象。",
          "Direct links can be verified. Two-hop entities are research leads, not confirmed impact.",
        )}
      />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ScopeGroup
          title={t("直接关系", "Direct relationships")}
          description={t(
            "与分析对象共享一条已收录关系。",
            "One recorded edge from the analyzed entity.",
          )}
          ids={directIds}
          entities={entities}
          tone="direct"
          onInspect={(entityId) => {
            const edge = edges.find(
              (item) =>
                (item.fromId === centerId && item.toId === entityId) ||
                (item.toId === centerId && item.fromId === entityId),
            );
            if (edge) onSelectEdge(edge.id);
          }}
        />
        <ScopeGroup
          title={t("二跳调查线索", "Two-hop research leads")}
          description={t(
            "通过另一个对象间接连接，需要进一步核验。",
            "Indirectly connected and requires further review.",
          )}
          ids={indirectIds}
          entities={entities}
          tone="indirect"
        />
      </div>
      {leads.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-background p-4">
          <h3 className="text-sm font-semibold">
            {t("二跳线索为什么出现", "Why these leads appear")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t(
              "每条线索都展示桥接对象；点击任一关系即可在右侧核验证据。",
              "Each lead shows its bridge entity. Select either relationship to verify evidence.",
            )}
          </p>
          <div className="mt-3 space-y-2">
            {leads.slice(0, 8).map((lead) => {
              const entity = entities.find((item) => item.id === lead.entityId);
              if (!entity) return null;
              return (
                <div key={lead.entityId} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      to="/knowledge/$type/$slug"
                      params={{ type: entity.type, slug: entity.slug }}
                      className="text-sm font-semibold hover:text-signal"
                    >
                      {pick(entity.name, lang)}
                    </Link>
                    <span className="text-[11px] text-muted-foreground">
                      {lead.routes.length} {t("条桥接路径", "bridge routes")}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {lead.routes.slice(0, 2).map((route) => {
                      const bridge = entities.find((item) => item.id === route.bridgeId);
                      const first = edges.find((edge) => edge.id === route.firstEdgeId);
                      const second = edges.find((edge) => edge.id === route.secondEdgeId);
                      if (!bridge || !first || !second) return null;
                      return (
                        <div
                          key={`${route.bridgeId}-${route.firstEdgeId}-${route.secondEdgeId}`}
                          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <span>{t("经由", "via")}</span>
                          <span className="font-medium text-foreground">
                            {pick(bridge.name, lang)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSelectEdge(first.id)}
                            className="text-signal hover:underline"
                          >
                            {pick(RELATION_LABELS[first.kind], lang)}
                          </button>
                          <span>+</span>
                          <button
                            type="button"
                            onClick={() => onSelectEdge(second.id)}
                            className="text-signal hover:underline"
                          >
                            {pick(RELATION_LABELS[second.kind], lang)}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function ScopeGroup({
  title,
  description,
  ids,
  entities,
  tone,
  onInspect,
}: {
  title: string;
  description: string;
  ids: Set<string>;
  entities: Entity[];
  tone: "direct" | "indirect";
  onInspect?: (entityId: string) => void;
}) {
  const { lang } = useApp();
  const items = entities.filter((entity) => ids.has(entity.id));
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${tone === "direct" ? "bg-signal" : "bg-warning"}`}
        />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length ? (
          items.map((entity) => (
            <button
              key={entity.id}
              type="button"
              onClick={() => onInspect?.(entity.id)}
              disabled={!onInspect}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:border-signal/40 hover:text-signal"
            >
              {pick(entity.name, lang)}
            </button>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function EvidencePanel({
  edge,
  fallbackEdges,
  entityById,
  evidenceById,
  onSelectEdge,
}: {
  edge: GraphEdge | null;
  fallbackEdges: GraphEdge[];
  entityById: Map<string, Entity>;
  evidenceById: Map<string, Evidence>;
  onSelectEdge: (id: string) => void;
}) {
  const { t, lang } = useApp();
  const active = edge ?? fallbackEdges[0] ?? null;
  const sources = active
    ? active.sourceIds
        .map((id) => evidenceById.get(id))
        .filter((source): source is Evidence => Boolean(source))
    : [];
  const from = active ? entityById.get(active.fromId) : undefined;
  const to = active ? entityById.get(active.toId) : undefined;
  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-signal" />
        <h2 className="font-semibold">{t("关系证据", "Relationship evidence")}</h2>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {t(
          "选择关系步骤或图中连线，核验它为什么成立。",
          "Select a relationship step or graph edge to verify why it exists.",
        )}
      </p>
      {active ? (
        <>
          <div className="mt-4 rounded-lg border border-border bg-background p-4">
            <div className="text-sm font-medium">
              {from ? pick(from.name, lang) : active.fromId}
            </div>
            <div className="my-2 flex items-center gap-2 text-xs font-medium text-signal">
              <ArrowRight className="h-3.5 w-3.5" />
              {pick(RELATION_LABELS[active.kind], lang)}
            </div>
            <div className="text-sm font-medium">{to ? pick(to.name, lang) : active.toId}</div>
            <div className="mt-3">
              <ConfidenceChip level={active.confidence} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("来源", "Sources")} · {sources.length}
            </h3>
            {sources.length ? (
              <ul className="mt-2 space-y-2">
                {sources.map((source) => (
                  <li key={source.id}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-border p-3 hover:border-signal/40 hover:bg-accent/40"
                    >
                      <span className="flex items-start justify-between gap-2 text-sm font-medium">
                        <span>{pick(source.title, lang)}</span>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {source.publisher} · {source.publishedAt}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-5 text-muted-foreground">
                {t(
                  "这条关系尚未绑定来源，应视为待核验信息。",
                  "No source is attached. Treat this relationship as pending verification.",
                )}
              </p>
            )}
          </div>
          {fallbackEdges.length > 1 && (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("其他相关关系", "Other relationships")}
              </h3>
              <div className="mt-2 space-y-1">
                {fallbackEdges.slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectEdge(item.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent ${
                      item.id === active.id ? "bg-accent text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {entityById.get(item.fromId)
                        ? pick(entityById.get(item.fromId)!.name, lang)
                        : item.fromId}{" "}
                      →{" "}
                      {entityById.get(item.toId)
                        ? pick(entityById.get(item.toId)!.name, lang)
                        : item.toId}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyResult>
          {t("当前结果没有可检查的关系。", "No relationship is available to inspect.")}
        </EmptyResult>
      )}
    </section>
  );
}

function EntityPicker({
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
  const { lang, t } = useApp();
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () =>
      [...entities].sort((left, right) =>
        pick(left.name, lang).localeCompare(pick(right.name, lang)),
      ),
    [entities, lang],
  );
  return (
    <div className="block min-w-0">
      <span className="mb-2 block text-xs font-medium text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            className="h-10 w-full justify-between bg-background px-3 font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {sorted.find((entity) => entity.id === value)
                  ? `${pick(sorted.find((entity) => entity.id === value)!.name, lang)} · ${pick(
                      ENTITY_TYPE_LABELS[sorted.find((entity) => entity.id === value)!.type],
                      lang,
                    )}`
                  : t("选择对象", "Select an entity")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 rotate-90 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={t("搜索名称、类型或标签…", "Search name, type, or tag…")} />
            <CommandList>
              <CommandEmpty>{t("没有匹配对象", "No matching entity")}</CommandEmpty>
              <CommandGroup>
                {sorted.map((entity) => (
                  <CommandItem
                    key={entity.id}
                    value={`${pick(entity.name, lang)} ${pick(ENTITY_TYPE_LABELS[entity.type], lang)} ${entity.tags.join(" ")}`}
                    onSelect={() => {
                      onChange(entity.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={`h-4 w-4 ${entity.id === value ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{pick(entity.name, lang)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {pick(ENTITY_TYPE_LABELS[entity.type], lang)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {!entities.length && (
        <span className="text-xs text-muted-foreground">{t("没有可选对象", "No entities")}</span>
      )}
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="text-signal">{icon}</span>
        {title}
      </h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function EmptyResult({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm leading-6 text-muted-foreground">
      {children}
    </div>
  );
}
