import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpenCheck,
  Clock3,
  GitCompareArrows,
  History,
  Library,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { DemoBadge } from "@/components/common";
import { DataFreshnessBadge } from "@/components/data-state";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import type { ChangeEvent, Entity, KnowledgeSnapshot } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { pick, useApp } from "@/lib/app-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar · 持续追踪 AI 世界正在发生什么" },
      {
        name: "description",
        content: "把分散的 AI 官方更新整理成可验证事实、时间线、关系和研究结论。",
      },
    ],
  }),
  component: HomePage,
});

const CORE_ENTITY_SLUGS = [
  "gpt",
  "claude",
  "gemini",
  "deepseek",
  "qwen",
  "mcp",
  "langgraph",
  "autogen",
  "crewai",
  "manus",
  "devin",
];

function HomePage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const snapshot = snapshotQuery.data ?? DEMO_KNOWLEDGE_SNAPSHOT;
  const showingBundledSnapshot = !snapshotQuery.data;
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const latestChanges = snapshot.changes.slice(0, 6);
  const coreEntities = CORE_ENTITY_SLUGS.map((slug) =>
    snapshot.entities.find((entity) => entity.slug === slug),
  )
    .filter((entity): entity is Entity => Boolean(entity))
    .slice(0, 8);

  return (
    <AppShell>
      <main className="page-container min-w-0 overflow-hidden pb-16 pt-9 md:pt-14">
        <section className="grid min-w-0 items-end gap-8 border-b border-border pb-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-medium text-signal">
                <Radar className="h-4 w-4" /> AI INTELLIGENCE
              </span>
              <DataFreshnessBadge meta={snapshot.meta} />
            </div>
            <h1 className="max-w-full break-words text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-4xl md:text-6xl">
              {t("持续追踪 AI 世界正在发生什么", "Track what is changing across the AI world")}
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-ink-soft md:text-lg">
              {t(
                "AI Radar 自动追踪模型、Agent 与产品生态的官方更新，并将分散信息整理成可验证事实、时间线和关系。不是每次重新问 AI，而是持续维护一个有证据、可追踪、可比较的知识层。",
                "AI Radar continuously turns official model, agent, and product updates into verifiable facts, timelines, and relationships—an evidence-backed knowledge layer instead of another one-off answer.",
              )}
            </p>
            <div className="mt-7 flex min-w-0 flex-wrap gap-3">
              <a
                href="#latest"
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-signal px-5 text-sm font-medium text-signal-foreground hover:opacity-90"
              >
                {t("查看最近变化", "Explore latest changes")} <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                to="/compare"
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-5 text-sm font-medium hover:border-signal/40"
              >
                {t("比较主流 AI", "Compare leading AI")} <GitCompareArrows className="h-4 w-4" />
              </Link>
              <Link
                to="/ask"
                className="inline-flex h-11 w-full items-center px-1 text-sm text-signal sm:w-auto"
              >
                {t("体验证据化研究", "Try evidence-backed research")} →
              </Link>
            </div>
          </div>

          <aside className="paper-card min-w-0 p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-widest text-signal">
                {t("可信知识层", "Trust layer")}
              </span>
              <DemoBadge />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric value={String(snapshot.claims.length)} label={t("事实", "Claims")} />
              <Metric value={String(snapshot.evidence.length)} label={t("证据", "Evidence")} />
              <Metric value={String(snapshot.graph.edges.length)} label={t("关系", "Relations")} />
              <Metric value={String(countTimeline(snapshot))} label={t("时间线", "Timeline")} />
            </div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              {t(
                "当前公开快照明确标记为演示/缓存；达到正式质量门槛前不会冒充实时知识库。",
                "The public snapshot remains explicitly demo/cached until the formal live-quality gate passes.",
              )}
            </p>
          </aside>
        </section>

        {showingBundledSnapshot && (
          <div className="mt-5 rounded-md border border-signal/20 bg-accent/60 px-4 py-3 text-xs leading-6 text-muted-foreground">
            {t(
              snapshotQuery.error
                ? "实时接口暂时不可用，当前明确显示仓库内置的演示快照。"
                : "实时接口正在连接，当前先显示仓库内置的演示快照。",
              snapshotQuery.error
                ? "The live API is temporarily unavailable; the bundled demo snapshot is shown explicitly."
                : "The live API is connecting; the bundled demo snapshot is shown in the meantime.",
            )}
          </div>
        )}

        <section id="latest" className="scroll-mt-20 pt-12">
          <SectionTitle
            eyebrow={t("最新变化", "Latest changes")}
            title={t("最近 AI 世界发生了什么？", "What changed across AI recently?")}
            description={t(
              "每条更新都保留实体、时间、核验状态与来源入口。",
              "Every update keeps its entity, date, verification state, and source trail.",
            )}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {latestChanges.map((change) => {
              const entity = entityById.get(change.entityId);
              if (!entity) return null;
              return (
                <ChangeCard key={change.id} change={change} entity={entity} snapshot={snapshot} />
              );
            })}
          </div>
        </section>

        <section className="pt-14">
          <SectionTitle
            eyebrow={t("核心对象", "Core entities")}
            title={t("沿着实体理解长期演进", "Follow long-term evolution by entity")}
            description={t(
              "优先展示模型、Agent、协议和框架的完整档案，而不是只堆积名称。",
              "Start with complete profiles across models, agents, protocols, and frameworks—not a directory of names.",
            )}
            action={
              <Link to="/knowledge" className="text-sm text-signal hover:underline">
                {t("浏览知识库", "Browse knowledge")} →
              </Link>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {coreEntities.map((entity) => {
              const latest = snapshot.changes.find((change) => change.entityId === entity.id);
              return (
                <Link
                  key={entity.id}
                  to="/knowledge/$type/$slug"
                  params={{ type: entity.type, slug: entity.slug }}
                  className="paper-card group min-h-40 p-5 transition-colors hover:border-signal/40"
                >
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
                    <span>{entity.type}</span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:text-signal" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">{pick(entity.name, lang)}</h3>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-soft">
                    {latest ? pick(latest.summary, lang) : pick(entity.summary, lang)}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <Clock3 className="h-3 w-3" /> {entity.lastUpdatedAt}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="pt-14">
          <SectionTitle
            eyebrow={t("产品差异", "Product difference")}
            title={t("为什么不直接问 ChatGPT？", "Why not just ask ChatGPT?")}
            description={t(
              "通用问答擅长一次性生成；AI Radar 解决的是长期追踪、反复核验与跨时间比较。",
              "General chat excels at one-off generation. AI Radar is built for persistent tracking, verification, and comparison over time.",
            )}
          />
          <div className="paper-card grid gap-px overflow-hidden bg-border md:grid-cols-3 lg:grid-cols-6">
            {[
              [t("官方来源", "Official sources"), Library],
              [t("持续采集", "Continuous collection"), Radar],
              [t("AI 抽取", "AI extraction"), Sparkles],
              [t("证据核验", "Evidence verification"), ShieldCheck],
              [t("结构化知识", "Structured knowledge"), BookOpenCheck],
              [t("追踪与研究", "Track and research"), History],
            ].map(([label, Icon], index) => (
              <div key={String(label)} className="relative bg-card p-5">
                <Icon className="h-5 w-5 text-signal" />
                <div className="mt-4 text-sm font-medium">{label as string}</div>
                {index < 5 && (
                  <ArrowRight className="absolute right-2 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground lg:block" />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="pt-14">
          <SectionTitle
            eyebrow={t("三个核心体验", "Three core experiences")}
            title={t(
              "从变化到判断，不止得到一个答案",
              "Move from change to judgment—not just an answer",
            )}
          />
          <div className="grid gap-4 md:grid-cols-3">
            <ExperienceCard
              number="01"
              icon={<History className="h-5 w-5" />}
              title={t("追踪演进", "Track")}
              body={t(
                "用时间线看一个 AI 产品如何持续变化，并回到原始证据。",
                "See how an AI product evolves over time and inspect the source evidence.",
              )}
              link={
                <Link
                  to="/knowledge/model/$slug"
                  params={{ slug: "gpt" }}
                  className="text-sm text-signal hover:underline"
                >
                  {t("打开 GPT 时间线", "Open the GPT timeline")} →
                </Link>
              }
            />
            <ExperienceCard
              number="02"
              icon={<GitCompareArrows className="h-5 w-5" />}
              title={t("比较路线", "Compare")}
              body={t(
                "把 GPT、Claude、Gemini 放到一致维度中比较，不依赖临时 Prompt。",
                "Compare GPT, Claude, and Gemini on consistent dimensions without rebuilding a prompt.",
              )}
              link={
                <Link to="/compare" className="text-sm text-signal hover:underline">
                  {t("比较主流 AI", "Compare leading AI")} →
                </Link>
              }
            />
            <ExperienceCard
              number="03"
              icon={<Sparkles className="h-5 w-5" />}
              title={t("证据化研究", "Research")}
              body={t(
                "只用已收录 Claim 和 Evidence 形成结论，证据不足时明确拒答。",
                "Build conclusions only from recorded claims and evidence, and decline when coverage is insufficient.",
              )}
              link={
                <Link to="/ask" className="text-sm text-signal hover:underline">
                  {t("体验 AI 研究", "Try AI research")} →
                </Link>
              }
            />
          </div>
        </section>

        <section className="mt-14 flex flex-col items-start justify-between gap-5 border-y border-border py-8 md:flex-row md:items-center">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-signal">
              {t("产品故事", "Product story")}
            </div>
            <h2 className="mt-2 text-2xl font-semibold">
              {t("从一次性问答到持续情报基础设施", "From one-off Q&A to persistent intelligence")}
            </h2>
          </div>
          <Link
            to="/case-study"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:border-signal/40"
          >
            {t("阅读产品 Case Study", "Read the product case study")}{" "}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>
    </AppShell>
  );
}

function countTimeline(snapshot: KnowledgeSnapshot) {
  return Object.values(snapshot.timeline).reduce((total, entries) => total + entries.length, 0);
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="font-mono text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-widest text-signal">{eyebrow}</div>
        <h2 className="mt-2 text-2xl font-semibold md:text-3xl">{title}</h2>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function ChangeCard({
  change,
  entity,
  snapshot,
}: {
  change: ChangeEvent;
  entity: Entity;
  snapshot: KnowledgeSnapshot;
}) {
  const { t, lang } = useApp();
  const sources = snapshot.evidence.filter((source) => change.sourceIds?.includes(source.id));
  return (
    <article className="paper-card p-5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 text-verified">
          <ShieldCheck className="h-3.5 w-3.5" /> {t("已核验", "Verified")}
        </span>
        <span>·</span>
        <span>{sources[0]?.publisher ?? t("来源已绑定", "Source attached")}</span>
        <span className="ml-auto font-mono">{change.date}</span>
      </div>
      <Link
        to="/knowledge/$type/$slug"
        params={{ type: entity.type, slug: entity.slug }}
        className="group mt-4 block"
      >
        <div className="text-xs font-medium uppercase tracking-wider text-signal">
          {pick(entity.name, lang)}
        </div>
        <h3 className="mt-2 text-base font-semibold leading-6 group-hover:text-signal">
          {pick(change.summary, lang)}
        </h3>
        <span className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground">
          {t("查看时间线与证据", "Open timeline and evidence")}{" "}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    </article>
  );
}

function ExperienceCard({
  number,
  icon,
  title,
  body,
  link,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  link: React.ReactNode;
}) {
  return (
    <article className="paper-card p-6">
      <div className="flex items-center justify-between text-signal">
        {icon}
        <span className="font-mono text-xs">{number}</span>
      </div>
      <h3 className="mt-6 text-xl font-semibold">{title}</h3>
      <p className="mt-3 min-h-20 text-sm leading-7 text-ink-soft">{body}</p>
      <div className="mt-5 border-t border-border pt-4">{link}</div>
    </article>
  );
}
