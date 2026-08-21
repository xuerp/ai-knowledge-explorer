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
        content: "AI Radar 如何从一次性 AI 问答转向持续、可验证的 AI 情报基础设施。",
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
              "把概率性的 AI 输出，变成可以长期依赖的知识产品",
              "Turning probabilistic AI output into a knowledge product people can rely on",
            )}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-ink-soft md:text-lg">
            {t(
              "AI Radar 的关键不是再做一个聊天框，而是持续维护 AI 模型、Agent 与产品生态的可验证状态：变化有时间线，结论有证据，模型输出先成为候选，再经过验证进入知识库。",
              "AI Radar is not another chat box. It maintains a verifiable state of the AI ecosystem: changes have timelines, conclusions have evidence, and model output becomes a candidate before it can enter the knowledge base.",
            )}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-signal px-4 text-sm font-medium text-signal-foreground"
            >
              {t("体验公开产品", "Explore the product")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/admin/review-demo"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium"
            >
              {t("查看审核闭环", "View the review workflow")}
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
                "模型可能漏掉限定词、混合上下文或补充记忆；直接写库会把一次错误扩散到 Timeline、Compare 和 Research。",
                "A model may drop qualifiers, merge context, or add memory. Direct writes turn one error into contamination across timelines, comparisons, and research.",
              )}
            />
          </div>
        </StorySection>

        <StorySection
          number="03"
          eyebrow={t("产品转向", "Product pivot")}
          title={t(
            "从 AI Q&A 转向 Persistent AI Intelligence Layer",
            "From AI Q&A to a persistent intelligence layer",
          )}
        >
          <div className="paper-card grid gap-px overflow-hidden bg-border md:grid-cols-5">
            {[
              t("官方信源", "Official sources"),
              t("快照与差异", "Snapshots & diff"),
              t("候选事实", "Candidates"),
              t("证据与审核", "Evidence & review"),
              t("知识消费", "Knowledge use"),
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
                "先让核心实体拥有可用的 Timeline、关系和来源，再扩大全库数量。",
                "Build usable timelines, relationships, and sources for core entities before expanding the directory.",
              )}
            />
            <Decision
              icon={<Sparkles className="h-5 w-5" />}
              title={t("证据不足时拒答", "Decline when evidence is insufficient")}
              body={t(
                "Research 展示覆盖范围；没有足够 Claim 时返回可信的不确定性，而不是补齐答案。",
                "Research exposes coverage and returns trustworthy uncertainty instead of filling gaps.",
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
          eyebrow={t("三个核心体验", "Core experiences")}
          title={t(
            "让同一套证据服务追踪、比较与研究",
            "One evidence layer powers tracking, comparison, and research",
          )}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <JourneyLink
              to="/knowledge/model/$slug"
              icon={<History className="h-5 w-5" />}
              title={t("Timeline", "Timeline")}
              body={t(
                "理解一个实体如何随时间演进。",
                "Understand how an entity evolves over time.",
              )}
            />
            <JourneyLink
              to="/compare"
              icon={<GitCompareArrows className="h-5 w-5" />}
              title={t("Compare", "Compare")}
              body={t(
                "在一致维度下比较产品路线。",
                "Compare product direction on consistent dimensions.",
              )}
            />
            <JourneyLink
              to="/ask"
              icon={<Sparkles className="h-5 w-5" />}
              title={t("Research", "Research")}
              body={t(
                "基于已审核证据形成跨实体结论。",
                "Form cross-entity conclusions from reviewed evidence.",
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
                    "无需登录即可理解产品定位和三个核心体验",
                    "The product and three core experiences are understandable without login",
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
  to: "/knowledge/model/$slug" | "/compare" | "/ask";
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
