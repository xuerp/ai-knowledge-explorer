import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  GitCompareArrows,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge } from "@/components/common";
import { useApp, pick } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import type { Evidence, LocalizedText, ResearchAnswer } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { readAuthToken } from "@/services/auth-session";
import { userApi, type DecisionContext, type ResearchResult } from "@/services/user-api";
import { DecisionBrief } from "@/components/research/DecisionBrief";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "AI 决策助手 · AI Radar" },
      {
        name: "description",
        content: "结合任务、预算、部署约束与已审核证据，辅助 AI 模型和产品选型。",
      },
      { property: "og:title", content: "AI Radar · 决策助手" },
      { property: "og:description", content: "基于当前证据做 AI 选择。" },
    ],
  }),
  component: AskPage,
});

const subscribeToHydration = () => () => {};

function AskPage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const snapshot = hydrated
    ? (snapshotQuery.data ?? DEMO_KNOWLEDGE_SNAPSHOT)
    : DEMO_KNOWLEDGE_SNAPSHOT;
  const researchQuestions = snapshot.researchQuestions;
  const showcaseAnswers = snapshot.researchAnswers;
  const initialQuestion = researchQuestions[0] ? pick(researchQuestions[0], lang) : "";
  const token = readAuthToken();
  const [task, setTask] = useState(initialQuestion);
  const [priority, setPriority] = useState<DecisionContext["priority"]>("balanced");
  const [budgetMode, setBudgetMode] = useState<DecisionContext["budget"]["mode"]>("unknown");
  const [budgetMinimum, setBudgetMinimum] = useState("");
  const [budgetMaximum, setBudgetMaximum] = useState("");
  const [deployment, setDeployment] = useState<DecisionContext["deployment"]>("undecided");
  const [exclusions, setExclusions] = useState("");
  const [notes, setNotes] = useState("");
  const [candidateEntityIds, setCandidateEntityIds] = useState<string[]>([]);
  const [research, setResearch] = useState<ResearchResult | null>(() =>
    !token && showcaseAnswers[0] ? toShowcaseResearch(showcaseAnswers[0], lang) : null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const questionHydrated = useRef(Boolean(initialQuestion));
  const submissionInFlight = useRef(false);

  useEffect(() => {
    if (questionHydrated.current || !researchQuestions[0]) return;
    setTask(pick(researchQuestions[0], lang));
    questionHydrated.current = true;
  }, [lang, researchQuestions]);

  useEffect(() => {
    const sharedSearch = new URLSearchParams(window.location.search);
    const sharedTask = sharedSearch.get("task")?.trim();
    if (sharedTask) setTask(sharedTask);
    setCandidateEntityIds(
      (sharedSearch.get("candidates") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20),
    );
  }, []);

  const claims = snapshot.claims;
  const evidence = snapshot.evidence;
  const matchedClaims = research
    ? research.claimIds
        .map((id) => claims.find((claim) => claim.id === id))
        .filter((claim): claim is (typeof claims)[number] => Boolean(claim))
    : [];
  const factClaims = matchedClaims.filter((c) => c.confidence === "verified");
  const inferredClaims = matchedClaims.filter((c) => c.confidence === "inferred");
  const unverifiedClaims = matchedClaims.filter((c) => c.confidence === "unverified");

  const submitResearch = async () => {
    if (submissionInFlight.current) return;
    const normalizedTask = task.trim();
    if (normalizedTask.length < 5) {
      setError(
        t("请用至少 5 个字符描述任务。", "Please describe the task with at least 5 characters."),
      );
      return;
    }
    const budget = {
      mode: budgetMode,
      ...(budgetMode === "range" && budgetMinimum ? { min: Number(budgetMinimum) } : {}),
      ...(budgetMode === "range" && budgetMaximum ? { max: Number(budgetMaximum) } : {}),
      ...(budgetMode === "range" ? { currency: "CNY" } : {}),
    };
    if (
      budgetMode === "range" &&
      budgetMinimum &&
      budgetMaximum &&
      Number(budgetMinimum) > Number(budgetMaximum)
    ) {
      setError(t("预算下限不能高于上限。", "The budget minimum cannot exceed the maximum."));
      return;
    }
    const parsedExclusions = exclusions
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (parsedExclusions.length > 20 || parsedExclusions.some((item) => item.length > 200)) {
      setError(
        t(
          "排除条件最多 20 项，每项不超过 200 字符。",
          "Use at most 20 exclusions and keep each under 200 characters.",
        ),
      );
      return;
    }
    const decisionContext: DecisionContext = {
      task: normalizedTask,
      priority,
      budget,
      deployment,
      exclusions: parsedExclusions,
      candidateEntityIds,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    const question = composeDecisionQuestion(decisionContext, lang);
    if (question.length > 2000) {
      setError(
        t(
          "任务、排除条件和补充说明合计过长，请精简到 2000 字符以内。",
          "The task, exclusions, and notes are too long. Keep the combined request under 2,000 characters.",
        ),
      );
      return;
    }
    if (!token) {
      const showcaseAnswer = showcaseAnswers.find(
        (answer) => pick(answer.question, lang) === normalizedTask,
      );
      if (!showcaseAnswer) {
        setResearch(null);
        setError(
          t(
            "当前公开快照没有足够证据回答这个问题；系统不会补写缺失结论。",
            "The public snapshot does not contain enough evidence for this question; missing conclusions will not be invented.",
          ),
        );
        return;
      }
      setError("");
      setResearch(toShowcaseResearch(showcaseAnswer, lang, decisionContext));
      return;
    }
    if (!userApi.configured) {
      setError(
        t(
          "真实研究服务当前未配置；仍可退出登录体验公开快照中的预置问题。",
          "Live research is not configured; sign out to try preset questions from the public snapshot.",
        ),
      );
      return;
    }
    submissionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setResearch(await userApi.research(token, { question, language: lang, decisionContext }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("研究请求失败。", "Research request failed."),
      );
    } finally {
      submissionInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title={t("AI 决策助手", "AI decision assistant")}
        subtitle={t(
          "告诉我你的任务、优先级、预算和部署限制。AI Radar 会基于当前版本、历史变化与官方 Evidence 给出有条件的选择建议，并明确哪些信息仍不足。",
          "Describe your task, priorities, budget, and deployment limits. AI Radar uses current releases, historical changes, and official evidence to make conditional recommendations and expose what remains unknown.",
        )}
      />

      <div className="page-container flex flex-wrap items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
        <span>
          {t(
            "建议问题包含：要完成什么任务、最重视什么、不能接受什么。",
            "A useful question names the job, the top priority, and the deal-breakers.",
          )}
        </span>
        <Link
          to="/compare"
          search={{ models: undefined }}
          className="inline-flex items-center gap-1.5 font-medium text-signal hover:underline"
        >
          <GitCompareArrows className="h-4 w-4" />
          {t("先看结构化对比", "Open structured comparison")}
        </Link>
      </div>

      {hydrated && !snapshotQuery.data && (
        <div className="page-container pt-2">
          <div className="rounded-md border border-signal/20 bg-accent/60 px-4 py-3 text-xs leading-6 text-muted-foreground">
            {t(
              snapshotQuery.error
                ? "实时接口暂时不可用，当前明确使用内置演示快照完成预置研究。"
                : "实时接口正在连接，当前可先使用内置演示快照体验预置研究。",
              snapshotQuery.error
                ? "The live API is temporarily unavailable; preset research explicitly uses the bundled demo snapshot."
                : "The live API is connecting; preset research can use the bundled demo snapshot now.",
            )}
          </div>
        </div>
      )}

      <div className="page-container grid gap-6 py-6 lg:grid-cols-[210px_minmax(0,1fr)_260px]">
        <ResearchSidebar questions={researchQuestions} onSelect={setTask} />
        <div className="min-w-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitResearch();
            }}
            className="paper-card flex flex-col gap-3 p-4"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-signal" />
              {t("描述你的选择问题", "Describe your decision")}
              {snapshot.meta.mode === "demo" && <DemoBadge className="ml-auto" />}
            </div>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                {t("要完成的任务", "Task to complete")}
              </span>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full resize-none rounded-md border border-border bg-background/60 px-3 py-2 text-base text-foreground focus:border-signal focus:outline-none"
                placeholder={t(
                  "例如：我要做长文档分析，预算优先、需要私有部署，应该先评估哪些模型？",
                  "Example: I am building long-document analysis, cost matters, and private deployment is required. Which models should I evaluate?",
                )}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <DecisionSelect
                label={t("首要优先级", "Top priority")}
                value={priority}
                onChange={(value) => setPriority(value as DecisionContext["priority"])}
                options={[
                  ["balanced", t("综合平衡", "Balanced")],
                  ["quality", t("效果质量", "Quality")],
                  ["cost", t("成本", "Cost")],
                  ["speed", t("速度", "Speed")],
                  ["privacy", t("隐私", "Privacy")],
                  ["control", t("可控性", "Control")],
                ]}
              />
              <DecisionSelect
                label={t("预算", "Budget")}
                value={budgetMode}
                onChange={(value) => setBudgetMode(value as DecisionContext["budget"]["mode"])}
                options={[
                  ["unknown", t("暂不确定", "Unknown")],
                  ["cost-first", t("成本优先", "Cost first")],
                  ["range", t("指定区间", "Set a range")],
                ]}
              />
              <DecisionSelect
                label={t("部署方式", "Deployment")}
                value={deployment}
                onChange={(value) => setDeployment(value as DecisionContext["deployment"])}
                options={[
                  ["undecided", t("暂不确定", "Undecided")],
                  ["cloud-api", t("云 API", "Cloud API")],
                  ["private", t("私有部署", "Private")],
                  ["on-device", t("端侧", "On-device")],
                  ["hybrid", t("混合", "Hybrid")],
                ]}
              />
            </div>
            {budgetMode === "range" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <DecisionInput
                  label={t("月预算下限（CNY）", "Monthly minimum (CNY)")}
                  value={budgetMinimum}
                  onChange={setBudgetMinimum}
                  type="number"
                />
                <DecisionInput
                  label={t("月预算上限（CNY）", "Monthly maximum (CNY)")}
                  value={budgetMaximum}
                  onChange={setBudgetMaximum}
                  type="number"
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <DecisionInput
                label={t("排除条件（逗号分隔）", "Exclusions (comma-separated)")}
                value={exclusions}
                onChange={setExclusions}
                maxLength={1000}
                placeholder={t(
                  "例如：不接受闭源、必须境内部署",
                  "Example: no closed source, regional hosting required",
                )}
              />
              <DecisionInput
                label={t("补充说明（可选）", "Notes (optional)")}
                value={notes}
                onChange={setNotes}
                maxLength={1000}
                placeholder={t(
                  "数据规模、团队能力、上线时间",
                  "Data scale, team skills, launch date",
                )}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {researchQuestions.map((question, index) => (
                <button
                  key={`${question.en}-${index}`}
                  type="button"
                  onClick={() => setTask(pick(question, lang))}
                  className="chip hover:border-signal/50 hover:text-foreground"
                >
                  {pick(question, lang)}
                </button>
              ))}
              <Button type="submit" className="ml-auto" disabled={busy}>
                <Send className="h-4 w-4" />{" "}
                {busy
                  ? t("检索中…", "Researching…")
                  : token
                    ? t("生成决策建议", "Generate recommendation")
                    : t("体验预置研究", "Run preset research")}
              </Button>
            </div>
            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
                {token && !userApi.configured && (
                  <Link to="/account" className="ml-2 font-medium underline">
                    {t("查看账户状态", "View account status")}
                  </Link>
                )}
              </div>
            )}
          </form>

          {research ? (
            <div className="mt-8 space-y-6">
              <div className="text-xs uppercase tracking-widest text-signal font-medium">
                {t("决策建议", "Recommendation")}
              </div>
              <p className="text-xl font-semibold leading-relaxed text-foreground">
                {research.summary}
              </p>

              <div className="paper-card space-y-2 p-4 text-sm">
                <div className="font-medium text-foreground">
                  {research.status === "ready"
                    ? t(
                        "已完成知识检索与引用校验",
                        "Reviewed knowledge retrieval and citation validation complete",
                      )
                    : t(
                        "证据不足，未生成推测性结论",
                        "Insufficient evidence; no speculative conclusion was generated",
                      )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {research.steps.map((step) => (
                    <span key={step.id}>
                      {pick(step.label, lang)} · {step.status}
                    </span>
                  ))}
                </div>
              </div>

              {research.decision && (
                <DecisionBrief
                  research={research}
                  entityName={(id) => {
                    const entity = snapshot.entities.find((item) => item.id === id);
                    return entity ? pick(entity.name, lang) : id;
                  }}
                  isComparable={(id) =>
                    snapshot.entities.some((item) => item.id === id && item.type === "model")
                  }
                />
              )}

              <AnswerBlock
                title={t("已核验事实", "Verified facts")}
                icon={<ShieldCheck className="h-4 w-4 text-verified" />}
                tint="verified"
              >
                {factClaims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    id={c.id}
                    zh={c.text.zh}
                    en={c.text.en}
                    sourceIds={c.sourceIds}
                    evidence={evidence}
                  />
                ))}
              </AnswerBlock>

              <AnswerBlock
                title={t("基于证据的推断", "Evidence-based inference")}
                icon={<Info className="h-4 w-4 text-inferred" />}
                tint="inferred"
              >
                {inferredClaims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    id={c.id}
                    zh={c.text.zh}
                    en={c.text.en}
                    sourceIds={c.sourceIds}
                    evidence={evidence}
                  />
                ))}
              </AnswerBlock>

              <AnswerBlock
                title={t("未核验或社区传闻", "Unverified / community rumors")}
                icon={<HelpCircle className="h-4 w-4 text-unverified" />}
                tint="unverified"
              >
                {unverifiedClaims.map((c) => (
                  <ClaimRow
                    key={c.id}
                    id={c.id}
                    zh={c.text.zh}
                    en={c.text.en}
                    sourceIds={c.sourceIds}
                    evidence={evidence}
                  />
                ))}
              </AnswerBlock>

              <div className="paper-card p-4 bg-accent/40 text-xs text-muted-foreground">
                {t(
                  "AI Radar 的回答仅基于已收录证据。若某项事实没有足够来源，AI 会明确说明「没有足够证据」，而不会自行编造。",
                  "Answers use only recorded evidence. When sources are insufficient, AI says so instead of inventing a conclusion.",
                )}
              </div>

              <div className="pt-4 flex flex-wrap gap-x-5 gap-y-2">
                {token ? (
                  <Link
                    to="/research/$id"
                    params={{ id: research.id }}
                    className="text-sm font-medium text-signal hover:underline"
                  >
                    {t("打开完整研究记录 →", "Open full research record →")}
                  </Link>
                ) : (
                  <Link to="/account" className="text-sm font-medium text-signal hover:underline">
                    {t(
                      "登录后创建并保存私密研究 →",
                      "Sign in to create and save private research →",
                    )}
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
          ) : (
            <div className="paper-card mt-8 p-6 text-sm leading-relaxed text-muted-foreground">
              {t(
                "输入问题后，AI Radar 会先检索已审核知识，并仅输出带来源的结论；缺少证据时会明确拒答。",
                "After you submit a question, AI Radar searches reviewed knowledge and returns only sourced conclusions; it explicitly declines when evidence is missing.",
              )}
            </div>
          )}
        </div>
        <EvidenceSidebar evidence={evidence} />
      </div>
    </AppShell>
  );
}

