import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, ExternalLink, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DemoBadge, WorkspaceHeader } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import type { ChangeEvent, Entity, Evidence } from "@/domain/types";
import { browseModelFamilies } from "@/domain/model-families";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { pick, useApp } from "@/lib/app-state";
import { modelDisplayName } from "@/lib/model-display";
import { chronologicalChanges, visiblePageNumbers } from "@/domain/change-navigation";
import { changeDetailFields } from "@/domain/change-presentation";
import {
  hasLinkedChangeSource,
  matchesChangeKinds,
  toggleChangeKind,
  type ChangeKind,
} from "@/domain/change-filters";

export const Route = createFileRoute("/updates")({
  head: () => ({
    meta: [
      { title: "动态雷达 · AI Radar" },
      {
        name: "description",
        content: "追踪主流 AI 模型变化，并基于可验证证据辅助模型与产品选型。",
      },
    ],
  }),
  component: UpdatesPage,
});

function UpdatesPage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const liveSnapshot = snapshotQuery.data;
  const [timeFilter, setTimeFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<ChangeKind[]>([]);
  const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [page, setPage] = useState({ key: "", index: 0 });
  const changeFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage({ key: "", index: 0 });
  };
  const changeKindFilter = (value: string) => {
    setKindFilter((selected) => toggleChangeKind(selected, value as ChangeKind | "all"));
    setPage({ key: "", index: 0 });
  };

  if (!liveSnapshot) {
    return (
      <AppShell>
        <div className="page-container">
          <DataStatePanel
            kind={snapshotQuery.unavailableKind}
            title={
              snapshotQuery.error
                ? t("变化数据暂不可用", "Change data is unavailable")
                : t("正在加载变化数据", "Loading change data")
            }
            description={
              snapshotQuery.error
                ? t(
                    "无法获取当前数据。请检查连接后重试。",
                    "Current data could not be loaded. Check your connection and retry.",
                  )
                : t("正在连接数据服务。", "Connecting to the data service.")
            }
            onRetry={snapshotQuery.error ? () => void snapshotQuery.refetch() : undefined}
          />
        </div>
      </AppShell>
    );
  }

  const snapshot = liveSnapshot;
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const linkedSourceIds = new Set(
    snapshot.evidence.filter((source) => source.url.trim()).map((source) => source.id),
  );
  const eligibleChanges = snapshot.changes.filter((change) => {
    const entity = entityById.get(change.entityId);
    if (!entity) return false;
    if (change.date > snapshot.meta.retrievedAt.slice(0, 10)) return false;
    if (familyFilter !== "all" && (entity.familyId ?? entity.id) !== familyFilter) return false;
    if (timeFilter !== "all") {
      const cutoff = new Date(snapshot.meta.retrievedAt);
      cutoff.setUTCDate(cutoff.getUTCDate() - Number(timeFilter));
      if (change.date < cutoff.toISOString().slice(0, 10)) return false;
    }
    if (domainFilter !== "all" && (!entity.origin || pick(entity.origin, "zh") !== domainFilter))
      return false;
    if (typeFilter === "model" && entity.type !== "model") return false;
    if (typeFilter === "ecosystem" && entity.type === "model") return false;
    if (evidenceFilter === "verified" && change.confidence !== "verified") return false;
    if (evidenceFilter === "review" && change.confidence === "verified") return false;
    const hasSource = hasLinkedChangeSource(change, linkedSourceIds);
    if (sourceFilter === "linked" && !hasSource) return false;
    if (sourceFilter === "missing" && hasSource) return false;
    return true;
  });
  const kindCounts = eligibleChanges.reduce<Record<string, number>>((counts, change) => {
    counts[change.kind] = (counts[change.kind] ?? 0) + 1;
    return counts;
  }, {});
  const filteredChanges = eligibleChanges
    .filter((change) => matchesChangeKinds(change, kindFilter))
    .sort((left, right) => {
      const delta = right.date.localeCompare(left.date) || right.id.localeCompare(left.id);
      return sortOrder === "newest" ? delta : -delta;
    });
  const pageKey = [
    timeFilter,
    domainFilter,
    typeFilter,
    [...kindFilter].sort().join(","),
    evidenceFilter,
    sourceFilter,
    sortOrder,
    familyFilter,
  ].join("|");
  const pageCount = Math.ceil(filteredChanges.length / 6);
  const pageIndex = Math.min(page.key === pageKey ? page.index : 0, Math.max(0, pageCount - 1));
  const latestChanges = filteredChanges.slice(pageIndex * 6, (pageIndex + 1) * 6);
  const signalChanges = chronologicalChanges(latestChanges);
  const pageNumbers = visiblePageNumbers(pageIndex, pageCount);
  const selectedChange =
    latestChanges.find((change) => change.id === selectedId) ?? latestChanges[0];
  const selectedEntity = selectedChange ? entityById.get(selectedChange.entityId) : undefined;
  const selectedFamily = selectedEntity?.familyId
    ? entityById.get(selectedEntity.familyId)
    : undefined;
  const hasFilteredChanges = latestChanges.length > 0 && Boolean(selectedEntity);
  const selectedSources = selectedChange
    ? (selectedChange.sourceIds
        ?.map((id) => snapshot.evidence.find((source) => source.id === id))
        .filter((source): source is Evidence => Boolean(source)) ?? [])
    : [];
  const coreEntities = browseModelFamilies(snapshot.entities);
  const verifiedChangeCount = filteredChanges.filter(
    (change) => change.confidence === "verified",
  ).length;
  const linkedSourceCount = new Set(filteredChanges.flatMap((change) => change.sourceIds ?? []))
    .size;
  const advancedFilterCount =
    [domainFilter !== "all", sourceFilter !== "all", sortOrder !== "newest"].filter(Boolean)
      .length + kindFilter.length;
  const hasAnyFilter =
    timeFilter !== "all" ||
    typeFilter !== "all" ||
    evidenceFilter !== "all" ||
    familyFilter !== "all" ||
    advancedFilterCount > 0;
  const resetFilters = () => {
    setTimeFilter("all");
    setDomainFilter("all");
    setTypeFilter("all");
    setKindFilter([]);
    setEvidenceFilter("all");
    setSourceFilter("all");
    setSortOrder("newest");
    setFamilyFilter("all");
    setPage({ key: "", index: 0 });
  };

  return (
    <AppShell>
      <div className="updates-page workspace-page">
        <WorkspaceHeader
          title={t("动态", "Updates")}
          description={t(
            "追踪模型的发布、能力、价格与可用性变化，查看影响和证据。",
            "Track model releases, capabilities, prices and access with impact and evidence.",
          )}
          actions={
            <DemoBadge
              mode={snapshot.meta.mode}
              updatedAt={snapshot.meta.retrievedAt}
              cachedAt={snapshot.meta.cachedAt}
            />
          }
        />
        <section className="updates-filters" aria-label={t("动态筛选", "Update filters")}>
          <div className="updates-container updates-filter-panel">
            <div className="updates-filters__inner">
              <div className="updates-filter-groups">
                <FilterGroup
                  label={t("时间", "Time")}
                  value={timeFilter}
                  onChange={changeFilter(setTimeFilter)}
                  options={[
                    { value: "all", label: t("全部时间", "All time") },
                    { value: "30", label: t("近 30 天", "30 days") },
                    { value: "90", label: t("最近 90 天", "Last 90 days") },
                  ]}
                />
                <FilterSelect
                  label={t("对象", "Object")}
                  value={typeFilter}
                  onChange={changeFilter(setTypeFilter)}
                  description={t(
                    "其他对象包括应用、Agent、工具、框架、评测、论文、数据集与组织。",
                    "Other objects include apps, agents, tools, frameworks, evaluations, papers, datasets and organizations.",
                  )}
                  options={[
                    { value: "all", label: t("全部对象", "All objects") },
                    { value: "model", label: t("模型（含版本）", "Models & versions") },
                    { value: "ecosystem", label: t("其他对象", "Other objects") },
                  ]}
                />
                <FilterSelect
                  label={t("核验状态", "Verification")}
                  value={evidenceFilter}
                  onChange={changeFilter(setEvidenceFilter)}
                  description={t(
                    "结论的核验状态；其他状态包含未核验、推断与冲突，有来源链接不代表已经核验。",
                    "Verification of the conclusion; other statuses include unverified, inferred and conflicting. A source link does not imply verification.",
                  )}
                  options={[
                    { value: "all", label: t("全部状态", "All statuses") },
                    { value: "verified", label: t("已核验", "Verified") },
                    { value: "review", label: t("其他状态", "Other statuses") },
                  ]}
                />
                <label className="updates-family-filter">
                  {t("模型家族", "Model family")}
                  <select
                    value={familyFilter}
                    onChange={(event) => changeFilter(setFamilyFilter)(event.target.value)}
                  >
                    <option value="all">{t("全部家族", "All families")}</option>
                    {coreEntities.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {modelDisplayName(entity, lang)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="updates-filter-actions">
                {hasAnyFilter && (
                  <button type="button" className="updates-filter-reset" onClick={resetFilters}>
                    {t("清除筛选", "Clear filters")}
                  </button>
                )}
                <button
                  type="button"
                  className={`updates-more-toggle${advancedOpen ? " is-active" : ""}`}
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((current) => !current)}
                >
                  <SlidersHorizontal aria-hidden="true" />
                  {t("更多筛选", "More filters")}
                  {advancedFilterCount > 0 && <span>{advancedFilterCount}</span>}
                  <ChevronDown aria-hidden="true" />
                </button>
              </div>
            </div>
            {advancedOpen && (
              <div className="updates-filter-more">
                <div className="updates-filter-short-row">
                  <FilterGroup
                    label={t("地区", "Region")}
                    value={domainFilter}
                    onChange={changeFilter(setDomainFilter)}
                    options={[
                      { value: "all", label: t("全部", "All") },
                      { value: "国内", label: t("国内", "Domestic") },
                      { value: "海外", label: t("海外", "Overseas") },
                    ]}
                  />
                  <FilterGroup
                    label={t("来源链接", "Source links")}
                    value={sourceFilter}
                    onChange={changeFilter(setSourceFilter)}
                    options={[
                      { value: "all", label: t("不限", "Any") },
                      { value: "linked", label: t("有链接", "Linked") },
                      { value: "missing", label: t("无链接", "Unlinked") },
                    ]}
                  />
                  <FilterGroup
                    label={t("排序", "Sort")}
                    value={sortOrder}
                    onChange={changeFilter(setSortOrder)}
                    options={[
                      { value: "newest", label: t("最新优先", "Newest") },
                      { value: "oldest", label: t("最早优先", "Oldest") },
                    ]}
                  />
                </div>
                <FilterGroup
                  label={t("变化", "Change")}
                  hint={t("可多选", "Multi-select")}
                  wide
                  value={kindFilter}
                  onChange={changeKindFilter}
                  options={[
                    { value: "all", label: t("全部", "All") },
                    { value: "new", label: t("新发布", "New") },
                    { value: "updated", label: t("能力更新", "Updated") },
                    { value: "pricing", label: t("价格与额度", "Pricing & limits") },
                    { value: "availability", label: t("开放与访问", "Access") },
                    { value: "deprecated", label: t("弃用与下线", "Deprecations") },
                    { value: "benchmark", label: t("基准变化", "Benchmark") },
                    { value: "rumor", label: t("传闻", "Rumor") },
                  ]
                    .filter(
                      (option) =>
                        option.value !== "rumor" ||
                        (kindCounts.rumor ?? 0) > 0 ||
                        kindFilter.includes("rumor"),
                    )
                    .map((option) => ({
                      ...option,
                      count:
                        option.value === "all"
                          ? eligibleChanges.length
                          : (kindCounts[option.value] ?? 0),
                    }))}
                />
              </div>
            )}
            <details className="updates-filter-help">
              <summary>{t("筛选说明", "About these filters")}</summary>
              <dl>
                <div>
                  <dt>{t("核验状态", "Verification")}</dt>
                  <dd>{t("结论是否经过审核。", "Whether the conclusion has been reviewed.")}</dd>
                </div>
                <div>
                  <dt>{t("来源链接", "Source links")}</dt>
                  <dd>
                    {t(
                      "能否打开关联原文；有链接不等于已核验。",
                      "Linked original material does not itself imply verification.",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("对象", "Objects")}</dt>
                  <dd>
                    {t(
                      "模型含具体版本；其他对象含应用、开发材料、评测及组织。",
                      "Models include versions; other objects include apps, development resources, evaluations and organizations.",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("变化多选", "Multiple kinds")}</dt>
                  <dd>
                    {t(
                      "匹配任一选中类型；“全部”取消类型限制。",
                      "Matches any selected kind; All removes the restriction.",
                    )}
                  </dd>
                </div>
              </dl>
              <p>
                {t(
                  "传闻暂不作为公开收录方向，空标签隐藏。仅关注可能影响选型的发布、价格、访问或下线线索；来源与时间明确后进入待审核，确认前不计入已核验事实。",
                  "Rumors are not a public collection priority; empty labels are hidden. Material release, pricing, access or retirement leads require attributable sources and dates, and remain pending until confirmed.",
                )}
              </p>
            </details>
          </div>
        </section>

        <div className="updates-container updates-content">
          <p className="updates-coverage-note">
            {t(
              `累计收录 ${snapshot.changes.length} 条变化，其中 ${snapshot.changes.filter((change) => change.kind !== "new").length} 条非发布事件。标签数量随筛选变化；尚未收录的事件不计入。`,
              `${snapshot.changes.length} recorded changes, including ${snapshot.changes.filter((change) => change.kind !== "new").length} non-release events. Label counts follow the filters; unrecorded events are not counted.`,
            )}
          </p>
          {hasFilteredChanges && (
            <section className="updates-signal" aria-labelledby="updates-signal-title">
              <div className="updates-signal__intro">
                <div>
                  <h2 id="updates-signal-title">{t("变化脉冲", "Change pulse")}</h2>
                  <p>
                    {t(
                      "把近期模型变化按时间排开，选择节点即可查看证据。",
                      "Recent model changes, ordered by time. Select a node to inspect its evidence.",
                    )}
                  </p>
                  <p>
                    {t(
                      "按事件发生日期排序；资料核验日期单独标注。",
                      "Ordered by event date; verification dates are shown separately.",
                    )}
                  </p>
                </div>
                <div
                  className="updates-signal__summary"
                  aria-label={t("当前视图摘要", "View summary")}
                >
                  <span>
                    <b>{filteredChanges.length}</b> {t("条变化", "changes")}
                  </span>
                  <span>
                    <b>{verifiedChangeCount}</b> {t("条已核验", "verified")}
                  </span>
                  <span>
                    <b>{linkedSourceCount}</b> {t("个关联来源", "linked sources")}
                  </span>
                </div>
              </div>

              <div
                className="updates-signal__track"
                role="group"
                aria-label={t("时间节点", "Timeline events")}
              >
                {signalChanges.map((change, index) => {
                  const entity = entityById.get(change.entityId);
                  if (!entity) return null;
                  const active = change.id === selectedChange?.id;
                  return (
                    <button
                      key={change.id}
                      type="button"
                      aria-label={`${change.date} · ${pick(change.summary, lang)} · ${changeKindLabel(change.kind, lang)}`}
                      className={`updates-signal__node${active ? " is-active" : ""}`}
                      style={{ "--signal-order": index } as CSSProperties}
                      onClick={() => setSelectedId(change.id)}
                      aria-pressed={active}
                    >
                      <span
                        className={`updates-signal__dot is-${entityById.get(entity.familyId ?? entity.id)?.slug}`}
                        aria-hidden="true"
                      />
                      <time dateTime={change.date}>{change.date}</time>
                      <strong>{modelDisplayName(entity, lang)}</strong>
                      <small>{changeKindLabel(change.kind, lang)}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section id="latest" aria-label={t("变化追踪", "Change tracking")}>
            {hasFilteredChanges && selectedChange && selectedEntity ? (
              <div className="updates-layout">
                <aside className="updates-change-list" aria-label={t("变化列表", "Change list")}>
                  {latestChanges.map((change) => {
                    const entity = entityById.get(change.entityId);
                    if (!entity) return null;
                    const active = change.id === selectedChange.id;
                    const sourceCount = change.sourceIds?.length ?? 0;
                    return (
                      <button
                        key={change.id}
                        type="button"
                        className={`updates-change-card${active ? " is-active" : ""}`}
                        onClick={() => setSelectedId(change.id)}
                        aria-pressed={active}
                      >
                        <span className="updates-change-card__topline">
                          <span className={`updates-kind is-${change.kind}`}>
                            {changeKindLabel(change.kind, lang)}
                          </span>
                          <time dateTime={change.date}>{change.date}</time>
                        </span>
                        <strong>{pick(change.summary, lang)}</strong>
                        <span className="updates-change-card__meta">
                          <span className={`updates-confidence is-${change.confidence}`}>
                            <Check aria-hidden="true" /> {confidenceLabel(change.confidence, lang)}
                          </span>
                          <span>
                            {sourceCount} {t("个来源", "sources")}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </aside>

                <article className="updates-detail" aria-live="polite">
                  <header className="updates-detail__header">
                    <div>
                      <div className="updates-detail__status">
                        <span className={`updates-confidence is-${selectedChange.confidence}`}>
                          <Check aria-hidden="true" />
                          {confidenceLabel(selectedChange.confidence, lang)}
                        </span>
                        <time dateTime={selectedChange.date}>
                          {changeKindLabel(selectedChange.kind, lang)} · {selectedChange.date}
                        </time>
                      </div>
                      <h2>{pick(selectedChange.summary, lang)}</h2>
                      <div className="updates-detail__entity">
                        <span
                          className={`updates-model-dot is-${selectedFamily?.slug ?? selectedEntity.slug}`}
                        />
                        <EntityDetailLink
                          entity={selectedEntity}
                          className="updates-detail__entity-link"
                        >
                          {modelDisplayName(selectedEntity, lang)}
                        </EntityDetailLink>
                        <span>·</span>
                        <span>{selectedEntity.vendor || "AI Radar"}</span>
                        {selectedEntity.origin && (
                          <>
                            <span>·</span>
                            <span>{pick(selectedEntity.origin, lang)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </header>

                  <p className="updates-detail__summary">
                    {pick(
                      selectedChange.detail?.description ??
                        (selectedChange.kind === "new" && selectedEntity.release
                          ? selectedEntity.summary
                          : selectedChange.summary),
                      lang,
                    )}
                  </p>
                  {selectedChange.detail && (
                    <dl className="updates-change-detail">
                      {changeDetailFields(selectedChange, lang).map(({ label, value }) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{pick(value, lang)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {selectedFamily && (
                    <EntityDetailLink
                      entity={selectedFamily}
                      className="updates-detail__entity-link"
                    >
                      {t("查看家族演进", "Explore family history")} ·{" "}
                      {modelDisplayName(selectedFamily, lang)}
                    </EntityDetailLink>
                  )}

                  <section className="updates-evidence">
                    <h2>
                      {t("证据来源", "Evidence sources")} ({selectedSources.length})
                    </h2>
                    <div>
                      {selectedSources.length > 0 ? (
                        selectedSources.map((source) => (
                          <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                            <span>
                              <strong>{pick(source.title, lang)}</strong>
                              <small>
                                {source.publisher}
                                {source.publishedAt && (
                                  <>
                                    {" "}
                                    · {t("来源发布", "Published")} {source.publishedAt}
                                  </>
                                )}
                                {source.verifiedAt && (
                                  <>
                                    {" "}
                                    · {t("核验", "Verified")} {source.verifiedAt.slice(0, 10)}
                                  </>
                                )}
                              </small>
                            </span>
                            <ExternalLink aria-hidden="true" />
                          </a>
                        ))
                      ) : (
                        <p>
                          {t(
                            "当前变化没有绑定可直接打开的来源。",
                            "No linked source is available.",
                          )}
                        </p>
                      )}
                    </div>
                  </section>

                  <footer className="updates-detail__actions">
                    <EntityDetailLink entity={selectedEntity} className="updates-detail__secondary">
                      {selectedEntity.release
                        ? t("查看版本档案", "Open version record")
                        : t("查看对象档案", "Open record")}{" "}
                      <ArrowRight aria-hidden="true" />
                    </EntityDetailLink>
                    <Link to="/ask" className="updates-detail__primary">
                      {t("带入决策助手", "Use in decision assistant")}{" "}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </footer>
                </article>
              </div>
            ) : (
              <div className="updates-empty" role="status" aria-live="polite">
                <h2>{t("没有符合条件的变化", "No changes match these filters")}</h2>
                <p>
                  {t(
                    kindFilter.length === 1 && kindFilter.includes("rumor")
                      ? "当前没有达到收录条件的传闻。已核验的官方变化不会被改标为传闻。"
                      : "当前筛选组合没有已收录事件；数量不代表该厂商完整的历史事件总量。",
                    kindFilter.length === 1 && kindFilter.includes("rumor")
                      ? "No rumors currently meet inclusion criteria. Verified official changes are not relabeled as rumors."
                      : "No recorded events match these filters; counts are not the vendor's complete historical total.",
                  )}
                </p>
                <button type="button" onClick={resetFilters}>
                  {t("清除筛选", "Reset filters")}
                </button>
              </div>
            )}
          </section>

          {hasFilteredChanges && (
            <nav className="updates-pagination" aria-label={t("动态分页", "Change pagination")}>
              <span>
                {t(
                  `第 ${pageIndex * 6 + 1}–${Math.min((pageIndex + 1) * 6, filteredChanges.length)} 条，共 ${filteredChanges.length} 条`,
                  `${pageIndex * 6 + 1}–${Math.min((pageIndex + 1) * 6, filteredChanges.length)} of ${filteredChanges.length}`,
                )}
              </span>
              <div className="updates-pagination__controls">
                <button
                  type="button"
                  disabled={pageIndex === 0}
                  onClick={() => setPage({ key: pageKey, index: 0 })}
                >
                  {t("首页", "First")}
                </button>
                <button
                  type="button"
                  disabled={pageIndex === 0}
                  onClick={() => setPage({ key: pageKey, index: pageIndex - 1 })}
                >
                  {t("上一页", "Previous")}
                </button>
                <div className="updates-pagination__numbers">
                  {pageNumbers[0] > 0 && <span aria-hidden="true">…</span>}
                  {pageNumbers.map((index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={t(`第 ${index + 1} 页`, `Page ${index + 1}`)}
                      aria-current={pageIndex === index ? "page" : undefined}
                      onClick={() => setPage({ key: pageKey, index })}
                    >
                      {index + 1}
                    </button>
                  ))}
                  {pageNumbers.at(-1)! < pageCount - 1 && <span aria-hidden="true">…</span>}
                </div>
                <button
                  type="button"
                  disabled={pageIndex + 1 >= pageCount}
                  onClick={() => setPage({ key: pageKey, index: pageIndex + 1 })}
                >
                  {t("下一页", "Next")}
                </button>
                <button
                  type="button"
                  disabled={pageIndex + 1 >= pageCount}
                  onClick={() => setPage({ key: pageKey, index: pageCount - 1 })}
                >
                  {t("末页", "Last")}
                </button>
              </div>
            </nav>
          )}

          <section className="updates-models" aria-labelledby="updates-models-title">
            <div className="updates-models__heading">
              <h2 id="updates-models-title">{t("模型家族", "Model families")}</h2>
              <Link to="/knowledge">
                {t("查看全部", "View all")} <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className="updates-models__grid">
              {coreEntities.map((entity) => (
                <EntityDetailLink key={entity.id} entity={entity} className="updates-model-card">
                  <span className={`updates-model-card__mark is-${entity.slug}`}>
                    {modelInitial(entity.slug)}
                  </span>
                  <strong>{modelDisplayName(entity, lang)}</strong>
                  <small>{entity.vendor || "AI Radar"}</small>
                </EntityDetailLink>
              ))}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
  wide = false,
  hint,
}: {
  label: string;
  value: string | ChangeKind[];
  options: Array<{ value: string; label: string; count?: number }>;
  onChange: (value: string) => void;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`updates-filter-group${wide ? " is-wide" : ""}`}
      role="group"
      aria-label={label}
    >
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {options.map((option) => {
        const active = Array.isArray(value)
          ? option.value === "all"
            ? value.length === 0
            : value.includes(option.value as ChangeKind)
          : value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={active ? "is-active" : ""}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {active && (
              <span className="updates-filter-choice-icon" aria-hidden="true">
                <Check />
              </span>
            )}
            {option.label}
            {option.count !== undefined && (
              <span className="updates-filter-count">({option.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FilterSelect({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="updates-filter-select" title={description}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
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

function changeKindLabel(kind: ChangeEvent["kind"], lang: "zh" | "en") {
  const labels = {
    new: { zh: "新发布", en: "Release" },
    updated: { zh: "能力更新", en: "Update" },
    pricing: { zh: "价格与额度", en: "Pricing & limits" },
    availability: { zh: "开放与访问", en: "Access" },
    deprecated: { zh: "弃用与下线", en: "Deprecation" },
    benchmark: { zh: "基准变化", en: "Benchmark" },
    rumor: { zh: "传闻", en: "Rumor" },
  };
  return labels[kind][lang];
}

function modelInitial(slug: string) {
  const labels: Record<string, string> = {
    gpt: "G",
    claude: "C",
    gemini: "G",
    deepseek: "D",
    qwen: "Q",
    kimi: "K",
    doubao: "豆",
    ernie: "文",
  };
  return labels[slug] ?? slug.slice(0, 1).toUpperCase();
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
