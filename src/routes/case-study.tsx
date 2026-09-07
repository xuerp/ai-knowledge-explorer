import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  GitCompareArrows,
  History,
  Radar,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/case-study")({
  head: () => ({
    meta: [
      { title: "产品 Case Study · AI Radar" },
      {
        name: "description",
        content: "AI Radar 如何用持续追踪、可信知识和关系证据支撑可执行的 AI 决策。",
      },
    ],
  }),
  component: CaseStudyPage,
});

function CaseStudyPage() {
  const { t } = useApp();
  const snapshot = useKnowledgeSnapshot().data ?? DEMO_KNOWLEDGE_SNAPSHOT;
  const timelineCount = Object.values(snapshot.timeline).reduce(
    (total, entries) => total + entries.length,
    0,
  );

  return (
    <AppShell>
      <main className="page-container pb-16 pt-10 md:pt-14">
        <header className="border-b border-border pb-12">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-signal">
            <Radar className="h-4 w-4" /> Product Case Study
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-tight md:text-6xl">
            {t(
              "把持续更新的可信知识，变成可执行的 AI 选择",
              "Turn continuously verified knowledge into actionable AI choices",
            )}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-ink-soft md:text-lg">
            {t(
              "AI Radar 用追踪器带用户发现变化，用知识、关系与 Evidence 解释变化，最终由决策助手结合任务和约束回答“我该怎么选”。模型输出先成为候选，经过验证后才能支撑公开结论。",
              "AI Radar uses tracking to surface changes, knowledge, relationships, and evidence to explain them, and a decision assistant to answer what to choose for a specific task and set of constraints. Model output remains a candidate until it is verified.",
            )}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/ask"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-signal px-4 text-sm font-medium text-signal-foreground"
            >
              {t("体验决策助手", "Try the decision assistant")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium"
            >
              {t("查看最新变化", "View latest changes")}
            </Link>
          </div>
        </header>

        <section className="grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <Metric value={String(snapshot.entities.length)} label={t("实体", "Entities")} />
          <Metric value={String(snapshot.claims.length)} label={t("公开 Claim", "Public claims")} />
          <Metric value={String(snapshot.graph.edges.length)} label={t("关系", "Relations")} />
          <Metric value={String(timelineCount)} label={t("时间线", "Timeline entries")} />
        </section>

        <StorySection
          number="01"
          eyebrow={t("问题", "Problem")}
          title={t(
            "信息更新很快，但长期理解仍靠重复劳动",
            "Fast updates still create repetitive research work",
          )}
        >
          <p>
            {t(
              "AI 变化分散在官方博客、文档、Release Notes、GitHub 与技术资料中。长期追踪者需要反复搜索、核对来源、整理历史，再重新构造比较维度。",
              "AI changes are scattered across official blogs, documentation, release notes, GitHub, and technical material. Long-term tracking repeatedly requires search, source validation, history reconstruction, and comparison design.",
            )}
          </p>
        </StorySection>

        <StorySection
          number="02"
          eyebrow={t("最初方案", "Initial idea")}
          title={t("直接让 LLM 回答动态，为什么不够？", "Why direct LLM answers were not enough")}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Decision
              icon={<Bot className="h-5 w-5" />}
              title={t("一次性生成", "One-off generation")}
              body={t(
                "回答结束后没有持续状态，下一次仍要重新找资料、重新判断时效。",
                "The answer leaves no persistent state, so the next request repeats retrieval and freshness judgment.",
              )}
            />
            <Decision
              icon={<ShieldCheck className="h-5 w-5" />}
              title={t("事实权限不清", "Unclear authority")}
              body={t(
                "模型可能漏掉限定词、混合上下文或补充记忆；直接写库会把一次错误扩散到追踪、比较和决策助手。",
                "A model may drop qualifiers, merge context, or add memory. Direct writes turn one error into contamination across tracking, comparison, and decision support.",
              )}
            />
          </div>
        </StorySection>

        <StorySection
          number="03"
          eyebrow={t("产品转向", "Product pivot")}
          title={t(
            "从 AI 知识库转向 AI 决策基础设施",
            "From an AI knowledge base to decision infrastructure",
          )}
        >
          <div className="paper-card grid gap-px overflow-hidden bg-border md:grid-cols-5">
            {[
              t("官方信源", "Official sources"),
              t("快照与差异", "Snapshots & diff"),
              t("候选事实", "Candidates"),
              t("证据与审核", "Evidence & review"),
              t("有依据的决策", "Evidence-backed decisions"),
            ].map((label, index) => (
              <div key={label} className="relative bg-card p-5 text-sm font-medium">
                <span className="mb-3 block font-mono text-xs text-signal">0{index + 1}</span>
                {label}
                {index < 4 && (
                  <ArrowRight className="absolute right-2 top-1/2 hidden h-3.5 w-3.5 text-muted-foreground md:block" />
                )}
              </div>
            ))}
          </div>
        </StorySection>

        <StorySection
          number="04"
          eyebrow={t("关键决策", "Key decisions")}
          title={t(
            "自动化不是目标，可信自动化才是",
            "Automation is not the goal—trustworthy automation is",
          )}
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Decision
              icon={<ShieldCheck className="h-5 w-5" />}
              title={t(
                "Candidate / Verified Claim 分离",
                "Separate candidates from verified claims",
              )}
              body={t(
                "LLM 是提议者，不是事实裁决者；只有通过证据、结构、冲突与重复检查的内容才能公开。",
                "The LLM proposes; it does not adjudicate facts. Publication requires evidence, structure, conflict, and duplicate checks.",
              )}
            />
            <Decision
              icon={<History className="h-5 w-5" />}
              title={t("证据锚点是一等数据", "Evidence anchors are first-class data")}
              body={t(
                "不只保存链接，还保存支持结论的原文片段，降低核验成本并约束模型补写。",
                "The system stores supporting excerpts, not only links, reducing review cost and constraining unsupported completion.",
              )}
            />
            <Decision
              icon={<Scale className="h-5 w-5" />}
              title={t("按风险分级审核", "Risk-tiered review")}
              body={t(
                "低风险事实达到真实精度阈值后才能自动批准；价格、Benchmark、安全事件与冲突继续人工审核。",
                "Low-risk facts can be auto-approved only after measured precision; pricing, benchmarks, security events, and conflicts remain manual.",
              )}
            />
            <Decision
              icon={<GitCompareArrows className="h-5 w-5" />}
              title={t("深度优先于广度", "Depth over breadth")}
              body={t(
                "建立 8–10 个核心模型；GPT、Claude、Gemini 优先做深，其余核心模型达到可比较密度，长尾不设数量配额。",
                "Maintain 8–10 core models, deepen GPT, Claude, and Gemini first, give the remaining core enough density for comparison, and never impose quotas on the long tail.",
              )}
            />
            <Decision
              icon={<Sparkles className="h-5 w-5" />}
              title={t("证据不足时拒答", "Decline when evidence is insufficient")}
              body={t(
                "决策助手展示覆盖范围；没有足够 Claim 时缩小结论或明确拒答，而不是补齐一个看似完整的推荐。",
                "The decision assistant exposes coverage and narrows or declines conclusions when claims are insufficient instead of fabricating a complete recommendation.",
              )}
            />
            <Decision
              icon={<CheckCircle2 className="h-5 w-5" />}
              title={t("Showcase 与 Live 分开", "Separate showcase from live readiness")}
              body={t(
                "作品集可以使用明确标记的精选快照；正式模式仍必须通过 Claim、关系、黄金问题和生产门槛。",
                "A clearly labeled curated snapshot can support the portfolio, while live mode still requires claim, relation, golden-question, and production gates.",
              )}
            />
          </div>
        </StorySection>

        <StorySection
          number="05"
          eyebrow={t("产品闭环", "Product loop")}
          title={t(
            "追踪负责入口，决策负责价值，知识关系负责可信",
            "Tracking drives discovery, decisions create value, knowledge makes both trustworthy",
          )}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <JourneyLink
              to="/"
              icon={<History className="h-5 w-5" />}
              title={t("追踪器 · 高频入口", "Tracker · frequent entry")}
              body={t(
                "持续发现主流模型真正值得关注的版本、能力和产品变化。",
                "Continuously surface the model, capability, and product changes that matter.",
              )}
            />
            <JourneyLink
              to="/knowledge/model/$slug"
              icon={<GitCompareArrows className="h-5 w-5" />}
              title={t("知识关系 · 可信基础", "Knowledge relations · trust layer")}
              body={t(
                "用已审核事实、时间线、生态关系和直接 Evidence 解释判断依据。",
                "Explain judgments with reviewed facts, timelines, ecosystem relationships, and direct evidence.",
              )}
            />
            <JourneyLink
              to="/ask"
              icon={<Sparkles className="h-5 w-5" />}
              title={t("决策助手 · 核心价值", "Decision assistant · core value")}
              body={t(
                "结合任务、预算与部署约束，给出带条件、时点和来源的选择建议。",
                "Turn task, budget, and deployment constraints into conditional, dated, and sourced recommendations.",
              )}
            />
          </div>
        </StorySection>

        <StorySection
          number="06"
          eyebrow={t("当前结果与边界", "Results and boundaries")}
          title={t(
            "Portfolio v1 可展示，Live Ready 继续保持严格门槛",
            "Portfolio v1 can be shown while live readiness stays strict",
          )}
        >
          <div className="grid gap-5 md:grid-cols-2">
            <div className="paper-card p-6">
              <h3 className="font-semibold text-verified">
                {t("Showcase Ready 能力", "Showcase-ready capabilities")}
              </h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-ink-soft">
                {[
                  t(
                    "无需登录即可理解“发现变化 → 理解依据 → 做出决策”的产品闭环",
                    "The discover → understand → decide product loop is clear without login",
                  ),
                  t(
                    "Claim、Evidence、Timeline、Relation 使用同一领域模型",
                    "Claims, evidence, timelines, and relationships share one domain model",
                  ),
                  t(
                    "公开快照明确披露 demo/cached，不伪装实时数据",
                    "The public snapshot explicitly discloses demo/cached status",
                  ),
                  t(
                    "公开 Demo、README、Case Study 与验收材料互相链接",
                    "The demo, README, case study, and acceptance evidence link together",
                  ),
                ].map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-verified" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="paper-card p-6">
              <h3 className="font-semibold text-unverified">
                {t("仍未宣称 Live Ready", "Not yet claimed as live-ready")}
              </h3>
              <p className="mt-4 text-sm leading-7 text-ink-soft">
                {t(
                  "正式模式仍要求 150 条已审核 Claim、核心关系覆盖、黄金问题和生产就绪检查真实通过。SMTP、正式域名、外部监控和备份恢复演练也需要外部资源。",
                  "Live mode still requires 150 reviewed claims, core relation coverage, golden questions, and production-readiness checks to pass. SMTP, a formal domain, external monitoring, and backup drills also need external resources.",
                )}
              </p>
            </div>
          </div>
        </StorySection>
      </main>
    </AppShell>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="paper-card p-5">
      <div className="font-mono text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function StorySection({
  number,
  eyebrow,
  title,
  children,
}: {
  number: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border py-12">
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="font-mono text-xs text-signal">{number}</div>
          <div className="mt-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </div>
        </div>
        <div>
          <h2 className="max-w-3xl text-2xl font-semibold md:text-3xl">{title}</h2>
          <div className="mt-6 space-y-4 text-sm leading-8 text-ink-soft">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Decision({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <article className="paper-card p-5">
      <div className="text-signal">{icon}</div>
      <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-ink-soft">{body}</p>
    </article>
  );
}

function JourneyLink({
  to,
  icon,
  title,
  body,
}: {
  to: "/" | "/knowledge/model/$slug" | "/ask";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const content = (
    <>
      <div className="text-signal">{icon}</div>
      <h3 className="mt-5 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-ink-soft">{body}</p>
      <span className="mt-5 inline-flex items-center gap-1 text-sm text-signal">
        Explore <ArrowRight className="h-4 w-4" />
      </span>
    </>
  );
  return to === "/knowledge/model/$slug" ? (
    <Link to={to} params={{ slug: "gpt" }} className="paper-card group p-6 hover:border-signal/40">
      {content}
    </Link>
  ) : (
    <Link to={to} className="paper-card group p-6 hover:border-signal/40">
      {content}
    </Link>
  );
}
