import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Check, ExternalLink, Search, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import type { ChangeEvent, Entity, Evidence } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { pick, useApp } from "@/lib/app-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar · 基于可信变化做出 AI 选择" },
      {
        name: "description",
        content: "追踪主流 AI 模型变化，并基于可验证证据辅助模型与产品选型。",
      },
    ],
  }),
  component: HomePage,
});

const ANCHOR_MODEL_SLUGS = ["gpt", "claude", "gemini"] as const;
const CORE_MODEL_SLUGS = [
  ...ANCHOR_MODEL_SLUGS,
  "deepseek",
  "qwen",
  "kimi",
  "doubao",
  "ernie",
] as const;
const PARTICLES = ["模", "型", "据", "码", "研", "证", "长", "工", "知", "更", "新", "源"];
const subscribeToHydration = () => () => {};

function HomePage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const snapshot = hydrated
    ? (snapshotQuery.data ?? DEMO_KNOWLEDGE_SNAPSHOT)
    : DEMO_KNOWLEDGE_SNAPSHOT;
  const showingBundledSnapshot = !hydrated || !snapshotQuery.data;
  const [timeFilter, setTimeFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("model");
  const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const cutoff = new Date(snapshot.meta.retrievedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const latestChanges = snapshot.changes
    .filter((change) => {
      const entity = entityById.get(change.entityId);
      if (!entity) return false;
      if (timeFilter === "90" && new Date(change.date) < cutoff) return false;
      if (domainFilter !== "all" && (!entity.origin || pick(entity.origin, "zh") !== domainFilter))
        return false;
      if (typeFilter !== "all" && entity.type !== typeFilter) return false;
      if (evidenceFilter !== "all" && change.confidence !== evidenceFilter) return false;
      if (verifiedOnly && change.confidence !== "verified") return false;
      return true;
    })
    .slice(0, 6);
  const [selectedId, setSelectedId] = useState(snapshot.changes[0]?.id ?? "");
  const selectedChange =
    latestChanges.find((change) => change.id === selectedId) ??
    latestChanges[0] ??
    snapshot.changes[0];
  const hasFilteredChanges = latestChanges.length > 0;
  const selectedEntity = selectedChange ? entityById.get(selectedChange.entityId) : undefined;
  const selectedSources = selectedChange
    ? (selectedChange.sourceIds
        ?.map((id) => snapshot.evidence.find((source) => source.id === id))
        .filter((source): source is Evidence => Boolean(source)) ?? [])
    : [];
  const coreEntities = CORE_MODEL_SLUGS.map((slug) =>
    snapshot.entities.find((entity) => entity.slug === slug),
  ).filter((entity): entity is Entity => Boolean(entity));
  const resetFilters = () => {
    setTimeFilter("all");
    setDomainFilter("all");
    setTypeFilter("model");
    setEvidenceFilter("all");
    setVerifiedOnly(false);
  };

  if (!selectedChange || !selectedEntity) return null;

  return (
    <AppShell>
      <div className="radar-home">
        <section className="radar-filterbar" aria-label={t("雷达筛选", "Radar filters")}>
          <div className="page-container radar-filterbar__inner">
            <div className="radar-filterset">
              <FilterSelect
                label={t("时间", "Time")}
                value={timeFilter}
                onChange={setTimeFilter}
                options={[
                  { value: "all", label: t("全部时间", "All time") },
                  { value: "90", label: t("最近 90 天", "Last 90 days") },
                ]}
              />
              <FilterSelect
                label={t("领域", "Domain")}
                value={domainFilter}
                onChange={setDomainFilter}
                options={[
                  { value: "all", label: t("全部领域", "All domains") },
                  { value: "国内", label: t("国内", "Domestic") },
                  { value: "海外", label: t("海外", "Overseas") },
                ]}
              />
              <FilterSelect
                label={t("类型", "Type")}
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: "model", label: t("基础模型", "Foundation models") },
                  { value: "all", label: t("全部类型", "All types") },
                ]}
              />
              <FilterSelect
                label={t("证据", "Evidence")}
                value={evidenceFilter}
                onChange={(value) => {
                  setEvidenceFilter(value);
                  if (value !== "verified") setVerifiedOnly(false);
                }}
                options={[
                  { value: "all", label: t("全部等级", "All levels") },
                  { value: "verified", label: t("已核验", "Verified") },
                  { value: "inferred", label: t("含推断", "Inferred") },
                ]}
              />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={verifiedOnly}
              className={`radar-verified-toggle${verifiedOnly ? " is-active" : ""}`}
              onClick={() => {
                setVerifiedOnly((current) => !current);
                setEvidenceFilter("all");
              }}
            >
              <span className="radar-toggle-dot">
                {verifiedOnly && <Check aria-hidden="true" />}
              </span>
              {t("仅显示已核验", "Verified only")}
            </button>
          </div>
        </section>

        <div className="page-container">
          <section
            id="latest"
            className={`radar-workspace${hasFilteredChanges ? "" : " is-empty"}`}
            aria-label={t("变化追踪", "Change tracking")}
          >
            <header className="radar-heading">
              <div>
                <h1>{t("动态雷达", "Live radar")}</h1>
                <p>
                  {t(
                    "基于可验证的最新变化，做出更可靠的 AI 选择；事实汇聚成结论，未证信息沉淀消散。持续追踪 GPT、Claude、Gemini 与核心模型宇宙。",
                    "Make better AI choices from verified changes; facts converge into conclusions while unsupported signals fall away across GPT, Claude, Gemini and the core model universe.",
                  )}
                </p>
              </div>
              <div className="radar-heading__status">
                <span className={showingBundledSnapshot ? "is-demo" : "is-live"} />
                {showingBundledSnapshot
                  ? t("演示快照 · 可追溯", "Demo snapshot · traceable")
                  : t("实时数据 · 已同步", "Live data · synced")}
              </div>
            </header>
            {hasFilteredChanges ? (
              <>
                <aside className="change-index">
                  <div className="workspace-panel-title">
                    <span>{t("变化追踪", "Change tracking")}</span>
                    <span className="workspace-count">
                      {String(latestChanges.length).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="change-index__list" role="list">
                    {latestChanges.map((change, index) => {
                      const entity = entityById.get(change.entityId);
                      if (!entity) return null;
                      const active = change.id === selectedChange.id;
                      return (
                        <button
                          key={change.id}
                          type="button"
                          className={`change-index__item${active ? " is-active" : ""}`}
                          onClick={() => setSelectedId(change.id)}
                          aria-pressed={active}
                        >
                          <span className="change-index__number">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="change-index__name">
                            {entity.latestVersion || pick(entity.name, lang)}
                            <small>{entity.vendor || pick(entity.name, lang)}</small>
                          </span>
                          <time dateTime={change.date}>
                            {change.date.slice(5).replace("-", ".")}
                          </time>
                        </button>
                      );
                    })}
                  </div>
                  <Link to="/knowledge" className="change-index__all">
                    {t("查看全部变化", "View all changes")} <ArrowRight aria-hidden="true" />
                  </Link>
                </aside>

                <section className="convergence-stage" aria-live="polite">
                  <div className="workspace-panel-title convergence-stage__title">
                    <span>{t("事实汇聚", "Fact convergence")}</span>
                    <span>{t("从来源到结论", "Source to conclusion")}</span>
                  </div>
                  <div className="convergence-canvas">
                    <svg
                      className="convergence-lines"
                      viewBox="0 0 720 430"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path d="M26 54 C198 54 258 185 430 215" />
                      <path d="M26 132 C202 132 275 201 430 215" />
                      <path d="M26 215 C214 215 282 215 430 215" />
                      <path d="M26 298 C202 298 275 229 430 215" />
                      <path d="M26 376 C198 376 258 245 430 215" />
                      <path className="is-evidence" d="M580 196 C638 174 665 126 714 112" />
                      <path className="is-evidence" d="M580 234 C642 248 673 300 714 316" />
                    </svg>
                    <div className="fact-stack">
                      {factFragments(selectedChange, selectedEntity, lang).map((fact, index) => (
                        <div
                          className="fact-chip"
                          key={`${selectedChange.id}-${fact}`}
                          style={{ "--fact-index": index } as CSSProperties}
                        >
                          <span>{fact}</span>
                          <i />
                        </div>
                      ))}
                    </div>
                    <div className="semantic-particles" aria-hidden="true">
                      {PARTICLES.map((particle, index) => (
                        <span key={`${particle}-${index}`}>{particle}</span>
                      ))}
                    </div>
                    <article className="conclusion-card">
                      <div className="conclusion-card__state">
                        <span className="sr-only">{t("当前结论", "Current conclusion")}</span>
                        <span className={`confidence-dot is-${selectedChange.confidence}`} />
                        {confidenceLabel(selectedChange.confidence, lang)}
                      </div>
                      <p className="conclusion-card__entity">
                        {entityDisplayName(selectedEntity, lang)}
                      </p>
                      <h2>{pick(selectedChange.summary, lang)}</h2>
                      <div className="conclusion-card__meta">
                        <span>
                          {selectedSources.length} {t("个来源", "sources")}
                        </span>
                        <span>{selectedChange.date}</span>
                      </div>
                    </article>
                  </div>
                </section>

                <EvidenceInspector
                  entity={selectedEntity}
                  change={selectedChange}
                  sources={selectedSources}
                />
              </>
            ) : (
              <div className="radar-empty" role="status" aria-live="polite">
                <span className="radar-empty__mark" aria-hidden="true" />
                <h2>{t("没有符合条件的变化", "No changes match these filters")}</h2>
                <p>
                  {t(
                    "当前组合过于严格。清除筛选后可重新查看全部可追溯变化。",
                    "This combination is too narrow. Reset the filters to see all traceable changes.",
                  )}
                </p>
                <button type="button" onClick={resetFilters}>
                  {t("清除筛选", "Reset filters")}
                </button>
              </div>
            )}
          </section>

          <section
            id="models"
            className="model-index"
            aria-label={t("核心模型宇宙", "Core model universe")}
          >
            <div className="model-index__heading">
              <div>
                <h2>{t("模型索引", "Model index")}</h2>
                <span className="model-index__count">
                  {String(coreEntities.length).padStart(2, "0")}
                </span>
              </div>
              <Link to="/knowledge">
                {t("打开知识库", "Open knowledge base")} <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className="model-table-scroll">
              <div
                className="model-table"
                role="table"
                aria-label={t("核心模型索引", "Core model index")}
              >
                <div className="model-table__row model-table__head" role="row">
                  <span role="columnheader">{t("模型", "Model")}</span>
                  <span role="columnheader">{t("厂商", "Vendor")}</span>
                  <span role="columnheader">{t("最新变化", "Latest change")}</span>
                  <span role="columnheader">{t("更新时间", "Updated")}</span>
                  <span role="columnheader">{t("来源", "Sources")}</span>
                  <span role="columnheader">{t("主要能力", "Focus")}</span>
                  <span role="columnheader">
                    <span className="sr-only">{t("操作", "Action")}</span>
                  </span>
                </div>
                {coreEntities.map((entity) => {
                  const latest = snapshot.changes.find((change) => change.entityId === entity.id);
                  const sourceCount = latest?.sourceIds?.length ?? 0;
                  return (
                    <EntityDetailLink
                      key={entity.id}
                      entity={entity}
                      className="model-table__row"
                      role="row"
                    >
                      <span className="model-table__model" role="cell">
                        {entityDisplayName(entity, lang)}
                      </span>
                      <span role="cell">{entity.vendor || "—"}</span>
                      <span className="model-table__change" role="cell">
                        {latest ? pick(latest.summary, lang) : pick(entity.summary, lang)}
                      </span>
                      <time role="cell" dateTime={latest?.date || entity.lastUpdatedAt}>
                        {latest?.date || entity.lastUpdatedAt}
                      </time>
                      <span role="cell">{sourceCount || "—"}</span>
                      <span className="model-table__tags" role="cell">
                        {entity.tags.slice(0, 2).join(" · ")}
                      </span>
                      <span className="model-table__arrow" role="cell">
                        <ArrowRight aria-hidden="true" />
                      </span>
                    </EntityDetailLink>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="radar-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EvidenceInspector({
  entity,
  change,
  sources,
}: {
  entity: Entity;
  change: ChangeEvent;
  sources: Evidence[];
}) {
  const { t, lang } = useApp();
  return (
    <aside className="evidence-inspector">
      <div className="workspace-panel-title">
        <span>{t("证据检查器", "Evidence inspector")}</span>
        <Search aria-hidden="true" />
      </div>
      <div className="evidence-inspector__entity">
        <p>{entity.vendor || t("模型实体", "Model entity")}</p>
        <h2>{entityDisplayName(entity, lang)}</h2>
        <div className="evidence-state">
          <span className={`confidence-dot is-${change.confidence}`} />
          {confidenceLabel(change.confidence, lang)}
          <time dateTime={change.date}>{change.date}</time>
        </div>
      </div>
      <div className="evidence-conclusion">
        <p className="section-label">{t("关键结论", "Key conclusion")}</p>
        <p>{pick(change.summary, lang)}</p>
      </div>
      <div className="evidence-list">
        <div className="section-label">{t("支持证据", "Supporting evidence")}</div>
        {sources.length > 0 ? (
          sources.slice(0, 3).map((source, index) => (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="evidence-row"
            >
              <span className="evidence-row__number">{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{pick(source.title, lang)}</strong>
                <small>
                  {source.publisher} · {source.publishedAt}
                </small>
              </span>
              <ExternalLink aria-hidden="true" />
            </a>
          ))
        ) : (
          <p className="evidence-empty">
            {t(
              "当前变化未绑定可直接打开的来源。",
              "No directly linked source is available for this change.",
            )}
          </p>
        )}
      </div>
      <Link to="/ask" className="decision-action">
        <span>
          <Sparkles aria-hidden="true" /> {t("开始做选择", "Start a decision")}
        </span>
        <ArrowRight aria-hidden="true" />
      </Link>
    </aside>
  );
}

function factFragments(change: ChangeEvent, entity: Entity, lang: "zh" | "en") {
  const summary = pick(change.summary, lang);
  const parts = summary
    .split(lang === "zh" ? /[，。；]/ : /[,.;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const identity = entity.vendor
    ? lang === "zh"
      ? `${entity.vendor} 发布`
      : `Published by ${entity.vendor}`
    : lang === "zh"
      ? "实体已识别"
      : "Entity identified";
  return Array.from(new Set([identity, ...parts, ...entity.tags.slice(0, 2)])).slice(0, 5);
}

function entityDisplayName(entity: Entity, lang: "zh" | "en") {
  return entity.latestVersion || pick(entity.name, lang);
}

function confidenceLabel(confidence: ChangeEvent["confidence"], lang: "zh" | "en") {
  const labels = {
    verified: { zh: "已核验", en: "Verified" },
    inferred: { zh: "推断", en: "Inferred" },
    unverified: { zh: "待核验", en: "Unverified" },
    conflict: { zh: "有冲突", en: "Conflicting" },
  } as const;
  return labels[confidence][lang];
}

function EntityDetailLink({
  entity,
  className,
  children,
  role,
}: {
  entity: Entity;
  className: string;
  children: ReactNode;
  role?: string;
}) {
  if (entity.type === "model") {
    return (
      <Link
        to="/knowledge/model/$slug"
        params={{ slug: entity.slug }}
        className={className}
        role={role}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      to="/knowledge/$type/$slug"
      params={{ type: entity.type, slug: entity.slug }}
      className={className}
      role={role}
    >
      {children}
    </Link>
  );
}
