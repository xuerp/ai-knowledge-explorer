import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceHeader, DemoBadge, ConfidenceChip } from "@/components/common";
import type { Entity } from "@/domain/types";
import { modelSpecChinese } from "@/domain/model-spec";
import { useApp, pick } from "@/lib/app-state";
import { modelDisplayName } from "@/lib/model-display";
import {
  useKnowledgeSnapshot,
  useModelCatalog,
  useModelVersionComparison,
} from "@/hooks/use-knowledge";
import { knowledgeRepository } from "@/services/knowledge-repository";
import {
  defaultComparableVersionIds,
  resolveComparisonSelection,
  type ComparisonScope,
} from "@/lib/comparison-selection";
import {
  COMPARISON_LIMIT,
  comparisonVersionGroups,
  filterComparisonGroups,
  toggleComparisonModel,
} from "@/lib/comparison-picker";

export const Route = createFileRoute("/compare")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { models: string | undefined; research?: string } => ({
    models: typeof search.models === "string" ? search.models : undefined,
    research:
      typeof search.research === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(search.research)
        ? search.research
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "模型对比 · AI Radar" },
      {
        name: "description",
        content: "按模型系列选择具体版本，在一致维度下比较能力、价格与接入条件。",
      },
      { property: "og:title", content: "AI Radar · 模型对比" },
      { property: "og:description", content: "比较具体模型版本或模型系列，查看规格和来源。" },
    ],
  }),
  component: ComparePage,
});

