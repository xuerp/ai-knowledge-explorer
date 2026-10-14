import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, ExternalLink, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfidenceChip, DemoBadge, WorkspaceHeader } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
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
import { catalogTypeLabel, RELATION_LABELS } from "@/domain/labels";
import { connectionPaths, impactLeads, incidentRelations } from "@/domain/relationship-insights";
import {
  catalogRelationships,
  familyEntityId,
  graphEntryEntities,
  relationshipPurpose,
  type CatalogRelationship,
} from "@/domain/relationship-catalog";
import type { Entity, KnowledgeSnapshot } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { pick, useApp } from "@/lib/app-state";

type InsightMode = "ecosystem" | "connection" | "impact";
type InsightSearch = {
  entity?: string;
  target?: string;
  mode?: InsightMode;
  confidence?: string;
  linked?: "all";
  relation?: string;
  depth?: 1 | 2;
};
export const Route = createFileRoute("/graph")({
  validateSearch: (search: Record<string, unknown>): InsightSearch => ({
    entity: typeof search.entity === "string" ? search.entity : undefined,
    target: typeof search.target === "string" ? search.target : undefined,
    mode: search.mode === "impact" || search.mode === "connection" ? search.mode : "ecosystem",
    confidence: ["verified", "inferred", "unverified", "conflict"].includes(
      String(search.confidence),
    )
      ? String(search.confidence)
      : undefined,
    linked: search.linked === "all" ? "all" : undefined,
    relation:
      typeof search.relation === "string" && search.relation in RELATION_LABELS
        ? search.relation
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "知识图谱 · AI Radar" },
      {
        name: "description",
        content: "按模型家族浏览提供方、应用接入、技术依赖与评测联系，逐条核对原始证据。",
      },
    ],
  }),
  component: GraphPage,
});

function GraphPage() {
  const { t } = useApp();
  const query = useKnowledgeSnapshot();
  return (
    <AppShell>
      <div className="support-workspace workspace-page">
        {query.data && graphEntryEntities(query.data.entities).length === 0 ? (
          <DataStatePanel
            kind="empty"
            title={t("暂无关系目录", "No relationship catalog yet")}
            description={t(
              "先收录模型家族或应用对象，再建立有来源的联系。",
              "Add model families or applications before reviewing their sourced connections.",
            )}
          />
        ) : query.data ? (
          <RelationshipWorkspace snapshot={query.data} />
        ) : (
          <DataStatePanel
            kind={query.unavailableKind}
            title={t(
              query.error ? "关系数据加载失败" : "正在加载知识图谱",
              query.error ? "Unable to load relationships" : "Loading relationships",
            )}
            description={t(
              "请重试，缺失资料不会被替换为推测关系。",
              "Retry; missing data is never replaced with invented relationships.",
            )}
            onRetry={query.error ? () => query.refetch() : undefined}
          />
        )}
      </div>
    </AppShell>
  );
}

const PURPOSES = [
  {
    id: "provider",
    zh: "开发与提供方",
    en: "Developers & providers",
    desc: "谁提供或维护它",
    descEn: "Who develops or maintains it",
  },
  {
    id: "application",
    zh: "应用与接入",
    en: "Applications & integrations",
    desc: "在哪些应用和开发工具中使用",
    descEn: "Where it is used or integrated",
  },
  {
    id: "technology",
    zh: "技术依赖",
    en: "Technical foundations",
    desc: "依赖哪些技术、协议或研究",
    descEn: "Underlying technologies and research",
  },
  {
    id: "research",
    zh: "评测与研究",
    en: "Evaluation & research",
    desc: "如何评估，依据来自哪里",
    descEn: "How it is evaluated and studied",
  },
] as const;

