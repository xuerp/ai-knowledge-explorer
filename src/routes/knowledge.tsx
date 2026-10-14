import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Check, CheckCircle2, Search, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EntryRequestDialog } from "@/components/knowledge/EntryRequestDialog";
import { DemoBadge, WorkspaceHeader } from "@/components/common";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import type { Entity, KnowledgeSnapshot } from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { modelDisplayName } from "@/lib/model-display";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import {
  CATEGORY_TYPES,
  knowledgePurpose,
  parseKnowledgeSearch,
  validateKnowledgeSearch,
  knowledgeBrowseHref,
  type KnowledgeCategory as Category,
  type KnowledgeSignal as SignalFilter,
  type KnowledgeSearch,
} from "@/domain/knowledge-browse";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";

export const Route = createFileRoute("/knowledge")({
  validateSearch: validateKnowledgeSearch,
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

const ANCHOR_SLUGS = ["gpt", "claude", "gemini"];

const SIGNAL_FILTERS: Array<{
  id: SignalFilter;
  zh: string;
  en: string;
  terms: string[];
}> = [
  { id: "all", zh: "全部", en: "All", terms: [] },
  { id: "multimodal", zh: "多模态", en: "Multimodal", terms: ["多模态", "multimodal"] },
  { id: "context", zh: "长上下文", en: "Long context", terms: ["上下文", "context"] },
  { id: "open", zh: "开源", en: "Open source", terms: ["开源", "open"] },
];

function KnowledgePage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const search = Route.useSearch();
  const { q: query, category, region, signal } = search;
  const navigate = useNavigate({ from: "/knowledge" });
  const updateSearch = (patch: Partial<KnowledgeSearch>) => {
    void navigate({
      search: parseKnowledgeSearch({ ...search, ...patch }),
      replace: true,
      resetScroll: false,
      hash: "",
    });
  };
  const setQuery = (q: string) => updateSearch({ q });
  const setRegion = (region: KnowledgeSearch["region"]) => updateSearch({ region });
  const setSignal = (signal: SignalFilter) => updateSearch({ signal });
  const browse = knowledgeBrowseHref(search);
  const snapshot = snapshotQuery.data ?? DEMO_KNOWLEDGE_SNAPSHOT;
  const entities = snapshot.entities;

  const categoryCounts = useMemo(
    () => ({
      model: entities?.filter((entity) => entity.type === "model" && !entity.familyId).length ?? 0,
      ecosystem:
        entities?.filter(
          (entity) => !entity.familyId && CATEGORY_TYPES.ecosystem.includes(entity.type),
        ).length ?? 0,
      organizations:
        entities?.filter(
          (entity) => !entity.familyId && CATEGORY_TYPES.organizations.includes(entity.type),
        ).length ?? 0,
      research:
        entities?.filter(
          (entity) => !entity.familyId && CATEGORY_TYPES.research.includes(entity.type),
        ).length ?? 0,
      all: entities?.filter((entity) => !entity.familyId).length ?? 0,
    }),
    [entities],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filter = SIGNAL_FILTERS.find((item) => item.id === signal);

    return (entities ?? []).filter((entity) => {
      if (entity.familyId) return false;
      if (category !== "all" && !CATEGORY_TYPES[category].includes(entity.type)) return false;
      if (region === "domestic" && !isDomestic(entity)) return false;
      if (region === "overseas" && isDomestic(entity)) return false;

      const searchable = [
        entity.name.zh,
        entity.name.en,
        entity.summary.zh,
        entity.summary.en,
        ...(entity.aliases ?? []),
        ...entity.tags,
        ...(entity.capabilities ?? []).flatMap((item) => [item.zh, item.en]),
      ]
        .join(" ")
        .toLowerCase();

      if (keyword && !searchable.includes(keyword)) return false;
      if (
        filter &&
        filter.terms.length > 0 &&
        !filter.terms.some((term) => searchable.includes(term))
      ) {
        return false;
      }
      return true;
    });
  }, [category, entities, query, region, signal]);

  const anchors = filtered.filter(
    (entity) => entity.type === "model" && ANCHOR_SLUGS.includes(entity.slug),
  );
  const remaining =
    category === "model"
      ? filtered.filter((entity) => !ANCHOR_SLUGS.includes(entity.slug))
      : filtered;
  const lastUpdated = [...entities]
    .map((entity) => entity.lastUpdatedAt)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];

  const categories: Array<{ id: Category; zh: string; en: string }> = [
    { id: "model", zh: "模型", en: "Models" },
    { id: "ecosystem", zh: "应用与开发", en: "Apps & development" },
    { id: "research", zh: "评测与研究", en: "Evaluation & research" },
    { id: "organizations", zh: "组织", en: "Organizations" },
    { id: "all", zh: "全部实体", en: "All entities" },
  ];

  return (
    <AppShell>
      <div className="knowledge-landing workspace-page">
        <div className="knowledge-landing__container">
          <WorkspaceHeader
            title={t("知识库", "Knowledge base")}
            description={t(
              "从模型、工具、评测与组织出发，查清能力边界和证据来源。",
              "Explore models, tools, evaluations and organizations with traceable evidence.",
            )}
            actions={
              <div className="knowledge-landing__search">
                <Search aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("搜索知识库", "Search knowledge base")}
                  aria-label={t("搜索知识库", "Search knowledge base")}
                />
              </div>
            }
          />

          <section
            className="knowledge-landing__tabs"
            aria-label={t("实体分类", "Entity categories")}
          >
            <div className="knowledge-landing__tab-list">
              {categories.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={category === item.id ? "is-active" : undefined}
                  aria-pressed={category === item.id}
                  onClick={() => {
                    updateSearch({
                      category: item.id,
                      signal: item.id === "model" ? signal : "all",
                    });
                  }}
                >
                  {t(item.zh, item.en)} <span>({categoryCounts[item.id]})</span>
                </button>
              ))}
            </div>
            <div className="knowledge-landing__freshness">
              <CheckCircle2 aria-hidden="true" />
              <span>{t("内容可追溯", "Traceable evidence")}</span>
              <span aria-hidden="true">·</span>
              <span>
                {t("最后更新", "Updated")}: {lastUpdated || "—"}
              </span>
              <DemoBadge mode={snapshot.meta.mode} updatedAt={snapshot.meta.retrievedAt} />
            </div>
          </section>

          <section className="knowledge-landing__filters" aria-label={t("筛选", "Filters")}>
            <span>{t("筛选", "Filter")}:</span>
            {(["all", "domestic", "overseas"] as const).map((item) => (
              <button
                type="button"
                key={item}
                className={region === item ? "is-active" : undefined}
                aria-pressed={region === item}
                onClick={() => setRegion(item)}
              >
                {region === item && <Check aria-hidden="true" />}
                {item === "all"
                  ? t("全部地区", "All regions")
                  : item === "domestic"
                    ? t("国内", "Domestic")
                    : t("海外", "Overseas")}
              </button>
            ))}
            {category === "model" && (
              <>
                <i aria-hidden="true" />
                {SIGNAL_FILTERS.filter((item) => item.id !== "all").map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={signal === item.id ? "is-active" : undefined}
                    aria-pressed={signal === item.id}
                    onClick={() => setSignal(signal === item.id ? "all" : item.id)}
                  >
                    {signal === item.id && <Check aria-hidden="true" />}
                    {t(item.zh, item.en)}
                  </button>
                ))}
              </>
            )}
          </section>

          {category === "model" && anchors.length > 0 && (
            <section className="knowledge-landing__section">
              <div className="knowledge-landing__section-heading">
                <h2>{t("锚点模型", "Anchor models")}</h2>
                <span>{t("主流竞争对标", "Mainstream benchmarks")}</span>
              </div>
              <div className="knowledge-landing__anchors">
                {anchors.map((entity) => (
                  <KnowledgeEntityCard
                    key={entity.id}
                    entity={entity}
                    snapshot={snapshot}
                    browse={browse}
                    prominent
                  />
                ))}
              </div>
            </section>
          )}

          <section className="knowledge-landing__section">
            <div className="knowledge-landing__section-heading">
              <h2>
                {category === "model"
                  ? t("核心模型", "Core models")
                  : category === "ecosystem"
                    ? t("应用与开发", "Apps & development")
                    : category === "research"
                      ? t("评测与研究", "Evaluation & research")
                      : category === "organizations"
                        ? t("开发组织", "Organizations")
                        : t("全部实体", "All entities")}
              </h2>
              <span>{t(`共 ${remaining.length} 个结果`, `${remaining.length} results`)}</span>
            </div>
            {remaining.length > 0 ? (
              <div className="knowledge-directory">
                {directoryGroups(category, remaining, t).map((group) => (
                  <section
                    key={group.title}
                    className="knowledge-directory__group"
                    data-count={group.entities.length}
                  >
                    {category !== "model" && (
                      <header className="knowledge-directory__heading">
                        <h3>
                          {group.title} <span>({group.entities.length})</span>
                        </h3>
                        <p>{group.description}</p>
                      </header>
                    )}
                    <div className={`knowledge-landing__grid is-${category}`}>
                      {group.entities.map((entity) => (
                        <KnowledgeEntityCard
                          key={entity.id}
                          entity={entity}
                          snapshot={snapshot}
                          browse={browse}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="knowledge-landing__empty">
                <strong>{t("没有匹配结果", "No matching results")}</strong>
                <p>{t("清除关键词或切换筛选条件后重试。", "Clear the query or change filters.")}</p>
                <button
                  type="button"
                  onClick={() => {
                    updateSearch({ q: "", region: "all", signal: "all" });
                  }}
                >
                  {t("清除筛选", "Clear filters")}
                </button>
              </div>
            )}
          </section>

          <section className="knowledge-landing__cta">
            <div className="knowledge-landing__cta-copy">
              <h2>{t("没有找到你要研究的对象？", "Can’t find what you want to research?")}</h2>
              <p>
                {t(
                  "提交名称与官方来源，或基于现有证据继续研究。",
                  "Suggest an entry with an official source, or continue your research.",
                )}
              </p>
            </div>
            <div className="knowledge-landing__cta-actions">
              <EntryRequestDialog />
              <Link to="/ask" className="is-secondary">
                {t("进入决策助手", "Open decision assistant")}
                <Sparkles aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function KnowledgeEntityCard({
  entity,
  prominent = false,
  snapshot,
  browse,
}: {
  entity: Entity;
  snapshot: KnowledgeSnapshot;
  browse: string;
  prominent?: boolean;
}) {
  const { t, lang } = useApp();
  const nonModel = entity.type !== "model";
  const sourceIds = new Set(
    (entity.knowledge?.keyPoints ?? []).flatMap((point) => point.sourceIds ?? []),
  );
  const sourceCount = snapshot.evidence.filter((source) => sourceIds.has(source.id)).length;
  const content = (
    <>
      <div className="knowledge-landing__card-top">
        <span className={`knowledge-landing__mark is-${entity.slug}`} aria-hidden="true">
          {modelInitial(entity)}
        </span>
        <span className="knowledge-landing__region">
          {nonModel
            ? entity.type === "agent"
              ? t("应用", "Application")
              : entity.tags.includes("协议")
                ? t("协议", "Protocol")
                : entity.tags.includes("SDK")
                  ? "SDK"
                  : pick(ENTITY_TYPE_LABELS[entity.type], lang)
            : regionLabel(entity, t)}
        </span>
      </div>
      <h3>{modelDisplayName(entity, lang)}</h3>
      <p>{pick(entity.summary, lang)}</p>
      <div className="knowledge-landing__card-meta">
        <span>
          {nonModel
            ? t(`${sourceCount} 个直接来源`, `${sourceCount} direct sources`)
            : entity.latestVersion || t("已收录", "Catalogued")}
        </span>
        <span>{entity.lastUpdatedAt}</span>
      </div>
      <div className="knowledge-landing__tags">
        {entity.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </>
  );

  const className = `knowledge-landing__card${prominent ? " is-prominent" : ""}${nonModel ? " is-reference" : ""}`;
  if (entity.type === "model") {
    return (
      <Link to="/knowledge/model/$slug" params={{ slug: entity.slug }} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <Link
      to="/knowledge/$type/$slug"
      params={{ type: entity.type, slug: entity.slug }}
      search={{ browse }}
      id={entity.id}
      className={className}
    >
      {content}
    </Link>
  );
}

function modelInitial(entity: Entity) {
  const initials: Record<string, string> = {
    gpt: "G",
    claude: "C",
    gemini: "G",
    deepseek: "DS",
    qwen: "Q",
    kimi: "K",
    doubao: "D",
    ernie: "E",
  };
  if (initials[entity.slug]) return initials[entity.slug];
  const value = entity.name.en || entity.name.zh;
  return value.slice(0, 2);
}

function regionLabel(entity: Entity, t: (zh: string, en: string) => string) {
  if (!entity.origin) return t("未标注", "Unspecified");
  return isDomestic(entity) ? t("国内", "Domestic") : t("海外", "Overseas");
}

function isDomestic(entity: Entity) {
  if (!entity.origin) return false;
  return ["中国", "国内", "China", "Domestic"].some(
    (label) => entity.origin?.zh === label || entity.origin?.en === label,
  );
}

function directoryGroups(
  category: Category,
  entities: Entity[],
  t: (zh: string, en: string) => string,
) {
  if (category === "model") return [{ title: "models", description: "", entities }];
  const groups = [
    {
      purpose: "models",
      title: t("模型家族", "Model families"),
      description: t("比较能力、版本与接入方式。", "Compare capabilities, versions and access."),
    },
    {
      purpose: "coding",
      title: t("编程开发", "Coding & development"),
      description: t(
        "代码库理解、编辑、测试与工程任务；IDE、CLI 和 Agent 为使用形态标签。",
        "Code, test and maintain projects; IDE, CLI and Agent describe how you use them.",
      ),
    },
    {
      purpose: "work",
      title: t("办公与研究", "Office & research apps"),
      description: t(
        "处理文档、数据和研究任务，交付可检查的成果。",
        "Work with documents, data and research to produce reviewable results.",
      ),
    },
    {
      purpose: "infrastructure",
      title: t("开发基础设施", "Development infrastructure"),
      description: t(
        "自己构建应用时使用的框架、SDK 与连接协议。",
        "Frameworks, SDKs and protocols for building your own apps.",
      ),
    },
    {
      purpose: "evaluation",
      title: t("能力评测", "Capability evaluation"),
      description: t(
        "核对测试方法与适用范围，再理解模型分数。",
        "Check evaluation methods and scope before interpreting model scores.",
      ),
    },
    {
      purpose: "research",
      title: t("论文与数据", "Papers & datasets"),
      description: t(
        "解释模型机制和评测依据，保留与选型相关的研究。",
        "Research that explains model mechanisms and evaluation evidence.",
      ),
    },
    {
      purpose: "organizations",
      title: t("开发组织", "Organizations"),
      description: t(
        "查清谁开发、维护这些模型与应用。",
        "Identify who develops and maintains models and apps.",
      ),
    },
  ];
  return groups
    .map((group) => ({
      ...group,
      entities: entities.filter((entity) => knowledgePurpose(entity) === group.purpose),
    }))
    .filter((group) => group.entities.length > 0);
}
