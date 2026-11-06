import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Languages,
  Menu,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { useApp } from "@/lib/app-state";
import { useHomeOverview } from "@/hooks/use-knowledge";
import researchExample from "@/data/generated/home-research.json";
import researchPrompts from "../../product/research-prompts.v1.json";

const description =
  "整理已收录的 AI 模型与产品资料，按任务约束比较候选，查看结论来源与待确认条件。";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar · 带着依据做 AI 选择" },
      { name: "description", content: description },
      { property: "og:title", content: "AI Radar · 带着依据做 AI 选择" },
      { property: "og:description", content: description },
    ],
  }),
  component: LandingPage,
});
const navigation = [
  { to: "/updates", zh: "动态", en: "Updates" },
  { to: "/knowledge", zh: "知识库", en: "Knowledge" },
  { to: "/ask", zh: "决策助手", en: "Decide" },
  { to: "/graph", zh: "知识图谱", en: "Graph" },
] as const;

function LandingPage() {
  const { t, lang, setLang, theme, setTheme } = useApp();
  const overviewQuery = useHomeOverview();
  const overview = overviewQuery.data;
  const questions = overview?.researchQuestions.length
    ? overview.researchQuestions
    : researchPrompts;
  const changes = overview?.changes ?? [];
  const retrievedDate = overview?.meta.retrievedAt.slice(0, 10);
  return (
    <div className="landing-compact min-h-screen bg-background text-foreground">
      <a className="landing-compact__skip" href="#home-main">
        {t("跳到主要内容", "Skip to content")}
      </a>
      <header className="landing-compact__header">
        <div className="landing-compact__container landing-compact__header-inner">
          <Link to="/" aria-label="AI Radar" className="landing-compact__logo">
            <span className="radar-mark" aria-hidden="true" />
            AI Radar
          </Link>
          <nav className="landing-compact__desktop-nav" aria-label={t("主导航", "Main navigation")}>
            {navigation.map((item) => (
              <Link key={item.to} to={item.to}>
                {t(item.zh, item.en)}
              </Link>
            ))}
          </nav>
          <div className="landing-compact__header-actions">
            <Link to="/case-study" className="landing-compact__about">
              {t("项目介绍", "About")}
            </Link>
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
            <details className="landing-compact__mobile-menu">
              <summary aria-label={t("展开导航", "Open navigation")}>
                <Menu aria-hidden="true" />
              </summary>
              <nav aria-label={t("手机导航", "Mobile navigation")}>
                {navigation.map((item) => (
                  <Link key={item.to} to={item.to}>
                    {t(item.zh, item.en)}
                  </Link>
                ))}
                <Link to="/case-study">{t("项目介绍", "About the project")}</Link>
              </nav>
            </details>
          </div>
        </div>
      </header>
      <main id="home-main">
        <section className="landing-compact__hero">
          <div className="landing-compact__container landing-compact__hero-inner">
            <div className="landing-compact__intro">
              <h1>
                {lang === "zh" ? (
                  <>
                    查清 AI 模型变化，<span>带着依据做选择。</span>
                  </>
                ) : (
                  <>
                    Understand AI changes.<span>Choose with evidence.</span>
                  </>
                )}
              </h1>
              <p>
                {t(
                  "从已收录的资料出发，比较模型与工具的适用条件，查看结论来源与待确认事项。",
                  "Compare models and tools against your task, with collected sources, tradeoffs and open questions in view.",
                )}
              </p>
              <div className="landing-compact__hero-actions">
                <Link to="/ask" className="landing-compact__button is-primary">
                  {t("按任务选模型与工具", "Find a model or tool")}
                  <ArrowRight aria-hidden="true" />
                </Link>
                <a href="/updates#latest" className="landing-compact__button is-secondary">
                  {t("浏览已收录变化", "Browse collected changes")}
                </a>
              </div>
              <p className="landing-compact__intro-note">
                {t(
                  "个人实践项目。公开资料可直接浏览，保存个人研究需登录。",
                  "A personal practice project. Browse public evidence freely; sign in to save your research.",
                )}
              </p>
            </div>
            <ResearchPreview />
          </div>
        </section>
        <section className="landing-compact__section" aria-labelledby="home-questions">
          <div className="landing-compact__container">
            <div className="landing-compact__section-heading">
              <h2 id="home-questions">{t("从你要解决的问题开始", "Start with your question")}</h2>
              <p>{t("选一个示例，再改成自己的条件。", "Pick an example, then make it yours.")}</p>
            </div>
            <div className="landing-compact__questions">
              {questions.slice(0, 3).map((question) => {
                const text = question[lang];
                return (
                  <Link key={question.zh} to="/ask" search={{ task: text }}>
                    <Search aria-hidden="true" />
                    <strong>{text}</strong>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
        <section className="landing-compact__section is-muted" aria-labelledby="home-workflow">
          <div className="landing-compact__container">
            <div className="landing-compact__section-heading">
              <h2 id="home-workflow">
                {t("让研究有依据，也有下一步", "From a question to a next step")}
              </h2>
            </div>
            <ol className="landing-compact__workflow">
              <WorkflowStep
                number="1"
                title={t("描述你的任务", "Describe your task")}
                description={t(
                  "说明要完成什么，以及预算、部署和数据使用限制；必要时在原页补充条件。",
                  "Describe the job, budget, deployment and data constraints. Clarify missing conditions on the same page.",
                )}
              />
              <WorkflowStep
                number="2"
                title={t("比较候选与依据", "Compare options and evidence")}
                description={t(
                  "查看建议、适用理由与取舍，沿引用核对原始资料；缺少依据的部分会保留为待确认。",
                  "Review the advice, reasons and tradeoffs. Follow sources and keep unsupported conditions open.",
                )}
              />
              <WorkflowStep
                number="3"
                title={t("保存研究，继续验证", "Save and validate")}
                description={t(
                  "登录后保存你的条件与研究；按上手步骤在实际产品中试用，再记录真实结果。",
                  "Sign in to save your research. Try the suggested steps in the actual product, then record what happened.",
                )}
              />
            </ol>
          </div>
        </section>
        <section className="landing-compact__section" aria-labelledby="home-changes">
          <div className="landing-compact__container">
            <div className="landing-compact__section-heading">
              <h2 id="home-changes">{t("已收录的变化", "Collected changes")}</h2>
              <a href="/updates#latest">
                {t("查看变化记录", "View change records")}
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
            {overview ? (
              changes.length ? (
                <div className="landing-compact__insights">
                  {changes.map((change) => {
                    const entity = overview.entities.find((item) => item.id === change.entityId);
                    if (!entity) return null;
                    return (
                      <article key={change.id} className="landing-compact__insight-card">
                        <div className="landing-compact__insight-meta">
                          <span>
                            <Check aria-hidden="true" />
                            {confidenceLabel(change.confidence, lang)}
                          </span>
                          <time dateTime={change.date}>{change.date}</time>
                        </div>
                        <h3>
                          <Link to="/knowledge/model/$slug" params={{ slug: entity.slug }}>
                            {change.summary[lang]}
                            <ArrowRight aria-hidden="true" />
                          </Link>
                        </h3>
                        <p>
                          {entity.name[lang]} · {change.sourceIds?.length ?? 0}{" "}
                          {t("个来源", "sources")}
                        </p>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p>
                  {t(
                    "当前没有可展示的变化记录。你仍可浏览已收录资料。",
                    "No change records are available here. You can still browse the catalog.",
                  )}
                </p>
              )
            ) : (
              <div className="landing-compact__data-status" role="status">
                <p>
                  {overviewQuery.error
                    ? t(
                        "收录数据暂时无法读取，请重试；上方带日期的研究示例仍可查看。",
                        "The catalog is unavailable. Retry, or inspect the dated research example above.",
                      )
                    : t(
                        "正在读取收录资料，功能入口可以直接打开。",
                        "Loading the catalog. Feature links remain available.",
                      )}
                </p>
                {overviewQuery.error && (
                  <button
                    type="button"
                    className="landing-compact__button is-secondary"
                    onClick={() => void overviewQuery.refetch()}
                  >
                    {t("重试读取资料", "Retry catalog")}
                  </button>
                )}
              </div>
            )}
            <div className="landing-compact__browse-links">
              <Link to="/knowledge">
                {t("浏览模型与产品资料", "Browse models and products")}
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/graph">
                {t("探索有来源的关系", "Explore sourced relationships")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
        <section
          className="landing-compact__section landing-compact__evidence"
          aria-labelledby="home-evidence"
        >
          <div className="landing-compact__container landing-compact__evidence-inner">
            <div>
              <h2 id="home-evidence">{t("结论可以追到哪里？", "What supports the advice?")}</h2>
              <p>
                {t(
                  "从结论回到事实，再回到原始来源。内容按人工维护的收录快照展示，重要决策仍需核对原文、日期与实际使用条件。",
                  "Follow a conclusion to its facts and original sources. This manually maintained catalog is a snapshot; check the original material, dates and your actual conditions.",
                )}
              </p>
              <Link to="/quality">
                {t("查看数据状态与范围", "Inspect data status and scope")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className="landing-compact__catalog-note">
              {overview && (
                <p>
                  {t(
                    `已收录 ${overview.entityCount} 个资料对象；${overview.sourcedClaimCount}/${overview.claimCount} 条事实附有来源。`,
                    `${overview.entityCount} catalog entries; ${overview.sourcedClaimCount}/${overview.claimCount} facts link to sources.`,
                  )}
                </p>
              )}
              <p>
                {t(
                  "附有来源不等于结论正确，也不代表已完成实际任务验证。当前并非实时全量追踪。",
                  "A source link alone does not prove a conclusion or task performance. This is not a comprehensive live feed.",
                )}
              </p>
              {retrievedDate && (
                <p>
                  {t("本次资料读取：", "Catalog retrieved: ")}
                  <time dateTime={overview?.meta.retrievedAt}>{retrievedDate}</time>
                  {t("，并非来源内容更新日期。", "; this is not a source update date.")}
                </p>
              )}
            </div>
          </div>
        </section>
        <section className="landing-compact__cta">
          <div className="landing-compact__container">
            <h2>
              {t(
                "带上你的任务，开始一次有依据的选择。",
                "Bring your task. Make an informed choice.",
              )}
            </h2>
            <Link to="/ask" className="landing-compact__button is-primary">
              {t("开始我的研究", "Start my research")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <footer className="landing-compact__footer">
        <div className="landing-compact__container">
          <div className="landing-compact__footer-grid">
            <div className="landing-compact__footer-brand">
              <Link to="/" className="landing-compact__logo" aria-label="AI Radar">
                <span className="radar-mark" aria-hidden="true" />
                AI Radar
              </Link>
              <p>
                {t(
                  "AI 模型与产品资料整理、证据追溯与选型研究的个人实践项目。",
                  "A personal project for AI model and product research, traceable evidence and informed selection.",
                )}
              </p>
            </div>
            <nav aria-label={t("产品", "Product")}>
              <strong>{t("产品", "Product")}</strong>
              {navigation.map((item) => (
                <Link key={item.to} to={item.to}>
                  {t(item.zh, item.en)}
                </Link>
              ))}
              <Link to="/compare" search={{ models: undefined }}>
                {t("模型对比", "Model comparison")}
              </Link>
            </nav>
            <nav aria-label={t("项目与资料", "Project and resources")}>
              <strong>{t("项目与资料", "Project and resources")}</strong>
              <Link to="/case-study">{t("项目介绍", "About the project")}</Link>
              <Link to="/quality">{t("数据状态", "Data status")}</Link>
              <Link to="/admin/review-demo">{t("审核演示", "Review demo")}</Link>
              <a
                href="https://github.com/xuerp/ai-knowledge-explorer"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
                <ExternalLink aria-hidden="true" />
              </a>
              <Link to="/account">{t("账户", "Account")}</Link>
            </nav>
          </div>
          <div className="landing-compact__footer-bottom">
            <p>© 2026 AI Radar.</p>
            <p>{t("公开资料 · 人工维护快照", "Public sources · Manually maintained snapshot")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ResearchPreview() {
  const { t, lang } = useApp();
  const result = researchExample.languages[lang];
  return (
    <article className="landing-compact__research" aria-labelledby="home-research-title">
      <h2 id="home-research-title">{researchExample.title[lang]}</h2>
      <p className="landing-compact__research-meta">
        {t("公开资料分析示例", "Public-source research example")} ·{" "}
        <time dateTime={researchExample.generatedAt}>
          {researchExample.generatedAt.slice(0, 10)}
        </time>{" "}
        · {t("尚未实测", "Not trial-tested")}
      </p>
      <h3>{result.headline}</h3>
      <p>{result.summary}</p>
      <dl>
        <div>
          <dt>{t("依据", "Evidence")}</dt>
          <dd>{result.reasons[0].finding}</dd>
        </div>
        <div>
          <dt>{t("取舍", "Tradeoff")}</dt>
          <dd>{result.tradeoff}</dd>
        </div>
        <div>
          <dt>{t("待确认", "Still open")}</dt>
          <dd>{result.unknowns[0]}</dd>
        </div>
      </dl>
      <details>
        <summary>
          {t("查看完整依据与上手步骤", "Inspect sources and next steps")}
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="landing-compact__research-detail">
          <p>
            <strong>{t("任务条件：", "Task: ")}</strong>
            {result.question}
          </p>
          {result.reasons.map((reason) => (
            <p key={reason.dimension}>{reason.finding}</p>
          ))}
          <ul>
            {result.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title[lang]}
                  <ExternalLink aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          <h4>{result.nextAction.label}</h4>
          <p>{result.nextAction.instruction}</p>
        </div>
      </details>
      <div className="landing-compact__research-footer">
        <Link to="/ask" search={{ task: result.question }}>
          {t("用我的条件分析", "Adapt this task")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </article>
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
      <span aria-hidden="true">{number}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </li>
  );
}
function confidenceLabel(
  confidence: "verified" | "inferred" | "unverified" | "conflict",
  lang: "zh" | "en",
) {
  return {
    verified: { zh: "已核验", en: "Verified" },
    inferred: { zh: "推断", en: "Inferred" },
    unverified: { zh: "未核验", en: "Unverified" },
    conflict: { zh: "存在冲突", en: "Conflicting" },
  }[confidence][lang];
}
