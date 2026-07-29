import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Send,
  Sparkles,
  ShieldCheck,
  Info,
  HelpCircle,
  AlertTriangle,
  History,
  Bookmark,
  ExternalLink,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import { useApp, pick } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import type { Evidence, LocalizedText } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "AI 研究 · AI Radar" },
      {
        name: "description",
        content: "基于知识图谱的 AI 问答：事实、推断、未核验与冲突分开呈现。",
      },
      { property: "og:title", content: "AI Radar · AI 研究" },
      { property: "og:description", content: "有依据的 AI 回答。" },
    ],
  }),
  component: AskPage,
});

const EMPTY_RESEARCH_QUESTIONS: LocalizedText[] = [];

function AskPage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const researchQuestions = snapshotQuery.data?.researchQuestions ?? EMPTY_RESEARCH_QUESTIONS;
  const initialQuestion = researchQuestions[0] ? pick(researchQuestions[0], lang) : "";
  const [q, setQ] = useState(initialQuestion);
  const [answered, setAnswered] = useState(true);
  const questionHydrated = useRef(Boolean(initialQuestion));

  useEffect(() => {
    if (questionHydrated.current || !researchQuestions[0]) return;
    setQ(pick(researchQuestions[0], lang));
    questionHydrated.current = true;
  }, [lang, researchQuestions]);

  const claims = snapshotQuery.data?.claims ?? [];
  const evidence = snapshotQuery.data?.evidence ?? [];
  const factClaims = claims.filter((c) => c.confidence === "verified");
  const inferredClaims = claims.filter((c) => c.confidence === "inferred");
  const unverifiedClaims = claims.filter((c) => c.confidence === "unverified");

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "研究数据加载失败" : "正在加载研究数据",
            snapshotQuery.error ? "Research data failed to load" : "Loading research data",
          )}
          description={t(
            "没有证据时不会生成伪答案，请重试。",
            "No answer will be fabricated without evidence. Please retry.",
          )}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }
  const researchAnswer = snapshotQuery.data.researchAnswers[0];

  return (
    <AppShell>
      <PageHeader
        title={t("AI 研究", "Ask AI")}
        subtitle={t(
          "基于 AI Radar 知识图谱回答。事实、推断、未核验与冲突分开呈现，每条结论都能追到原始来源。",
          "Answers grounded in the AI Radar graph. Fact / inference / unverified / conflict are separated; every conclusion links back to sources.",
        )}
      />

      <div className="page-container grid gap-6 py-6 lg:grid-cols-[210px_minmax(0,1fr)_260px]">
        <ResearchSidebar questions={researchQuestions} onSelect={setQ} />
        <div className="min-w-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAnswered(true);
            }}
            className="paper-card flex flex-col gap-3 p-4"
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
              {researchQuestions.map((question, index) => (
                <button
                  key={`${question.en}-${index}`}
                  type="button"
                  onClick={() => setQ(pick(question, lang))}
                  className="chip hover:border-signal/50 hover:text-foreground"
                >
                  {pick(question, lang)}
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
              <p className="text-xl font-semibold leading-relaxed text-foreground">
                {researchAnswer
                  ? pick(researchAnswer.summary, lang)
                  : t("当前证据不足，无法生成结论。", "There is not enough evidence to answer.")}
              </p>

              {/* Fact */}
              <AnswerBlock
                title={t("已核验事实", "Verified facts")}
                icon={<ShieldCheck className="h-4 w-4 text-verified" />}
                tint="verified"
              >
                {factClaims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    zh={c.text.zh}
                    en={c.text.en}
                    sourceIds={c.sourceIds}
                    evidence={evidence}
                  />
                ))}
              </AnswerBlock>

              {/* Inference */}
              <AnswerBlock
                title={t("基于证据的推断", "Evidence-based inference")}
                icon={<Info className="h-4 w-4 text-inferred" />}
                tint="inferred"
              >
                {inferredClaims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    zh={c.text.zh}
                    en={c.text.en}
                    sourceIds={c.sourceIds}
                    evidence={evidence}
                  />
                ))}
              </AnswerBlock>

              {/* Unverified */}
              <AnswerBlock
                title={t("未核验或社区传闻", "Unverified / community rumors")}
                icon={<HelpCircle className="h-4 w-4 text-unverified" />}
                tint="unverified"
              >
                {unverifiedClaims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    zh={c.text.zh}
                    en={c.text.en}
                    sourceIds={c.sourceIds}
                    evidence={evidence}
                  />
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
                  evidence={evidence}
                />
              </AnswerBlock>

              <div className="paper-card p-4 bg-accent/40 text-xs text-muted-foreground">
                {t(
                  "AI Radar 的回答仅基于图谱内的证据。若某项事实未在图谱中出现，AI 会明确说明「没有足够证据」，而不会自行编造。",
                  "Answers use only evidence in the graph. When a fact isn't in the graph, AI says 'no sufficient evidence' instead of inventing.",
                )}
              </div>

              <div className="pt-4 flex flex-wrap gap-x-5 gap-y-2">
                {researchAnswer && (
                  <Link
                    to="/research/$id"
                    params={{ id: researchAnswer.id }}
                    className="text-sm font-medium text-signal hover:underline"
                  >
                    {t("打开完整研究记录 →", "Open full research record →")}
                  </Link>
                )}
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
        <EvidenceSidebar evidence={evidence} />
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
        <h3 className="font-semibold text-foreground">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ResearchSidebar({
  questions,
  onSelect,
}: {
  questions: LocalizedText[];
  onSelect: (question: string) => void;
}) {
  const { t, lang } = useApp();
  return (
    <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="h-3.5 w-3.5" /> {t("研究历史", "Research history")}
      </div>
      <div className="space-y-1">
        {questions.map((question, index) => (
          <button
            key={`${question.en}-${index}`}
            type="button"
            onClick={() => onSelect(pick(question, lang))}
            className="block w-full rounded-md px-2 py-2 text-left text-xs leading-relaxed text-signal hover:bg-accent"
          >
            · {pick(question, lang)}
          </button>
        ))}
      </div>
      <div className="mb-3 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Bookmark className="h-3.5 w-3.5" /> {t("收藏问题", "Saved")}
      </div>
      <p className="px-2 text-xs leading-relaxed text-muted-foreground">
        {t("哪些 Agent 框架支持本地文件系统？", "Which agent frameworks support local files?")}
      </p>
    </aside>
  );
}

function EvidenceSidebar({ evidence }: { evidence: Evidence[] }) {
  const { t, lang } = useApp();
  return (
    <aside className="self-start lg:sticky lg:top-20">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("证据与来源", "Evidence & sources")}</h2>
        <span className="mono-meta">{evidence.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {evidence.slice(0, 8).map((source, index) => (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="paper-card group flex items-start gap-3 p-3 hover:border-signal/40"
          >
            <span className="font-mono text-xs text-signal">[{index + 1}]</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{pick(source.title, lang)}</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {source.publisher} · {source.publishedAt}
              </span>
            </span>
            <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-signal" />
          </a>
        ))}
      </div>
    </aside>
  );
}

function ClaimRow({
  zh,
  en,
  sourceIds,
  evidence,
}: {
  zh: string;
  en: string;
  sourceIds: string[];
  evidence: Evidence[];
}) {
  const { lang } = useApp();
  return (
    <div>
      <p className="text-sm text-foreground leading-relaxed">{lang === "zh" ? zh : en}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {sourceIds.map((id) => {
          const s = evidence.find((item) => item.id === id);
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