function composeDecisionQuestion(context: DecisionContext, lang: "zh" | "en") {
  const exclusions = context.exclusions.length ? context.exclusions.join(", ") : "none";
  return lang === "zh"
    ? `${context.task}\n优先级：${context.priority}；预算：${context.budget.mode}；部署：${context.deployment}；排除：${exclusions}${context.notes ? `；补充：${context.notes}` : ""}`
    : `${context.task}\nPriority: ${context.priority}; budget: ${context.budget.mode}; deployment: ${context.deployment}; exclusions: ${exclusions}${context.notes ? `; notes: ${context.notes}` : ""}`;
}

function toShowcaseResearch(
  answer: ResearchAnswer,
  lang: "zh" | "en",
  context?: DecisionContext,
): ResearchResult {
  return {
    id: answer.id,
    question: pick(answer.question, lang),
    summary: pick(answer.summary, lang),
    claimIds: answer.claimIds,
    steps: answer.steps,
    status: answer.status,
    retrievalMode: "lexical",
    answerMode: "extractive",
    retrievalDiagnostics: {
      candidateCount: answer.claimIds.length,
      returnedCount: answer.claimIds.length,
      filteredCount: 0,
      elapsedMs: 0,
      matchedEntityIds: [],
      fallbackReason: "demo-snapshot",
      generationFallbackReason: "generation-disabled",
    },
    ...(context
      ? {
          decisionContext: context,
          decision: {
            status: answer.status === "ready" ? "ready" : "insufficient-evidence",
            asOf: answer.generatedAt,
            recommendation: {
              alternativeEntityIds: [],
              summary: pick(answer.summary, lang),
            },
            conditions: [
              `${lang === "zh" ? "任务" : "Task"}: ${context.task}`,
              `${lang === "zh" ? "优先级" : "Priority"}: ${context.priority}`,
              `${lang === "zh" ? "部署" : "Deployment"}: ${context.deployment}`,
            ],
            tradeoffs: [],
            risks: [
              {
                state: "inferred" as const,
                detail:
                  lang === "zh"
                    ? "公开演示仅覆盖预置问题与快照证据。"
                    : "The public demo covers only preset questions and snapshot evidence.",
                claimIds: answer.claimIds,
              },
            ],
            nextChecks: [
              lang === "zh"
                ? "登录后使用实时研究服务，并用真实样本进行 PoC。"
                : "Sign in for live research and run a proof of concept on representative samples.",
            ],
            claimIds: answer.claimIds,
          },
        }
      : {}),
    createdAt: answer.generatedAt,
  };
}

function DecisionSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-base text-foreground focus:border-signal focus:outline-none sm:text-sm"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function DecisionInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  maxLength?: number;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? 1_000_000_000_000 : undefined}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus:border-signal focus:outline-none sm:text-sm"
      />
    </label>
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
  const surface = {
    verified: "border-verified/40 bg-verified/5",
    inferred: "border-inferred/40 bg-inferred/5",
    unverified: "border-border-strong bg-muted/20",
    conflict: "border-conflict/40 bg-conflict/5",
  }[tint];
  return (
    <section className={`rounded-md border px-5 py-4 ${surface}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-semibold text-foreground">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
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
        <History className="h-3.5 w-3.5" /> {t("决策问题", "Decision questions")}
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
  id,
  zh,
  en,
  sourceIds,
  evidence,
}: {
  id: string;
  zh: string;
  en: string;
  sourceIds: string[];
  evidence: Evidence[];
}) {
  const { lang } = useApp();
  return (
    <div id={`claim-${id}`} className="scroll-mt-24">
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
