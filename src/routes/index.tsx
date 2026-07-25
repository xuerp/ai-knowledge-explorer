import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles, Clock, Radar, TrendingUp, Bookmark } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, SectionHeading, EntityChip, ConfidenceChip, DemoBadge } from "@/components/common";
import {
  ENTITIES,
  FOLLOWING,
  RECENT_CHANGES,
  ENTITY_TYPE_LABELS,
  findEntity,
} from "@/lib/demo-data";
import { useApp, pick } from "@/lib/app-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Radar · 追踪 AI 技术生态的变化" },
      {
        name: "description",
        content: "个性化最新变化、全行业必看、今日图谱变化与继续研究，一个入口看懂 AI 技术生态。",
      },
      { property: "og:title", content: "AI Radar · 首页" },
      { property: "og:description", content: "追踪 AI 技术生态的时序知识图谱。" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { t, lang } = useApp();
  const followingIds = FOLLOWING.map((f) => f.entityId);
  const personalChanges = RECENT_CHANGES.filter((c) => followingIds.includes(c.entityId));
  const industryChanges = RECENT_CHANGES.slice(0, 6);

  return (
    <AppShell>
      <PageHeader
        title={t("追踪 AI 技术生态的变化", "Tracking how the AI ecosystem changes")}
        subtitle={t(
          "AI Radar 是一个持续更新、可追溯、具有时间维度的知识图谱。看懂一个模型从哪里来、现在能做什么、与谁相关、最近发生了什么。",
          "AI Radar is a continuously updated, sourced, time-aware knowledge graph of the AI ecosystem.",
        )}
        actions={
          <div className="flex gap-2">
            <Link
              to="/knowledge"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-signal text-signal-foreground text-sm font-medium hover:opacity-90"
            >
              {t("开始探索知识库", "Explore knowledge base")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/graph"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-accent"
            >
              {t("打开 2D 图谱", "Open 2D graph")}
            </Link>
          </div>
        }
      />

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-10">
          {/* Personal */}
          <section>
            <SectionHeading
              eyebrow={t("个性化", "For you")}
              title={t("你关注的最新变化", "Latest from what you follow")}
              description={t(
                "根据你的关注列表，从图谱中挑选真正与你相关的更新。",
                "Selected from your following list; only changes that matter to you.",
              )}
              action={
                <Link
                  to="/following"
                  className="text-sm text-signal hover:underline hidden md:inline-flex items-center gap-1"
                >
                  {t("管理关注", "Manage")} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <div className="grid md:grid-cols-2 gap-4">
              {personalChanges.map((c) => {
                const e = findEntity(c.entityId)!;
                return (
                  <Link
                    key={c.id}
                    to="/knowledge/model/$slug"
                    params={{ slug: e.slug }}
                    className="paper-card p-5 hover:border-signal/50 transition-colors block"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="chip">{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
                      <span className="font-serif font-semibold text-foreground">
                        {pick(e.name, lang)}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {c.date}
                      </span>
                    </div>
                    <p className="text-[15px] leading-relaxed text-foreground">
                      {pick(c.summary, lang)}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <ConfidenceChip level={c.confidence} />
                      <DemoBadge />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Industry */}
          <section>
            <SectionHeading
              eyebrow={t("行业", "Industry")}
              title={t("全行业不可错过", "Industry must-reads")}
              description={t(
                "跨厂商、跨方向筛选的重要更新，避免只看到自己关注的信息茧房。",
                "Cross-vendor, cross-topic filter of what matters — beyond your own filter bubble.",
              )}
            />
            <div className="paper-card divide-y divide-border">
              {industryChanges.map((c) => {
                const e = findEntity(c.entityId)!;
                return (
                  <Link
                    key={c.id}
                    to="/knowledge/model/$slug"
                    params={{ slug: e.slug }}
                    className="flex items-start gap-4 px-5 py-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="text-xs text-muted-foreground w-20 shrink-0 pt-1">{c.date}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-medium text-foreground">{pick(e.name, lang)}</span>
                        <span className="chip">{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
                        <ConfidenceChip level={c.confidence} />
                      </div>
                      <p className="text-sm text-ink-soft">{pick(c.summary, lang)}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Graph changes */}
          <section>
            <SectionHeading
              eyebrow={t("图谱", "Graph")}
              title={t("今日图谱变化", "Graph changes today")}
              description={t(
                "新增或调整的实体与关系，直接进入图谱查看上下文。",
                "New or updated entities & relations — jump into the graph for context.",
              )}
            />
            <div className="grid sm:grid-cols-3 gap-3">
              <GraphChange
                icon={<Sparkles className="h-4 w-4 text-signal" />}
                title={t("新增实体 3 个", "3 new entities")}
                desc="MCP 1.0 · Qwen3-Max · Cursor Agent Orchestration"
              />
              <GraphChange
                icon={<TrendingUp className="h-4 w-4 text-signal" />}
                title={t("关系更新 8 条", "8 relation updates")}
                desc={t("GPT-5 新增基准 SWE-bench Verified", "GPT-5 → SWE-bench Verified")}
              />
              <GraphChange
                icon={<Radar className="h-4 w-4 text-signal" />}
                title={t("待审核 12 条", "12 pending review")}
                desc={t("社区传闻已进入低置信度队列", "Community rumors queued as low confidence")}
              />
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-8">
          <div className="paper-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Bookmark className="h-4 w-4 text-signal" />
              <h3 className="font-serif font-semibold text-foreground">
                {t("继续研究", "Continue research")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t(
                "你最近的图谱浏览与 AI 问答会保留在这里，方便下次接着看。",
                "Your recent graph views & AI answers, ready to resume.",
              )}
            </p>
            <ul className="space-y-3">
              {[
                {
                  q: t("对比 GPT-5 与 Claude 4.5 在代码任务上的差异", "Compare GPT-5 vs Claude 4.5 on code"),
                  path: "/ask" as const,
                },
                {
                  q: t("DeepSeek R2 的开源生态", "DeepSeek R2 open-source ecosystem"),
                  path: "/knowledge/model/deepseek" as const,
                },
                {
                  q: t("MCP 与 LangChain 的关系", "How MCP relates to LangChain"),
                  path: "/graph" as const,
                },
              ].map((it, i) => (
                <li key={i}>
                  <Link
                    to={it.path as any}
                    params={it.path.includes("$") ? { slug: "deepseek" } : undefined}
                    className="group block text-sm text-foreground hover:text-signal"
                  >
                    <span className="text-signal mr-2 font-mono text-xs">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {it.q}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="paper-card p-5">
            <h3 className="font-serif font-semibold text-foreground mb-3">
              {t("正在关注", "You follow")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {FOLLOWING.map((f) => {
                const e = findEntity(f.entityId);
                if (!e) return null;
                return <EntityChip key={f.entityId} entity={e} />;
              })}
            </div>
            <Link
              to="/following"
              className="mt-4 inline-flex items-center gap-1 text-sm text-signal hover:underline"
            >
              {t("管理关注与提醒强度", "Manage follows & intensity")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="paper-card p-5 bg-accent/40">
            <h3 className="font-serif font-semibold text-foreground mb-2">
              {t("三种阅读模式", "Three reading modes")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                "顶部 📖 按钮可切换：通俗解释、产品视角、技术细节。同一份知识，三种深度。",
                "Toggle via the book icon: General / Product / Technical. One dataset, three depths.",
              )}
            </p>
          </div>

          <div className="paper-card p-5">
            <h3 className="font-serif font-semibold text-foreground mb-3">
              {t("热门实体", "Popular entities")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {ENTITIES.filter((e) => e.type === "model").map((e) => (
                <EntityChip key={e.id} entity={e} />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function GraphChange({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to="/graph"
      className="paper-card p-4 hover:border-signal/50 transition-colors flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium text-foreground text-sm">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </Link>
  );
}