function RelationshipWorkspace({ snapshot }: { snapshot: KnowledgeSnapshot }) {
  const { t, lang } = useApp();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const entries = graphEntryEntities(snapshot.entities);
  const primaryId = familyEntityId(snapshot.entities, search.entity ?? "e-gpt");
  const primary = entries.find((entity) => entity.id === primaryId) ?? entries[0];
  const requestedSecondary = familyEntityId(snapshot.entities, search.target ?? "e-claude");
  const secondaryId = entries.some(
    (entity) => entity.id === requestedSecondary && entity.id !== primary.id,
  )
    ? requestedSecondary
    : (entries.find((entity) => entity.id !== primary.id)?.id ?? "");
  const mode = search.mode ?? "ecosystem";
  const [expandedLeads, setExpandedLeads] = useState(false);
  const [filterText, setFilterText] = useState("");
  const edges = useMemo(
    () =>
      catalogRelationships(snapshot, {
        confidence: search.confidence,
        linkedOnly: search.linked !== "all",
      }).filter((edge) => !search.relation || edge.kind === search.relation),
    [snapshot, search.confidence, search.linked, search.relation],
  );
  const direct = incidentRelations(edges, primary.id) as CatalogRelationship[];
  const byId = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const filtered = direct.filter((edge) =>
    [byId.get(edge.fromId)?.name, byId.get(edge.toId)?.name, RELATION_LABELS[edge.kind]].some(
      (name) => name && pick(name, lang).toLowerCase().includes(filterText.toLowerCase()),
    ),
  );
  const leads = impactLeads(edges, primary.id);
  const paths =
    mode === "connection" ? connectionPaths(entries, edges, primary.id, secondaryId, 3) : [];
  const versions = snapshot.entities.filter((entity) => entity.familyId === primary.id);
  const sourceCount = snapshot.evidence.filter(
    (source) => source.url && direct.some((edge) => edge.sourceIds.includes(source.id)),
  ).length;
  const points =
    primary.knowledge?.keyPoints
      .filter((point) =>
        point.sourceIds?.some((id) =>
          snapshot.evidence.some((source) => source.id === id && source.url),
        ),
      )
      .slice(0, 3) ?? [];
  const update = (patch: Partial<InsightSearch>) => {
    void navigate({ search: { ...search, ...patch }, replace: true, resetScroll: false });
    setExpandedLeads(false);
    setFilterText("");
  };

  return (
    <div className="relationship-page workspace-container">
      <WorkspaceHeader
        title={t("知识图谱", "Knowledge graph")}
        description={t(
          "从提供方、应用接入和技术依据，看清一个模型或产品的联系。",
          "Understand a model or product through its providers, integrations and technical evidence.",
        )}
        actions={<DemoBadge mode={snapshot.meta.mode} updatedAt={snapshot.meta.retrievedAt} />}
      />
      <section className="relationship-controls" aria-label={t("图谱筛选", "Graph controls")}>
        <EntityPicker
          label={t("模型家族或其他对象", "Model family or entity")}
          value={primary.id}
          entities={entries}
          onChange={(entity) => update({ entity })}
        />
        <label>
          {t("核验状态", "Verification")}
          <select
            value={search.confidence ?? "all"}
            onChange={(event) =>
              update({ confidence: event.target.value === "all" ? undefined : event.target.value })
            }
          >
            <option value="all">{t("全部状态", "All states")}</option>
            <option value="verified">{t("已核验", "Verified")}</option>
            <option value="inferred">{t("推断", "Inferred")}</option>
            <option value="unverified">{t("待核验", "Unverified")}</option>
            <option value="conflict">{t("有冲突", "Conflicting")}</option>
          </select>
        </label>
        <label className="relationship-controls__check">
          <input
            type="checkbox"
            checked={search.linked !== "all"}
            onChange={(event) => update({ linked: event.target.checked ? undefined : "all" })}
          />
          {t("只看有来源的联系", "With source links only")}
        </label>
        {search.relation && (
          <Button variant="outline" onClick={() => update({ relation: undefined })}>
            {pick(RELATION_LABELS[search.relation as keyof typeof RELATION_LABELS], lang)} ·{" "}
            {t("清除", "Clear")}
          </Button>
        )}
      </section>
      <section className="relationship-profile">
        <div className="relationship-profile__header">
          <h2>{pick(primary.name, lang)}</h2>
          <div className="relationship-profile__actions">
            <EntityLink entity={primary}>
              {t("查看档案", "Open dossier")}
              <ArrowRight size={15} />
            </EntityLink>
            <Link
              to="/ask"
              search={{
                candidates: primary.id,
                task: t(
                  `评估 ${pick(primary.name, lang)} 的接入条件与使用边界`,
                  `Evaluate ${pick(primary.name, lang)} access and limitations`,
                ),
              }}
            >
              {t("交给决策助手", "Analyze with assistant")}
            </Link>
          </div>
        </div>
        <p>{pick(primary.summary, lang)}</p>
        <div className="relationship-profile__meta">
          <span>
            {direct.length} {t("条关系记录", "recorded links")}
          </span>
          <span>
            {sourceCount} {t("个来源", "sources")}
          </span>
          {versions.length > 0 && (
            <EntityLink entity={primary}>
              {t(
                `查看 ${versions.length} 个版本与规格`,
                `View ${versions.length} versions and specs`,
              )}
            </EntityLink>
          )}
        </div>
      </section>
      <nav className="relationship-tabs" aria-label={t("关系视角", "Relationship views")}>
        {(
          [
            { id: "ecosystem", zh: "直接联系", en: "Direct links" },
            { id: "impact", zh: "间接线索", en: "Indirect leads" },
            { id: "connection", zh: "查找路径", en: "Find a path" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            aria-pressed={mode === tab.id}
            onClick={() => update({ mode: tab.id })}
          >
            {t(tab.zh, tab.en)}
            {mode === tab.id && <Check size={14} />}
          </button>
        ))}
      </nav>
      {mode === "ecosystem" && (
        <>
          <div className="relationship-section-heading">
            <div>
              <h2>{t("关系总览", "Relationship overview")}</h2>
              <p>
                {t(
                  "版本已归并到家族；具体版本的适用范围保留在原始记录中。",
                  "Versions are grouped by family; original records retain their exact scope.",
                )}
              </p>
            </div>
            <label className="relationship-search">
              <Search size={16} />
              <input
                aria-label={t("筛选当前联系", "Filter current links")}
                placeholder={t("搜索当前联系…", "Search these links…")}
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
              />
            </label>
          </div>
          {filtered.length ? (
            PURPOSES.map((purpose) => {
              const rows = filtered.filter(
                (edge) => relationshipPurpose(edge, snapshot.entities) === purpose.id,
              );
              return (
                rows.length > 0 && (
                  <section className="relationship-group" key={purpose.id}>
                    <header>
                      <h3>
                        {t(purpose.zh, purpose.en)} <span>({rows.length})</span>
                      </h3>
                      <p>{t(purpose.desc, purpose.descEn)}</p>
                    </header>
                    <div className="relationship-records">
                      {rows.map((edge) => (
                        <RelationRow key={edge.id} edge={edge} snapshot={snapshot} />
                      ))}
                    </div>
                  </section>
                )
              );
            })
          ) : (
            <EmptyState
              title={t(
                filterText ? "没有匹配的联系" : "这个对象的关系资料还不足",
                filterText ? "No matching links" : "Relationship coverage is limited",
              )}
              text={t(
                filterText
                  ? "换一个关键词，或清空搜索条件。"
                  : "当前筛选下没有可展示的提供方、应用接入或技术联系。下方保留已有来源要点；缺少的关系需要核实后收录。",
                filterText
                  ? "Try another keyword or clear the search."
                  : "No provider, integration or technical links match these filters. Existing sourced notes are shown below; missing relationships need review.",
              )}
            />
          )}
        </>
      )}
      {mode === "impact" && (
        <>
          <div className="relationship-section-heading">
            <div>
              <h2>{t("通过一个中间对象发现线索", "Discover leads through one intermediary")}</h2>
              <p>
                {t(
                  "每条线索展示两段实际联系，不代表影响、兼容性或因果关系。",
                  "Each lead shows two recorded links, not impact, compatibility or causation.",
                )}
              </p>
            </div>
            <span>
              {leads.length} {t("个对象", "entities")}
            </span>
          </div>
          {leads.length ? (
            <div className="relationship-leads">
              {(expandedLeads ? leads : leads.slice(0, 8)).map((lead) => {
                const target = byId.get(lead.entityId)!;
                return (
                  <section key={lead.entityId}>
                    <header>
                      <h3>{pick(target.name, lang)}</h3>
                      <button onClick={() => update({ entity: target.id, mode: "ecosystem" })}>
                        {t("探索联系", "Explore links")}
                        <ArrowRight size={15} />
                      </button>
                    </header>
                    <p className="relationship-lead-preview">
                      {t("经由", "Via")}{" "}
                      <strong>
                        {lead.routes
                          .map((route) => pick(byId.get(route.bridgeId)!.name, lang))
                          .join(" / ")}
                      </strong>{" "}
                      ·{" "}
                      {lead.routes
                        .map((route) =>
                          [route.firstEdgeId, route.secondEdgeId]
                            .map((id) =>
                              pick(
                                RELATION_LABELS[edges.find((edge) => edge.id === id)!.kind],
                                lang,
                              ),
                            )
                            .join(" / "),
                        )
                        .join("；")}
                    </p>
                    <p>{pick(target.summary, lang)}</p>
                    <details>
                      <summary>
                        {t("查看两段关系与来源", "Inspect the two links and sources")} (
                        {lead.routes.length})
                      </summary>
                      {lead.routes.map((route) => (
                        <div key={route.bridgeId} className="relationship-lead-route">
                          <p>
                            {pick(primary.name, lang)} <ArrowRight size={14} />{" "}
                            {pick(byId.get(route.bridgeId)!.name, lang)} <ArrowRight size={14} />{" "}
                            {pick(target.name, lang)}
                          </p>
                          {[route.firstEdgeId, route.secondEdgeId].map((id) => (
                            <RelationRow
                              key={id}
                              edge={edges.find((edge) => edge.id === id)!}
                              snapshot={snapshot}
                            />
                          ))}
                        </div>
                      ))}
                    </details>
                  </section>
                );
              })}
              {leads.length > 8 && (
                <Button variant="outline" onClick={() => setExpandedLeads(!expandedLeads)}>
                  {expandedLeads
                    ? t("收起", "Show less")
                    : t(
                        `查看其余 ${leads.length - 8} 个线索`,
                        `Show ${leads.length - 8} more leads`,
                      )}
                </Button>
              )}
            </div>
          ) : (
            <EmptyState
              title={t("暂无可追溯的间接线索", "No traceable indirect leads")}
              text={t(
                "需要两段有来源的联系才能形成线索；不会用竞品或版本归属扩充范围。",
                "Two sourced links are needed; rivalry and version membership do not expand this view.",
              )}
            />
          )}
        </>
      )}
      {mode === "connection" && (
        <>
          <div className="relationship-path-picker">
            <EntityPicker
              label={t("查找到哪个对象", "Destination entity")}
              value={secondaryId}
              entities={entries.filter((entity) => entity.id !== primary.id)}
              onChange={(target) => update({ target })}
            />
            <p>
              {t(
                "沿已有联系核对路径。路径连接不等于可以互相替换或兼容。",
                "Follow recorded links. A connected path does not imply substitutability or compatibility.",
              )}
            </p>
          </div>
          {paths.length ? (
            paths.map((path, index) => (
              <section className="relationship-path" key={path.path.edgeIds.join("|")}>
                <header>
                  <h2>
                    {t("关系路径", "Relationship path")} ({index + 1})
                  </h2>
                  <p>
                    {path.steps
                      .map((step) => pick(step.from.name, lang))
                      .concat(pick(path.steps.at(-1)!.to.name, lang))
                      .join(" → ")}
                  </p>
                </header>
                {path.steps.map((step) => (
                  <RelationRow
                    key={step.edge.id}
                    edge={step.edge as CatalogRelationship}
                    snapshot={snapshot}
                  />
                ))}
              </section>
            ))
          ) : (
            <EmptyState
              title={t("没有找到可核对的路径", "No inspectable path found")}
              text={t(
                "这只表示当前资料没有连接路径，不能据此断言它们互不相关。",
                "The current catalog has no path; this does not prove the entities are unrelated.",
              )}
            />
          )}
        </>
      )}
      {points.length > 0 && (
        <section className="relationship-notes">
          <header>
            <h2>{t("来源要点", "Sourced notes")}</h2>
            <p>
              {t(
                "已有资料说明了什么，帮助判断还需要调查哪些联系。",
                "What existing documentation establishes, and what to investigate next.",
              )}
            </p>
          </header>
          <div>
            {points.map((point) => (
              <article key={point.title.zh}>
                <h3>{pick(point.title, lang)}</h3>
                <p>{pick(point.description, lang)}</p>
                <SourceLinks ids={point.sourceIds ?? []} snapshot={snapshot} />
              </article>
            ))}
          </div>
        </section>
      )}
      <footer className="relationship-boundary">
        <p>
          {t(
            "竞品比较请进入决策助手；版本谱系请进入家族档案。这里保留能查来源、解释接入与技术背景的联系。",
            "Use the decision assistant for comparisons and family dossiers for version history. This view focuses on sourced integrations and technical context.",
          )}
        </p>
        <Link to="/admin/review">
          {t("完善关系资料", "Review relationship data")}
          <ArrowRight size={14} />
        </Link>
      </footer>
    </div>
  );
}

function EntityLink({ entity, children }: { entity: Entity; children: React.ReactNode }) {
  return entity.type === "model" ? (
    <Link to="/knowledge/model/$slug" params={{ slug: entity.slug }}>
      {children}
    </Link>
  ) : (
    <Link to="/knowledge/$type/$slug" params={{ type: entity.type, slug: entity.slug }}>
      {children}
    </Link>
  );
}
function SourceLinks({ ids, snapshot }: { ids: string[]; snapshot: KnowledgeSnapshot }) {
  const { lang } = useApp();
  const sources = snapshot.evidence.filter((source) => ids.includes(source.id) && source.url);
  return (
    <ul className="relationship-sources">
      {sources.map((source) => (
        <li key={source.id}>
          <a href={source.url} target="_blank" rel="noreferrer">
            <span>{pick(source.title, lang)}</span>
            <ExternalLink size={13} />
          </a>
          <span>
            {source.publisher}
            {source.publishedAt ? ` · ${source.publishedAt}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
function RelationRow({
  edge,
  snapshot,
}: {
  edge: CatalogRelationship;
  snapshot: KnowledgeSnapshot;
}) {
  const { t, lang } = useApp();
  const from = snapshot.entities.find((entity) => entity.id === edge.fromId)!;
  const to = snapshot.entities.find((entity) => entity.id === edge.toId)!;
  const scoped = edge.records.some(
    (record) => record.fromId !== edge.fromId || record.toId !== edge.toId,
  );
  const validSources = snapshot.evidence.filter(
    (source) => edge.sourceIds.includes(source.id) && source.url,
  );
  return (
    <details className="relationship-row">
      <summary>
        <div className="relationship-row__connection">
          <strong>{pick(from.name, lang)}</strong>
          <span>{pick(RELATION_LABELS[edge.kind], lang)}</span>
          <strong>{pick(to.name, lang)}</strong>
        </div>
        <div className="relationship-row__status">
          <ConfidenceChip level={edge.confidence} />
          <span>
            {scoped
              ? t("含具体版本记录", "Version-specific records")
              : t(`${validSources.length} 个来源`, `${validSources.length} sources`)}
          </span>
          <ChevronDown size={16} />
        </div>
      </summary>
      <div className="relationship-row__details">
        <div className="relationship-row__context">
          <p>{pick((from.type === "company" ? to : from).summary, lang)}</p>
          <div>
            <EntityLink entity={from}>
              {pick(from.name, lang)} · {t("档案", "Dossier")}
            </EntityLink>
            <EntityLink entity={to}>
              {pick(to.name, lang)} · {t("档案", "Dossier")}
            </EntityLink>
          </div>
        </div>
        {scoped && (
          <p>
            {t(
              "以下是原始记录的对象范围，不代表该家族所有版本都有相同接入条件：",
              "Original scope below does not imply identical access across every family version:",
            )}
          </p>
        )}
        {edge.records.map((record) => (
          <div key={record.id} className="relationship-original">
            <p>
              {pick(snapshot.entities.find((entity) => entity.id === record.fromId)!.name, lang)} ·{" "}
              {pick(RELATION_LABELS[record.kind], lang)} ·{" "}
              {pick(snapshot.entities.find((entity) => entity.id === record.toId)!.name, lang)}
              {record.validFrom ? ` · ${record.validFrom}` : ""}
            </p>
            <SourceLinks ids={record.sourceIds} snapshot={snapshot} />
          </div>
        ))}
        {!validSources.length && (
          <p>
            {t(
              "此记录缺少可打开的直接来源，应先补充证据。",
              "This record lacks a linked source and needs evidence review.",
            )}
          </p>
        )}
      </div>
    </details>
  );
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="relationship-empty">
      <h3>{title}</h3>
      <p>{text}</p>
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
  onChange: (id: string) => void;
}) {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(false);
  const selected = entities.find((entity) => entity.id === value);
  const groups = [
    { title: t("模型家族", "Model families"), match: (entity: Entity) => entity.type === "model" },
    {
      title: t("应用与开发工具", "Applications & development"),
      match: (entity: Entity) =>
        ["application", "agent", "tool", "framework", "api"].includes(entity.type),
    },
    {
      title: t("研究与组织", "Research & organizations"),
      match: (entity: Entity) => ["paper", "benchmark", "dataset", "company"].includes(entity.type),
    },
  ];
  return (
    <div className="relationship-picker">
      <span>{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-label={label} aria-expanded={open}>
            <span>{selected ? pick(selected.name, lang) : t("选择对象", "Select entity")}</span>
            <ChevronDown size={16} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="relationship-picker-popover p-0" align="start">
          <Command>
            <CommandInput
              placeholder={t("搜索家族、应用或组织…", "Search families, apps or organizations…")}
            />
            <CommandList>
              <CommandEmpty>{t("没有匹配对象", "No matching entity")}</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.title} heading={group.title}>
                  {entities.filter(group.match).map((entity) => (
                    <CommandItem
                      key={entity.id}
                      value={`${entity.name.zh} ${entity.name.en} ${(entity.aliases ?? []).join(" ")}`}
                      onSelect={() => {
                        onChange(entity.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        size={15}
                        className={entity.id === value ? "opacity-100" : "opacity-0"}
                      />
                      <span className="relationship-picker-option">{pick(entity.name, lang)}</span>
                      <span className="relationship-picker-type">
                        {pick(catalogTypeLabel(entity), lang)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
