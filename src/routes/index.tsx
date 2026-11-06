import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useApp } from "@/lib/app-state";
import { browseModelFamilies } from "@/domain/model-families";
import { TopNav } from "@/components/layout/TopNav";
import { useHomeOverview } from "@/hooks/use-home-overview";
import { RELATION_LABELS } from "@/domain/labels";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar · AI 模型与产品信息研究" },
      {
        name: "description",
        content: "整理已收录的模型与产品资料，查看版本变化、关系与来源，辅助 AI 选型研究。",
      },
      { property: "og:title", content: "AI Radar · AI 模型与产品信息研究" },
      {
        property: "og:description",
        content: "追踪模型变化，逐条核验证据，并把研究结果带入可解释的 AI 选型。",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { t, lang } = useApp();
  const overviewQuery = useHomeOverview();
  const overview = overviewQuery.data;
  const entities = overview?.entities ?? [];
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const evidenceById = new Map((overview?.evidence ?? []).map((source) => [source.id, source]));
  const featuredRelations = overview?.featuredRelations ?? [];
  const featuredInsights = overview?.changes ?? [];
  const researchQuestions = overview?.researchQuestions ?? [];
  const coreModels = browseModelFamilies(entities);
  const snapshotDate = overview.catalogUpdatedAt ?? "";
  const syncTime = overviewQuery.hasSynced
    ? new Date(overviewQuery.dataUpdatedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";

  return (
    <div className="landing-compact min-h-screen bg-background text-foreground">
      <a className="landing-compact__skip" href="#home-main">
        {t("跳到主要内容", "Skip to content")}
      </a>
      <TopNav variant="showcase" />
      <main id="home-main">
        <section className="landing-compact__hero">
          <div className="landing-compact__container landing-compact__hero-inner">
            <div className="landing-compact__status">
              <span aria-hidden="true" />
              {t(
                "AI 信息研究与选型 · 个人实践项目",
                "AI research and selection · Personal project",
              )}
            </div>
            <h1>
              {lang === "zh" ? (
                <>
                  基于<span>可验证证据</span>理解 AI 变化
                </>
              ) : (
                <>
                  Understand AI change with <span>verifiable evidence</span>
                </>
              )}
            </h1>
            <p>
              {t(
                "整理主流 AI 模型与产品资料，按已收录事实查看变化、来源与适用条件。",
                "Explore collected AI model and product information, including changes, sources and conditions of use.",
              )}
            </p>
            <div className="landing-compact__hero-actions">
              <Link to="/ask" className="landing-compact__button is-primary">
                {t("体验决策助手", "Try the decision assistant")} <ArrowRight aria-hidden="true" />
              </Link>
              <a href="/updates#latest" className="landing-compact__button is-secondary">
                {t("查看收录动态", "View collected updates")}
              </a>
            </div>
          </div>
        </section>

        <section
          className="landing-compact__metrics"
          aria-label={t("首页资料快照", "Homepage catalog snapshot")}
        >
          <div className="landing-compact__container">
            <dl>
              <Metric
                value={overview.entityCount}
                label={t("收录实体", "Catalog entities")}
                href="/knowledge"
              />
              <Metric
                value={`${overview.sourcedClaimCount}/${overview.claimCount}`}
                label={t("有来源事实", "Sourced claims")}
                href="/quality"
              />
              <Metric
                value={overview.relationshipCount}
                label={t("有来源联系", "Sourced connections")}
                href="/graph"
              />
              <Metric
                value={
                  snapshotDate ? snapshotDate.slice(5).replace("-", ".") : t("未记录", "Unknown")
                }
                label={t("资料更新日期", "Catalog update date")}
                href="/quality"
              />
            </dl>
          </div>
        </section>
        <div className="landing-compact__container landing-compact__data-note" role="status">
          <span>
            {!overviewQuery.automatic
              ? t("当前为离线资料快照。", "Showing an offline catalog snapshot.")
              : overviewQuery.isError
                ? t(
                    "自动同步暂未成功，当前内容仍可浏览。",
                    "Automatic sync failed; the previous catalog remains available.",
                  )
                : overviewQuery.hasSynced
                  ? t(
                      "已同步后台已发布资料，停留时每5分钟自动核对。",
                      "Published catalog synced; checked every 5 minutes while this page is active.",
                    )
                  : t(
                      "当前为预置快照，正在后台自动同步已发布资料。",
                      "Showing the bundled snapshot while published data syncs in the background.",
                    )}
          </span>
          {syncTime && <span>{t(`最近同步 ${syncTime}`, `Last synced ${syncTime}`)}</span>}
          {overviewQuery.isError && (
            <button
              type="button"
              onClick={() => void overviewQuery.refetch()}
              disabled={overviewQuery.isFetching}
            >
              {t("重新同步", "Retry sync")}
            </button>
          )}
        </div>

        {featuredInsights.length > 0 && (
          <section id="insights" className="landing-compact__section is-muted">
            <div className="landing-compact__container">
              <SectionHeading
                title={t("收录动态", "Collected updates")}
                action={
                  <a href="/updates#latest">
                    {t("查看全部", "View all")} <ArrowRight aria-hidden="true" />
                  </a>
                }
              />
              <div className="landing-compact__insights">
                {featuredInsights.map((change) => {
                  const entity = entities.find((item) => item.id === change.entityId);
                  if (!entity) return null;
                  return (
                    <article key={change.id} className="landing-compact__insight-card">
                      <div className="landing-compact__insight-meta">
                        <span className={`is-${change.confidence}`}>
                          <Check aria-hidden="true" /> {confidenceLabel(change.confidence, lang)}
                        </span>
                        <time dateTime={change.date}>{change.date}</time>
                      </div>
                      <div className="landing-compact__entity">
                        <span className="radar-mark text-signal" aria-hidden="true" />
                        <strong>{lang === "zh" ? entity.name.zh : entity.name.en}</strong>
                      </div>
                      <h3>{lang === "zh" ? change.summary.zh : change.summary.en}</h3>
                      <p>
                        {t(
                          "进入模型档案查看完整时间线与原始证据。",
                          "Open the model record for the full timeline and original evidence.",
                        )}
                      </p>
                      <div className="landing-compact__insight-footer">
                        <span>
                          {change.sourceIds?.length ?? 0} {t("个证据来源", "evidence sources")}
                        </span>
                        <Link to="/knowledge/model/$slug" params={{ slug: entity.slug }}>
                          {t("查看详情", "View details")} <ArrowRight aria-hidden="true" />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section id="features" className="landing-compact__section">
          <div className="landing-compact__container">
            <SectionHeading title={t("核心功能", "Core features")} centered />
            <div className="landing-compact__features">
              <Feature
                icon={<TrendingUp aria-hidden="true" />}
                title={t("变化追踪", "Change tracking")}
                description={t(
                  "汇总模型升级与新能力发布",
                  "Browse model releases and capability changes",
                )}
                to="/updates"
              />
              <Feature
                icon={<ShieldCheck aria-hidden="true" />}
                title={t("知识库", "Knowledge base")}
                description={t(
                  "按用途查模型、应用与原始依据",
                  "Explore models, apps and original evidence by purpose",
                )}
                to="/knowledge"
              />
              <Feature
                icon={<Sparkles aria-hidden="true" />}
                title={t("决策助手", "Decision assistant")}
                description={t(
                  "结合任务约束做可解释的选择",
                  "Make explainable choices from real constraints",
                )}
                to="/ask"
              />
              <Feature
                icon={<Network aria-hidden="true" />}
                title={t("知识图谱", "Knowledge graph")}
                description={t(
                  "查开发者、模型关联与原始证据",
                  "Explore developers, model connections and evidence",
                )}
                to="/graph"
              />
            </div>
          </div>
        </section>

        {featuredRelations.length > 0 && (
          <section className="landing-compact__section landing-relations">
            <div className="landing-compact__container">
              <SectionHeading
                title={t("知识图谱", "Knowledge graph")}
                action={
                  <Link to="/graph">
                    {t("探索关系", "Explore relations")} <ArrowRight aria-hidden="true" />
                  </Link>
                }
              />
              <p>
                {t(
                  "谁开发了它？应用使用什么模型？从一条关系进入，逐段查看来源。",
                  "Who develops it? Which model does an app use? Explore each connection and its sources.",
                )}
              </p>
              <div className="landing-relations__grid">
                {featuredRelations.map((edge) => {
                  const from = entityById.get(edge.fromId)!;
                  const to = entityById.get(edge.toId)!;
                  const source = edge.sourceIds
                    .map((id) => evidenceById.get(id))
                    .find((item) => item?.url)!;
                  return (
                    <article key={edge.id}>
                      <Link
                        to="/graph"
                        search={{ entity: from.id, target: to.id, mode: "connection" }}
                        className="landing-relations__path"
                      >
                        <strong>{lang === "zh" ? from.name.zh : from.name.en}</strong>
                        <span>
                          {lang === "zh"
                            ? RELATION_LABELS[edge.kind].zh
                            : RELATION_LABELS[edge.kind].en}{" "}
                          <ArrowRight aria-hidden="true" />
                        </span>
                        <strong title={to.name.en}>
                          {to.slug === "mcp" ? "MCP" : lang === "zh" ? to.name.zh : to.name.en}
                        </strong>
                      </Link>
                      <footer>
                        <span>
                          <ShieldCheck aria-hidden="true" />
                          {t("已核验关系", "Verified relation")}
                        </span>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {t("查看原始来源", "Original source")} <ExternalLink aria-hidden="true" />
                        </a>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {researchQuestions.length > 0 && (
          <section className="landing-compact__section is-muted">
            <div className="landing-compact__container">
              <SectionHeading
                title={t("从一个研究问题开始", "Start with a research question")}
                centered
              />
              <div className="landing-compact__questions">
                {researchQuestions.map((question) => {
                  const text = lang === "zh" ? question.zh : question.en;
                  return (
                    <Link key={question.zh} to="/ask" search={{ task: text }}>
                      <Search aria-hidden="true" />
                      <span>
                        <strong>{text}</strong>
                        <small>
                          {t(
                            "问题示例，点击后按你的需求修改",
                            "Suggested question — adapt it to your needs",
                          )}
                        </small>
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {coreModels.length > 0 && (
          <section id="models" className="landing-compact__section">
            <div className="landing-compact__container">
              <SectionHeading title={t("模型家族", "Model families")} centered />
              <div className="landing-compact__models">
                {coreModels.map((model) => (
                  <Link key={model.id} to="/knowledge/model/$slug" params={{ slug: model.slug }}>
                    <span className={`landing-compact__model-mark is-${model.slug}`}>
                      {modelInitial(model.slug)}
                    </span>
                    <strong>{modelDisplayName(model.slug, lang)}</strong>
                    <small>{model.vendor || model.latestVersion || "AI Radar"}</small>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="landing-compact__section is-muted">
          <div className="landing-compact__container">
            <SectionHeading title={t("资料处理流程", "How information is organized")} centered />
            <ol className="landing-compact__workflow">
              <WorkflowStep
                number="1"
                title={t("收集", "Collect")}
                description={t(
                  "收集官方公告、技术文档与评估材料",
                  "Gather official releases, documentation and evaluations",
                )}
              />
              <WorkflowStep
                number="2"
                title={t("提取", "Extract")}
                description={t(
                  "提取关键事实并绑定原始来源",
                  "Extract key facts and bind original sources",
                )}
              />
              <WorkflowStep
                number="3"
                title={t("审核", "Review")}
                description={t(
                  "区分已核验、推断与冲突信息",
                  "Separate verified, inferred and conflicting information",
                )}
              />
              <WorkflowStep
                number="4"
                title={t("发布", "Publish")}
                description={t(
                  "更新到时间线、档案与关系网络",
                  "Update timelines, records and relationship maps",
                )}
              />
            </ol>
          </div>
        </section>

        <section className="landing-compact__cta">
          <div className="landing-compact__container">
            <h2>{t("带着一个任务，体验 AI 选型", "Try AI selection with a real task")}</h2>
            <p>
              {t(
                "从一个真实任务开始，核对变化、来源与选择条件。",
                "Start with a real task and inspect its changes, sources and decision conditions.",
              )}
            </p>
            <Link to="/ask" className="landing-compact__button is-primary">
              {t("体验决策助手", "Try the decision assistant")} <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-compact__footer">
        <div className="landing-compact__container">
          <div className="landing-compact__footer-grid">
            <div className="landing-compact__footer-brand">
              <Link to="/" aria-label="AI Radar" className="landing-compact__footer-logo">
                <span className="radar-mark text-signal" aria-hidden="true" />
                <strong>AI Radar</strong>
              </Link>
              <p>
                {t(
                  "AI 模型与产品信息研究 · 个人实践项目",
                  "A personal AI model and product research project",
                )}
              </p>
            </div>

            <nav aria-label={t("产品", "Product")}>
              <strong>{t("产品", "Product")}</strong>
              <Link to="/updates">{t("动态追踪", "Updates")}</Link>
              <Link to="/knowledge">{t("知识库", "Knowledge base")}</Link>
              <Link to="/ask">{t("决策助手", "Decision assistant")}</Link>
              <Link to="/graph">{t("知识图谱", "Knowledge graph")}</Link>
              <Link to="/compare" search={{ models: undefined }}>
                {t("模型对比", "Model comparison")}
              </Link>
            </nav>

            <nav aria-label={t("资源", "Resources")}>
              <strong>{t("资源", "Resources")}</strong>
              <Link to="/case-study">{t("项目介绍", "About project")}</Link>
              <Link to="/quality">{t("数据质量", "Data quality")}</Link>
              <Link to="/admin/review-demo">{t("审核演示", "Review demo")}</Link>
            </nav>

            <nav aria-label={t("关于", "About")}>
              <strong>{t("关于", "About")}</strong>
              <a
                href="https://github.com/xuerp/ai-knowledge-explorer"
                target="_blank"
                rel="noreferrer"
              >
                GitHub <ExternalLink aria-hidden="true" />
              </a>
              <Link to="/account">{t("账户", "Account")}</Link>
            </nav>
          </div>

          <div className="landing-compact__footer-bottom">
            <p>© 2026 AI Radar.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Metric({ value, label, href }: { value: string | number; label: string; href?: string }) {
  return (
    <div>
      <dd>{href ? <a href={href}>{value}</a> : value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function SectionHeading({
  title,
  action,
  centered = false,
}: {
  title: string;
  action?: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={`landing-compact__section-heading${centered ? " is-centered" : ""}`}>
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
  to,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  to: "/updates" | "/ask" | "/graph" | "/knowledge";
}) {
  return (
    <Link to={to}>
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </Link>
  );
}

function WorkflowStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <li>
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </li>
  );
}

function confidenceLabel(
  confidence: "verified" | "inferred" | "unverified" | "conflict",
  lang: "zh" | "en",
) {
  const labels = {
    verified: { zh: "已核验", en: "Verified" },
    inferred: { zh: "推断", en: "Inferred" },
    unverified: { zh: "待核验", en: "Unverified" },
    conflict: { zh: "有冲突", en: "Conflicting" },
  } as const;
  return labels[confidence][lang];
}

function modelInitial(slug: string) {
  const labels: Record<string, string> = {
    gpt: "GPT",
    claude: "Cl",
    gemini: "Ge",
    deepseek: "DS",
    qwen: "Qw",
    kimi: "Ki",
    doubao: "豆",
    ernie: "文",
    glm: "GLM",
    hunyuan: "混",
    minimax: "MM",
    mistral: "Mi",
    grok: "Gr",
  };
  return labels[slug] ?? slug.slice(0, 2).toUpperCase();
}

function modelDisplayName(slug: string, lang: "zh" | "en") {
  const labels: Record<string, { zh: string; en: string }> = {
    gpt: { zh: "GPT", en: "GPT" },
    claude: { zh: "Claude", en: "Claude" },
    gemini: { zh: "Gemini", en: "Gemini" },
    deepseek: { zh: "DeepSeek", en: "DeepSeek" },
    qwen: { zh: "通义千问", en: "Qwen" },
    kimi: { zh: "Kimi", en: "Kimi" },
    doubao: { zh: "豆包", en: "Doubao" },
    ernie: { zh: "文心一言", en: "ERNIE Bot" },
    glm: { zh: "智谱 GLM", en: "GLM" },
    hunyuan: { zh: "腾讯混元", en: "Hunyuan" },
    minimax: { zh: "MiniMax", en: "MiniMax" },
    mistral: { zh: "Mistral", en: "Mistral" },
    grok: { zh: "Grok", en: "Grok" },
  };
  return labels[slug]?.[lang] ?? slug;
}