function ComparePage() {
  const { t, lang } = useApp();
  const { models: modelSearch, research: researchId } = Route.useSearch();
  const catalogQuery = useModelCatalog();
  const snapshotQuery = useKnowledgeSnapshot();
  const initialModels = catalogQuery.data ?? [];
  const initial = modelSearch
    ? resolveComparisonSelection(modelSearch, initialModels)
    : { scope: "versions" as const, selected: defaultComparableVersionIds(initialModels) };
  const [scope, setScope] = useState<ComparisonScope>(initial.scope);
  const [selections, setSelections] = useState<Record<ComparisonScope, string[]>>({
    versions:
      initial.scope === "versions" ? initial.selected : defaultComparableVersionIds(initialModels),
    families: initial.scope === "families" ? initial.selected : ["e-gpt", "e-claude", "e-gemini"],
  });
  const [familyId, setFamilyId] = useState(
    initialModels.find((model) => model.id === initial.selected[0])?.familyId ?? "e-gpt",
  );
  const [lineId, setLineId] = useState("");
  const [query, setQuery] = useState("");
  const [includeHistory, setIncludeHistory] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);
  const resolvedSearch = useRef<string | null>(null);
  useEffect(() => {
    if (!catalogQuery.data || resolvedSearch.current === (modelSearch ?? "")) return;
    resolvedSearch.current = modelSearch ?? "";
    const resolved = modelSearch
      ? resolveComparisonSelection(modelSearch, catalogQuery.data)
      : { scope: "versions" as const, selected: defaultComparableVersionIds(catalogQuery.data) };
    setScope(resolved.scope);
    setSelections((previous) => ({ ...previous, [resolved.scope]: resolved.selected }));
    const first = catalogQuery.data.find((model) => model.id === resolved.selected[0]);
    if (first) setFamilyId(first.familyId ?? first.id);
    setLineId("");
    setQuery("");
  }, [catalogQuery.data, modelSearch]);
  // API mode never silently substitutes sample model facts when the catalog fails.
  const allModels = catalogQuery.data ?? [];
  const families = allModels.filter((model) => model.type === "model" && !model.familyId);
  const catalogReady = Boolean(catalogQuery.data);
  const activeFamilyId = families.some((model) => model.id === familyId)
    ? familyId
    : (families[0]?.id ?? "");
  const selected = selections[scope];
  const comparisonQuery = useModelVersionComparison(
    scope === "versions" && catalogReady ? selected : [],
  );
  const modelById = new Map(allModels.map((model) => [model.id, model]));
  if (scope === "versions")
    comparisonQuery.data?.forEach((model) => modelById.set(model.id, model));
  const chosen = selected.flatMap((id) => {
    const model = modelById.get(id);
    return model ? [model] : [];
  });
  const groups = comparisonVersionGroups(allModels, activeFamilyId);
  const visibleGroups = filterComparisonGroups(groups, { lineId, query, includeHistory });
  const visibleCount = visibleGroups.reduce((count, group) => count + group.versions.length, 0);
  const atLimit = selected.length >= COMPARISON_LIMIT;
  const toggle = (id: string) =>
    setSelections((previous) => ({
      ...previous,
      [scope]: toggleComparisonModel(previous[scope], id),
    }));
  const clear = () => setSelections((previous) => ({ ...previous, [scope]: [] }));
  const spec = (value?: string) =>
    value ? (lang === "zh" ? modelSpecChinese(value) : value) : t("待核实", "Not verified");
  const stage = (model: Entity) =>
    ({
      stable: t("正式版", "Stable"),
      preview: t("预览版", "Preview"),
      deprecated: t("已弃用", "Deprecated"),
      retired: t("已退役", "Retired"),
      pending: t("待核实", "Not verified"),
    })[model.release?.stage ?? "pending"];
  const choice = (model: Entity, current?: boolean) => {
    const checked = selected.includes(model.id);
    return (
      <button
        key={model.id}
        type="button"
        className={`compare-choice${checked ? " is-selected" : ""}`}
        aria-pressed={checked}
        disabled={!checked && atLimit}
        onClick={() => toggle(model.id)}
      >
        <span className="compare-choice__check" aria-hidden="true">
          {checked && <Check />}
        </span>
        <span className="compare-choice__text">
          <strong>{modelDisplayName(model, lang)}</strong>
          <span>
            {scope === "versions"
              ? (model.release?.apiModelIds[0] ??
                model.release?.releaseId ??
                t("暂无 API 标识", "No API ID"))
              : model.vendor}
          </span>
        </span>
        {scope === "versions" && (
          <span className="compare-choice__status">
            {current === false ? t("历史", "Historical") : stage(model)}
          </span>
        )}
      </button>
    );
  };

  return (
    <AppShell>
      <div className="compare-page workspace-page" lang={lang === "zh" ? "zh-CN" : "en"}>
        <div className="compare-page__container">
          <WorkspaceHeader
            title={t("模型对比", "Compare models")}
            description={t(
              "先选模型系列，再挑具体版本，比较能力、价格与接入条件。",
              "Choose a family, then a release to compare capabilities, pricing and access.",
            )}
            actions={
              <DemoBadge
                mode={snapshotQuery.data?.meta.mode ?? knowledgeRepository.mode}
                updatedAt={snapshotQuery.data?.meta.retrievedAt}
                cachedAt={snapshotQuery.data?.meta.cachedAt}
              />
            }
          />
          {researchId && (
            <div className="compare-notice">
              <Link
                to="/research/$id"
                params={{ id: researchId }}
                className="text-signal hover:underline"
              >
                {t(
                  "返回本次私人决策与验证计划",
                  "Return to this private decision and validation plan",
                )}
              </Link>
              {" · "}
              <Link to="/ask" className="text-signal hover:underline">
                {t("返回决策条件", "Return to decision inputs")}
              </Link>
            </div>
          )}
          {!catalogQuery.data && knowledgeRepository.mode !== "demo" && (
            <div className="compare-notice" role="status">
              <span>
                {catalogQuery.error
                  ? t(
                      "模型目录加载失败，请重试。",
                      "The model catalog could not be loaded. Please retry.",
                    )
                  : t("正在加载模型目录…", "Loading the model catalog…")}
              </span>
              {catalogQuery.error && (
                <button type="button" onClick={() => void catalogQuery.refetch()}>
                  {t("重新加载", "Retry")}
                </button>
              )}
            </div>
          )}
          <section className="compare-picker" aria-labelledby="compare-picker-title">
            <div className="compare-section-heading">
              <h2 id="compare-picker-title">{t("选择对比对象", "Choose models")}</h2>
              <div className="compare-scope" aria-label={t("对比范围", "Comparison scope")}>
                {(["versions", "families"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={scope === item}
                    onClick={() => setScope(item)}
                  >
                    {item === "versions" ? t("具体版本", "Releases") : t("模型系列", "Families")}
                  </button>
                ))}
              </div>
            </div>
            <div className="compare-selected">
              <div className="compare-selected__label">
                {t("已选", "Selected")}{" "}
                <span>
                  {selected.length} / {COMPARISON_LIMIT}
                </span>
              </div>
              <div className="compare-selected__items">
                {chosen.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className="compare-selected__item"
                    onClick={() => toggle(model.id)}
                    aria-label={t(
                      `移除 ${modelDisplayName(model, lang)}`,
                      `Remove ${modelDisplayName(model, lang)}`,
                    )}
                  >
                    {modelDisplayName(model, lang)}
                    <X aria-hidden="true" />
                  </button>
                ))}
                {!selected.length && (
                  <span className="compare-selected__empty">
                    {t("从下方添加，最多 4 个", "Add up to 4 models below")}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="compare-text-button"
                disabled={!selected.length}
                onClick={clear}
              >
                {t("清空", "Clear")}
              </button>
            </div>
            <div className="compare-picker__toolbar">
              <p role="status">
                {atLimit
                  ? t(
                      "已选满 4 个，移除一个后可继续添加。",
                      "4 selected. Remove one to add another.",
                    )
                  : scope === "versions"
                    ? t(
                        "切换系列不会清除已选版本。",
                        "Switching families keeps your selected releases.",
                      )
                    : t(
                        "系列用于了解整体定位；价格和规格请比较具体版本。",
                        "Families show positioning; compare releases for prices and specifications.",
                      )}
              </p>
              <button
                className="compare-text-button"
                type="button"
                aria-expanded={pickerOpen}
                aria-controls="compare-options"
                onClick={() => setPickerOpen((value) => !value)}
              >
                {pickerOpen ? t("收起选择", "Hide choices") : t("添加对象", "Add models")}
                {pickerOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
            </div>
            {pickerOpen && catalogReady && (
              <div id="compare-options" className="compare-options">
                {scope === "versions" ? (
                  <>
                    <div className="compare-filters">
                      <label className="compare-field">
                        <span>{t("模型系列", "Model family")}</span>
                        <select
                          value={activeFamilyId}
                          onChange={(event) => {
                            setFamilyId(event.target.value);
                            setLineId("");
                            setQuery("");
                          }}
                        >
                          <option value="" disabled>
                            {t("选择系列", "Choose a family")}
                          </option>
                          {families.map((family) => (
                            <option key={family.id} value={family.id}>
                              {modelDisplayName(family, lang)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compare-field">
                        <span>{t("产品线", "Product line")}</span>
                        <select value={lineId} onChange={(event) => setLineId(event.target.value)}>
                          <option value="">{t("全部产品线", "All product lines")}</option>
                          {groups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {pick(group.name, lang)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compare-field compare-field--search">
                        <span>{t("搜索版本", "Find a release")}</span>
                        <span className="compare-search">
                          <Search aria-hidden="true" />
                          <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t("名称或 API 标识", "Name or API ID")}
                          />
                          {query && (
                            <button
                              type="button"
                              aria-label={t("清除搜索", "Clear search")}
                              onClick={() => setQuery("")}
                            >
                              <X aria-hidden="true" />
                            </button>
                          )}
                        </span>
                      </label>
                    </div>
                    <div className="compare-options__summary">
                      <span>
                        {t(
                          `本系列 ${visibleCount} 个可选版本`,
                          `${visibleCount} releases in this family`,
                        )}
                      </span>
                      <label className="compare-history">
                        <input
                          type="checkbox"
                          checked={includeHistory}
                          onChange={(event) => setIncludeHistory(event.target.checked)}
                        />
                        {t("包含历史版本", "Include historical releases")}
                      </label>
                    </div>
                    <div
                      className="compare-options__list"
                      tabIndex={0}
                      aria-label={t("可选模型版本", "Available releases")}
                    >
                      <div className="compare-choices">
                        {visibleGroups.flatMap((group) =>
                          group.versions.map(({ model, current }) => choice(model, current)),
                        )}
                      </div>
                      {!visibleCount && (
                        <div className="compare-empty">
                          <p>{t("本系列没有匹配的版本", "No matching releases in this family")}</p>
                          <span>
                            {t(
                              "可调整产品线、搜索词，或包含历史版本。",
                              "Try another product line, search term, or include historical releases.",
                            )}
                          </span>
                          <button
                            type="button"
                            className="compare-text-button"
                            onClick={() => {
                              setQuery("");
                              setLineId("");
                              setIncludeHistory(true);
                            }}
                          >
                            {t("查看本系列全部版本", "Show all releases in this family")}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div
                    className="compare-options__list compare-options__list--families"
                    tabIndex={0}
                    aria-label={t("可选模型系列", "Available families")}
                  >
                    <div className="compare-choices">{families.map((model) => choice(model))}</div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="compare-results" aria-labelledby="compare-results-title">
            <div className="compare-section-heading">
              <div>
                <h2 id="compare-results-title">{t("对比结果", "Comparison")}</h2>
                <p>
                  {chosen.length < 2
                    ? t("添加至少 2 个对象开始对比。", "Add at least 2 models to compare.")
                    : t(
                        `${chosen.length} 个${scope === "versions" ? "版本" : "系列"} · 按相同维度展示`,
                        `${chosen.length} ${scope === "versions" ? "releases" : "families"} · consistent comparison dimensions`,
                      )}
                </p>
              </div>
              {chosen.length >= 2 && (
                <Link
                  to="/compare"
                  search={{ models: selected.join(","), research: researchId }}
                  className="compare-text-button"
                >
                  {t("固定当前对比链接", "Link to this comparison")}
                </Link>
              )}
            </div>
            {comparisonQuery.error && scope === "versions" && catalogReady && chosen.length > 0 && (
              <div className="compare-notice" role="status">
                {t(
                  "对比接口暂时不可用，以下展示已加载的目录规格。",
                  "Comparison service unavailable. Showing specifications from the loaded catalog.",
                )}
                <button type="button" onClick={() => void comparisonQuery.refetch()}>
                  {t("重试", "Retry")}
                </button>
              </div>
            )}
            {!catalogReady ? (
              <div className="compare-empty compare-empty--results" role="status">
                <p>
                  {catalogQuery.error
                    ? t("目录暂不可用", "Catalog unavailable")
                    : t("正在加载对比数据…", "Loading comparison data…")}
                </p>
                <span>
                  {t(
                    "目录连接后展示所选对象的规格。",
                    "Specifications appear when the catalog connects.",
                  )}
                </span>
              </div>
            ) : chosen.length > 0 ? (
              <>
                <p className="compare-scroll-hint">
                  {t("左右滑动查看全部对象", "Scroll horizontally to view all models")}
                </p>
                <div
                  className="compare-table-scroll"
                  tabIndex={0}
                  aria-label={t(
                    "模型规格对比表，可横向滚动",
                    "Model comparison table, scroll horizontally",
                  )}
                >
                  <table
                    className="compare-table"
                    style={{ minWidth: `${160 + chosen.length * 240}px` }}
                  >
                    <caption className="sr-only">
                      {scope === "versions"
                        ? t(
                            "具体模型版本的能力、价格与接入条件",
                            "Capabilities, pricing and access for model releases",
                          )
                        : t("模型系列定位与能力对比", "Model family positioning and capabilities")}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("对比维度", "Dimension")}</th>
                        {chosen.map((model) => (
                          <th key={model.id} scope="col">
                            <Link to="/knowledge/model/$slug" params={{ slug: model.slug }}>
                              {modelDisplayName(model, lang)}
                            </Link>
                            <span>{model.vendor}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <TableGroup title={t("基本信息", "Overview")} columns={chosen.length + 1} />
                      <Row
                        label={t("定位", "Positioning")}
                        values={chosen.map((model) => pick(model.summary, lang))}
                      />
                      {scope === "versions" && (
                        <>
                          <Row
                            label={t("版本标识", "Version ID")}
                            values={chosen.map(
                              (model) => model.release?.releaseId ?? model.latestVersion ?? "—",
                            )}
                            mono
                          />
                          <Row label={t("发布阶段", "Release stage")} values={chosen.map(stage)} />
                          <Row
                            label={t("发布时间", "Released")}
                            values={chosen.map(
                              (model) =>
                                model.release?.releasedAt ??
                                model.firstReleasedAt ??
                                t("待核实", "Not verified"),
                            )}
                            mono
                          />
                        </>
                      )}
                      <TableGroup
                        title={t("能力与接入", "Capabilities & access")}
                        columns={chosen.length + 1}
                      />
                      {scope === "versions" && (
                        <Row
                          label={t("上下文 / 输出", "Context / output")}
                          values={chosen.map((model) => spec(model.specs?.contextWindow))}
                        />
                      )}
                      <Row
                        label={t("输入模态", "Input modalities")}
                        values={chosen.map((model) =>
                          model.specs?.modalities
                            ? spec(model.specs.modalities)
                            : model.tags.join(" · "),
                        )}
                      />
                      <Row
                        label={t("工具与 Agent", "Tools & agents")}
                        values={chosen.map((model) =>
                          model.specs?.toolUse
                            ? spec(model.specs.toolUse)
                            : scope === "families"
                              ? t("以具体版本支持为准", "Depends on the release")
                              : t("待核实", "Not verified"),
                        )}
                      />
                      <Row
                        label={t("可用范围", "Availability")}
                        values={chosen.map((model) =>
                          model.specs?.availability
                            ? spec(model.specs.availability)
                            : scope === "families"
                              ? t("查看具体版本的接入渠道", "See release access channels")
                              : t("待核实", "Not verified"),
                        )}
                      />
                      <tr>
                        <th scope="row">{t("能力要点", "Capability notes")}</th>
                        {chosen.map((model) => (
                          <td key={model.id}>
                            {Boolean(model.capabilities?.length) && (
                              <details className="compare-capability-details">
                                <summary>
                                  {t(
                                    `查看 ${Math.min(model.capabilities?.length ?? 0, 4)} 条说明`,
                                    `View ${Math.min(model.capabilities?.length ?? 0, 4)} notes`,
                                  )}
                                </summary>
                                <ul className="compare-capabilities">
                                  {(model.capabilities ?? [])
                                    .slice(0, 4)
                                    .map((capability, index) => (
                                      <li key={index}>
                                        <ConfidenceChip level={capability.confidence} />
                                        <span>{pick(capability, lang)}</span>
                                      </li>
                                    ))}
                                </ul>
                              </details>
                            )}
                            {!model.capabilities?.length && (
                              <span className="compare-muted">
                                {t("暂无已收录能力要点", "No capability notes recorded")}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                      <TableGroup
                        title={
                          scope === "versions"
                            ? t("价格与核验", "Pricing & verification")
                            : t("资料与核验", "Sources & verification")
                        }
                        columns={chosen.length + 1}
                      />
                      {scope === "versions" && (
                        <>
                          <Row
                            label={t("输入价格", "Input price")}
                            values={chosen.map((model) => spec(model.specs?.inputPrice))}
                          />
                          <Row
                            label={t("输出价格", "Output price")}
                            values={chosen.map((model) => spec(model.specs?.outputPrice))}
                          />
                        </>
                      )}
                      <Row
                        label={t("资料核验日期", "Last verified")}
                        values={chosen.map(
                          (model) => model.release?.lastVerifiedAt ?? model.lastUpdatedAt,
                        )}
                        mono
                      />
                      <tr>
                        <th scope="row">{t("规格与原始来源", "Specifications & sources")}</th>
                        {chosen.map((model) => (
                          <td key={model.id}>
                            <Link
                              to="/knowledge/model/$slug"
                              params={{ slug: model.slug }}
                              className="compare-text-button"
                            >
                              {t("查看详情与来源", "View details & sources")}
                            </Link>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="compare-footnote">
                  {scope === "versions"
                    ? t(
                        "价格保留原始币种、单位与适用条件；缓存、批处理、地区和渠道报价需分别比较。点击模型名称查看原始来源。",
                        "Prices retain their currency, units and conditions. Compare cached, batch, regional and channel rates separately. Open a model for original sources.",
                      )
                    : t(
                        "系列对比用于了解整体定位，具体规格、价格和可用性随版本变化。",
                        "Family comparisons show positioning. Specifications, pricing and availability vary by release.",
                      )}
                </p>
              </>
            ) : (
              <div className="compare-empty compare-empty--results">
                <p>{t("还没有选择对比对象", "No models selected")}</p>
                <span>
                  {t(
                    "先选系列，再添加你想了解的版本。",
                    "Choose a family and add releases to explore.",
                  )}
                </span>
                <button
                  className="compare-text-button"
                  type="button"
                  onClick={() => setPickerOpen(true)}
                >
                  {t("选择对比对象", "Choose models")}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function TableGroup({ title, columns }: { title: string; columns: number }) {
  return (
    <tr className="compare-table__group">
      <th colSpan={columns}>{title}</th>
    </tr>
  );
}
function Row({ label, values, mono = false }: { label: string; values: string[]; mono?: boolean }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {values.map((value, index) => (
        <td key={index} className={mono ? "compare-mono" : undefined}>
          {value}
        </td>
      ))}
    </tr>
  );
}
