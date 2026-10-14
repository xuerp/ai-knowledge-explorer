import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Languages,
  Moon,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingUp,
} from "lucide-react";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import { useApp } from "@/lib/app-state";
import { browseModelFamilies } from "@/domain/model-families";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { catalogRelationships } from "@/domain/relationship-catalog";
import { RELATION_LABELS } from "@/domain/labels";
import { featuredRelationships } from "@/domain/relationship-insights";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar - 基于可验证证据的 AI 模型追踪平台" },
      {
        name: "description",
        content:
          "持续追踪 GPT、Claude、Gemini 等核心模型，每条事实都有证据链路。拒绝无来源的模型榜单。",
      },
      { property: "og:title", content: "AI Radar - 基于可验证证据的 AI 模型追踪平台" },
      {
        property: "og:description",
        content: "追踪模型变化，逐条核验证据，并把研究结果带入可解释的 AI 选型。",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { t, lang, setLang, theme, setTheme } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const snapshot = snapshotQuery.data ?? DEMO_KNOWLEDGE_SNAPSHOT;
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const evidenceById = new Map(snapshot.evidence.map((source) => [source.id, source]));
  const sourcedRelations = catalogRelationships(snapshot);
  const featuredRelations = featuredRelationships(snapshot);
  const featuredInsights = snapshot.changes.slice(0, 3);
  const researchQuestions = snapshot.researchQuestions.slice(0, 3);
  const coreModels = browseModelFamilies(snapshot.entities);
  const sourcedClaimCount = snapshot.claims.filter((claim) => claim.sourceIds.length > 0).length;
  const snapshotDate = snapshot.meta.retrievedAt.slice(0, 10);

  return (
    <div className="landing-compact min-h-screen bg-background text-foreground">
      <main>
        <section className="landing-compact__hero">
          <div className="landing-compact__container landing-compact__hero-inner">
            <div className="landing-compact__status">
              <span aria-hidden="true" />
              {snapshot.meta.mode === "demo"
                ? t("示例知识快照", "Demo knowledge snapshot")
                : t("知识快照", "Knowledge snapshot")}{" "}
              · {snapshot.entities.length} {t("个实体", "entities")} · {sourcedClaimCount}/
              {snapshot.claims.length} {t("条事实有来源", "sourced claims")}
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
                "追踪主流 AI 模型的能力演进，每条结论都有来源、可审核、可追溯。",
                "Track how leading AI models evolve, with sources and review history behind every conclusion.",
              )}
            </p>
            <div className="landing-compact__hero-actions">
              <Link to="/ask" className="landing-compact__button is-primary">
                {t("开始探索", "Start exploring")} <ArrowRight aria-hidden="true" />
              </Link>
              <a href="/updates#latest" className="landing-compact__button is-secondary">
                {t("查看最新动态", "View latest updates")}
              </a>
            </div>
          </div>
        </section>

        <section className="landing-compact__metrics" aria-label={t("数据概览", "Data overview")}>
          <div className="landing-compact__container">
            <dl>
              <Metric
                value={snapshot.entities.length}
                label={t("已收录实体", "Entities")}
                href="/knowledge"
              />
              <Metric
                value={`${sourcedClaimCount}/${snapshot.claims.length}`}
                label={t("有来源事实", "Sourced claims")}
                href="/quality"
              />
              <Metric
                value={sourcedRelations.length}
                label={t("有来源联系", "Sourced connections")}
                href="/graph"
              />
              <Metric
                value={snapshotDate.slice(5).replace("-", ".")}
                label={t("快照日期", "Snapshot date")}
                href="/quality"
              />
            </dl>
          </div>
        </section>

        <section id="insights" className="landing-compact__section is-muted">
          <div className="landing-compact__container">
            <SectionHeading
              title={t("最新洞察", "Latest insights")}
              action={
                <a href="/updates#latest">
                  {t("查看全部", "View all")} <ArrowRight aria-hidden="true" />
                </a>
              }
            />
            <div className="landing-compact__insights">
              {featuredInsights.map((change) => {
                const entity = snapshot.entities.find((item) => item.id === change.entityId);
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

        <section id="features" className="landing-compact__section">
          <div className="landing-compact__container">
            <SectionHeading title={t("核心功能", "Core features")} centered />
            <div className="landing-compact__features">
              <Feature
                icon={<TrendingUp aria-hidden="true" />}
                title={t("变化追踪", "Change tracking")}
                description={t(
                  "持续捕捉模型升级与新能力发布",
                  "Follow model releases and capability changes",
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

        <section className="landing-compact__section is-muted">
          <div className="landing-compact__container">
            <SectionHeading title={t("热门研究问题", "Popular research questions")} centered />
            <div className="landing-compact__questions">
              {researchQuestions.map((question) => {
                const text = lang === "zh" ? question.zh : question.en;
                return (
                  <Link key={question.zh} to="/ask" search={{ task: text }}>
                    <Search aria-hidden="true" />
                    <span>
                      <strong>{text}</strong>
                      <small>
                        {t("带着完整约束进入决策研究", "Continue with full decision constraints")}
                      </small>
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

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

        <section className="landing-compact__section is-muted">
          <div className="landing-compact__container">
            <SectionHeading title={t("工作流程", "How it works")} centered />
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
            <h2>{t("准备好开始证据研究了吗？", "Ready to research with evidence?")}</h2>
            <p>
              {t(
                "从一个真实任务开始，核对变化、来源与选择条件。",
                "Start with a real task and inspect its changes, sources and decision conditions.",
              )}
            </p>
            <Link to="/ask" className="landing-compact__button is-primary">
              {t("立即开始", "Start now")} <ArrowRight aria-hidden="true" />
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
              <p>{t("基于可验证证据的 AI 模型追踪平台", "Verifiable AI model intelligence")}</p>
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
              <Link to="/case-study">{t("案例研究", "Case study")}</Link>
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
            <div className="landing-compact__footer-controls">
              <button
                type="button"
                aria-label={t("切换语言", "Switch language")}
                title={t("切换语言", "Switch language")}
                onClick={() => setLang(lang === "zh" ? "en" : "zh")}
              >
                <Languages aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("切换主题", "Switch theme")}
                title={t("切换主题", "Switch theme")}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </button>
            </div>
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
