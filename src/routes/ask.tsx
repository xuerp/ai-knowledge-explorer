import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Send, Sparkles, ShieldCheck, Info, HelpCircle, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge, SourceRow, ConfidenceChip } from "@/components/common";
import { useApp, pick } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { CLAIMS, SOURCES, findSource } from "@/lib/demo-data";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "AI 研究 · AI Radar" },
      { name: "description", content: "基于知识图谱的 AI 问答：事实、推断、未核验与冲突分开呈现。" },
      { property: "og:title", content: "AI Radar · AI 研究" },
      { property: "og:description", content: "有依据的 AI 回答。" },
    ],
  }),
  component: AskPage,
});

const SAMPLE_QUESTIONS = [
  { zh: "GPT-5 与 Claude 4.5 在代码任务上谁更强？", en: "GPT-5 vs Claude 4.5 on code — which is better?" },
  { zh: "DeepSeek R2 真的比 GPT-5 便宜 10 倍吗？", en: "Is DeepSeek R2 really 10× cheaper than GPT-5?" },
  { zh: "MCP 协议目前有哪些已知集成？", en: "Which integrations does MCP have today?" },
];

export function AskPage() {
  const { t, lang } = useApp();
  const [q, setQ] = useState(pick(SAMPLE_QUESTIONS[0], lang));
  const [answered, setAnswered] = useState(true);

  const factClaims = CLAIMS.filter((c) => c.confidence === "verified");
  const inferredClaims = CLAIMS.filter((c) => c.confidence === "inferred");
  const unverifiedClaims = CLAIMS.filter((c) => c.confidence === "unverified");

  return (
    <AppShell>
      <PageHeader
        title={t("AI 研究", "Ask AI")}
        subtitle={t(
          "基于 AI Radar 知识图谱回答。事实、推断、未核验与冲突分开呈现，每条结论都能追到原始来源。",
          "Answers grounded in the AI Radar graph. Fact / inference / unverified / conflict are separated; every conclusion links back to sources.",
        )}
      />

      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <form
          onSubmit={(e) => { e.preventDefault(); setAnswered(true); }}
          className="paper-card p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-signal" />
            {t("提问 AI Radar", "Ask AI Radar")} <DemoBadge className="ml-auto" />
          </div>
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            rows={3}
            className="w-full resize-none bg-transparent text-base text-foreground focus:outline-none"
            placeholder={t("输入你的研究问题…", "Type your research question…")}
          />
          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_QUESTIONS.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setQ(pick(s, lang))}
                className="chip hover:border-signal/50 hover:text-foreground"
              >
                {pick(s, lang)}
              </button>
            ))}
            <Button type="submit" className="ml-auto">
              <Send className="h-4 w-4" /> {t("提问", "Ask")}
            </Button>
          </div>
        </form>

        {answered && (
          <div className="mt-8 space-y-6">
            <div className="text-xs uppercase tracking-widest text-signal font-medium">
              {t("回答", "Answer")}
            </div>
            <p className="font-serif text-2xl leading-relaxed text-foreground">
              {t(
                "在最新公开评测中，GPT-5 于 SWE-bench Verified 上取得 62.4% 的通过率，略高于 Claude 4.5 Sonnet；但在多轮代码修复任务的稳定性上，两者互有胜负。",
                "In the latest public benchmarks, GPT-5 reaches 62.4% pass rate on SWE-bench Verified — slightly above Claude 4.5 Sonnet. For multi-turn code-repair stability, they trade wins.",
              )}
            </p>

            {/* Fact */}
            <AnswerBlock
              title={t("已核验事实", "Verified facts")}
              icon={<ShieldCheck className="h-4 w-4 text-verified" />}
              tint="verified"
            >
              {factClaims.map((c) => (
                <ClaimRow key={c.id} zh={c.text.zh} en={c.text.en} sourceIds={c.sourceIds} />
              ))}
            </AnswerBlock>

            {/* Inference */}
            <AnswerBlock
              title={t("基于证据的推断", "Evidence-based inference")}
              icon={<Info className="h-4 w-4 text-inferred" />}
              tint="inferred"
            >
              {inferredClaims.map((c) => (
                <ClaimRow key={c.id} zh={c.text.zh} en={c.text.en} sourceIds={c.sourceIds} />
              ))}
            </AnswerBlock>

            {/* Unverified */}
            <AnswerBlock
              title={t("未核验或社区传闻", "Unverified / community rumors")}
              icon={<HelpCircle className="h-4 w-4 text-unverified" />}
              tint="unverified"
            >
              {unverifiedClaims.map((c) => (
                <ClaimRow key={c.id} zh={c.text.zh} en={c.text.en} sourceIds={c.sourceIds} />
              ))}
            </AnswerBlock>

            {/* Conflict */}
            <AnswerBlock
              title={t("存在冲突的说法", "Conflicting claims")}
              icon={<AlertTriangle className="h-4 w-4 text-conflict" />}
              tint="conflict"
            >
              <ClaimRow
                zh="A 来源称 GPT-5 上下文为 400K，B 来源称 1M。"
                en="Source A reports 400K context for GPT-5; Source B claims 1M."
                sourceIds={["s-openai-gpt5", "s-community-rumor"]}
              />
            </AnswerBlock>

            <div className="paper-card p-4 bg-accent/40 text-xs text-muted-foreground">
              {t(
                "AI Radar 的回答仅基于图谱内的证据。若某项事实未在图谱中出现，AI 会明确说明「没有足够证据」，而不会自行编造。",
                "Answers use only evidence in the graph. When a fact isn't in the graph, AI says 'no sufficient evidence' instead of inventing.",
              )}
            </div>

            <div className="pt-4">
              <Link
                to="/knowledge/model/$slug"
                params={{ slug: "gpt" }}
                className="text-sm text-signal hover:underline"
              >
                {t("查看 GPT 完整档案 →", "View GPT full profile →")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AnswerBlock({
  title,
  icon,
  tint,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tint: "verified" | "inferred" | "unverified" | "conflict";
  children: React.ReactNode;
}) {
  const border = {
    verified: "border-l-verified",
    inferred: "border-l-inferred",
    unverified: "border-l-border-strong",
    conflict: "border-l-conflict",
  }[tint];
  return (
    <div className={`paper-card border-l-4 ${border} pl-5 pr-5 py-4`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-serif font-semibold text-foreground">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ClaimRow({ zh, en, sourceIds }: { zh: string; en: string; sourceIds: string[] }) {
  const { lang } = useApp();
  return (
    <div>
      <p className="text-sm text-foreground leading-relaxed">{lang === "zh" ? zh : en}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {sourceIds.map((id) => {
          const s = findSource(id);
          if (!s) return null;
          return (
            <a
              key={id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="chip hover:text-signal hover:border-signal/50"
            >
              {s.publisher} · {s.publishedAt}
            </a>
          );
        })}
      </div>
    </div>
  );
}
