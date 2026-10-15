import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Send, ShieldCheck, Info, HelpCircle, ExternalLink, GitCompareArrows } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceHeader, DemoBadge } from "@/components/common";
import { useApp, pick } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import type { Evidence, ResearchAnswer } from "@/domain/types";
import { SourceExcerpt } from "@/components/research/SourceExcerpt";
import { selectResearchEvidence } from "@/domain/research-evidence";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { knowledgeRepository } from "@/services/knowledge-repository";
import { authSessionExpiredEvent, readAuthToken } from "@/services/auth-session";
import { accountErrorMessage } from "@/services/auth-errors";
import {
  AuthSessionExpiredError,
  userApi,
  type DecisionContext,
  type ResearchResult,
} from "@/services/user-api";
import { DecisionBrief } from "@/components/research/DecisionBrief";
import { DecisionGuide } from "@/components/research/DecisionGuide";
import { describedPriority } from "@/domain/decision-presentation";
import {
  decisionFingerprint,
  matchesDecisionFingerprint,
  decisionInputConflicts,
  interpretDecisionTask,
  decisionScenario,
  decisionResumePath,
} from "@/domain/decision-workflow";
import { DecisionValidationPanel } from "@/components/research/DecisionValidationPanel";
import {
  decisionExamples,
  decisionStarters,
  decisionExampleContext,
} from "@/domain/decision-examples";

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
    ? (snapshotQuery.data ?? (knowledgeRepository.mode === "demo" ? DEMO_KNOWLEDGE_SNAPSHOT : null))
    : knowledgeRepository.mode === "demo"
      ? DEMO_KNOWLEDGE_SNAPSHOT
      : null;
  const showcaseAnswers = snapshot?.researchAnswers ?? [];
  const [token, setToken] = useState("");
  const [task, setTask] = useState("");
  const [priority, setPriority] = useState<DecisionContext["priority"]>("balanced");
  const [budgetMode, setBudgetMode] = useState<DecisionContext["budget"]["mode"]>("unknown");
  const [budgetMinimum, setBudgetMinimum] = useState("");
  const [budgetMaximum, setBudgetMaximum] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [channel, setChannel] = useState("");
  const [serviceChannel, setServiceChannel] = useState("");
  const [serviceTier, setServiceTier] = useState<"paid" | "free" | "unknown">("unknown");
  const [serviceRegion, setServiceRegion] = useState("");
  const [costScope, setCostScope] =
    useState<NonNullable<DecisionContext["budget"]["costScope"]>>("all-costs");
  const [inputTokens, setInputTokens] = useState("");
  const [maximumInputPerRequest, setMaximumInputPerRequest] = useState("");
  const [outputTokens, setOutputTokens] = useState("");
  const [taskType, setTaskType] = useState<NonNullable<DecisionContext["taskType"]>>("unspecified");
  const [deployment, setDeployment] = useState<DecisionContext["deployment"]>("undecided");
  const [exclusions, setExclusions] = useState("");
  const [notes, setNotes] = useState("");
  const [candidateEntityIds, setCandidateEntityIds] = useState<string[]>([]);
  const [region, setRegion] = useState("");
  const [minimumContext, setMinimumContext] = useState("");
  const [inputModalities, setInputModalities] = useState<
    NonNullable<DecisionContext["inputModalities"]>
  >([]);
  const [commercialUse, setCommercialUse] = useState(false);
  const [preparedDecision, setPreparedDecision] = useState<{
    context: DecisionContext;
    fingerprint: string;
  } | null>(null);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const submissionInFlight = useRef(false);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    setToken(readAuthToken());
    const handleSessionExpired = () => setToken("");
    window.addEventListener(authSessionExpiredEvent, handleSessionExpired);
    return () => window.removeEventListener(authSessionExpiredEvent, handleSessionExpired);
  }, []);

  useEffect(() => {
    let draftSearch = window.location.search;
    if (!draftSearch) {
      try {
        const saved = window.sessionStorage.getItem("ai-radar-decision-draft-v1");
        if (saved?.startsWith("/ask?")) draftSearch = saved.slice(4);
      } catch {
        // Storage may be disabled; URL-based login recovery still works.
      }
    }
    const sharedSearch = new URLSearchParams(draftSearch);
    const sharedTask = sharedSearch.get("task")?.trim();
    if (sharedTask) {
      setTask(sharedTask);
    }
    const sharedPriority = sharedSearch.get("priority");
    if (isDecisionPriority(sharedPriority)) setPriority(sharedPriority);
    const sharedBudgetMode = sharedSearch.get("budget");
    if (isBudgetMode(sharedBudgetMode)) setBudgetMode(sharedBudgetMode);
    setBudgetMinimum(sharedSearch.get("budgetMin") ?? "");
    setBudgetMaximum(sharedSearch.get("budgetMax") ?? "");
    setCurrency(sharedSearch.get("currency") === "USD" ? "USD" : "CNY");
    setChannel(sharedSearch.get("channel") ?? "");
    setCostScope(
      sharedSearch.get("costScope") === "standard-token-only" ? "standard-token-only" : "all-costs",
    );
    setInputTokens(sharedSearch.get("inputTokens") ?? "");
    setMaximumInputPerRequest(sharedSearch.get("maximumInputPerRequest") ?? "");
    setOutputTokens(sharedSearch.get("outputTokens") ?? "");
    const sharedTaskType = sharedSearch.get("taskType");
    if (
      ["model-api", "coding-product", "agent-development", "unspecified"].includes(
        sharedTaskType ?? "",
      )
    )
      setTaskType(sharedTaskType as NonNullable<DecisionContext["taskType"]>);
    const sharedDeployment = sharedSearch.get("deployment");
    if (isDeployment(sharedDeployment)) setDeployment(sharedDeployment);
    setExclusions(sharedSearch.get("exclusions") ?? "");
    setNotes(sharedSearch.get("notes") ?? "");
    setRegion(sharedSearch.get("region") ?? "");
    setMinimumContext(sharedSearch.get("minimumContext") ?? "");
    setInputModalities(
      (sharedSearch.get("modalities") ?? "")
        .split(",")
        .filter((item): item is "text" | "image" | "audio" | "video" =>
          ["text", "image", "audio", "video"].includes(item),
        ),
    );
    setCommercialUse(sharedSearch.get("commercialUse") === "true");
    setServiceChannel(sharedSearch.get("serviceChannel") ?? "");
    const restoredTier = sharedSearch.get("serviceTier");
    setServiceTier(restoredTier === "paid" || restoredTier === "free" ? restoredTier : "unknown");
    setServiceRegion(sharedSearch.get("serviceRegion") ?? "");
    setCandidateEntityIds(
      (sharedSearch.get("candidates") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20),
    );
    setDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!draftRestored) return;
    try {
      window.sessionStorage.setItem(
        "ai-radar-decision-draft-v1",
        buildAskResumePath({
          task,
          priority,
          budgetMode,
          budgetMinimum,
          budgetMaximum,
          currency,
          channel,
          costScope,
          inputTokens,
          maximumInputPerRequest,
          outputTokens,
          taskType,
          deployment,
          exclusions,
          notes,
          candidateEntityIds,
          region,
          minimumContext,
          inputModalities,
          commercialUse,
          serviceChannel,
          serviceTier,
          serviceRegion,
        }),
      );
    } catch {
      // A denied storage write must not prevent submitting a decision.
    }
  }, [
    draftRestored,
    task,
    priority,
    budgetMode,
    budgetMinimum,
    budgetMaximum,
    currency,
    channel,
    costScope,
    inputTokens,
    maximumInputPerRequest,
    outputTokens,
    taskType,
    deployment,
    exclusions,
    notes,
    candidateEntityIds,
    region,
    minimumContext,
    inputModalities,
    commercialUse,
    serviceChannel,
    serviceTier,
    serviceRegion,
  ]);

  const { claims: matchedClaims, evidence } = selectResearchEvidence(
    research,
    snapshot?.claims ?? [],
    snapshot?.evidence ?? [],
  );
  const factClaims = matchedClaims.filter((c) => c.confidence === "verified");
  const inferredClaims = matchedClaims.filter((c) => c.confidence === "inferred");
  const unverifiedClaims = matchedClaims.filter((c) => c.confidence === "unverified");
  const candidateTypes =
    taskType === "unspecified"
      ? ["model", "api", "application", "tool", "agent", "framework"]
      : taskType === "model-api"
        ? ["model", "api"]
        : taskType === "coding-product"
          ? ["application", "tool", "agent"]
          : ["framework", "agent"];
  const selectableCandidates = (snapshot?.entities ?? []).filter(
    (entity) =>
      candidateTypes.includes(entity.type) &&
      !candidateEntityIds.includes(entity.id) &&
      (entity.type !== "model" || Boolean(entity.familyId)),
  );

  const currentContext: DecisionContext = {
    workflowVersion: 2,
    taskType,
    task: task.trim(),
    priority,
    deployment,
    budget: {
      mode: budgetMode,
      ...(budgetMode === "range"
        ? {
            currency,
            channel: channel.trim(),
            costScope,
            period: "month" as const,
            ...(budgetMinimum ? { min: Number(budgetMinimum) } : {}),
            ...(budgetMaximum ? { max: Number(budgetMaximum) } : {}),
            ...(inputTokens ? { monthlyInputTokens: Number(inputTokens) } : {}),
            ...(maximumInputPerRequest
              ? { maximumInputTokensPerRequest: Number(maximumInputPerRequest) }
              : {}),
            ...(outputTokens ? { monthlyOutputTokens: Number(outputTokens) } : {}),
          }
        : {}),
    },
    exclusions: exclusions
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean),
    candidateEntityIds,
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    ...(region.trim() ? { region: region.trim() } : {}),
    ...(minimumContext ? { minimumContextTokens: Number(minimumContext) } : {}),
    inputModalities,
    commercialUseRequired: commercialUse,
    ...(commercialUse && serviceChannel.trim()
      ? {
          serviceAccess: {
            channel: serviceChannel.trim(),
            tier: serviceTier,
            ...(serviceRegion.trim() ? { region: serviceRegion.trim().toUpperCase() } : {}),
          },
        }
      : {}),
  };
  const currentFingerprint = decisionFingerprint(currentContext);
  const scenario = decisionScenario(preparedDecision?.context ?? currentContext, lang);
  const appliedLimits = [
    deployment !== "undecided"
      ? {
          "cloud-api": t("云 API", "Cloud API"),
          private: t("私有部署", "Private hosting"),
          "on-device": t("端侧运行", "On-device"),
          hybrid: t("混合部署", "Hybrid"),
        }[deployment]
      : "",
    region ? t(`部署地区 ${region}`, `Hosting region ${region}`) : "",
    minimumContext
      ? t(
          `单次输入至少 ${Number(minimumContext).toLocaleString(lang)} token`,
          `Minimum input ${Number(minimumContext).toLocaleString(lang)} tokens`,
        )
      : "",
    inputModalities.length
      ? t("必须接收：", "Required inputs: ") +
        inputModalities
          .map(
            (value) =>
              ({
                text: t("文本", "Text"),
                image: t("图像", "Image"),
                audio: t("音频", "Audio"),
                video: t("视频", "Video"),
              })[value],
          )
          .join("、")
      : "",
    commercialUse ? t("可核验的商用许可", "Verified commercial permission") : "",
    budgetMode === "range"
      ? t(
          `月预算上限 ${currency} ${budgetMaximum || "待补充"}`,
          `Monthly ceiling ${currency} ${budgetMaximum || "to specify"}`,
        )
      : "",
    exclusions ? t(`排除：${exclusions}`, `Exclude: ${exclusions}`) : "",
    candidateEntityIds.length
      ? t(
          `固定比较 ${candidateEntityIds.length} 个产品`,
          `Fixed scope: ${candidateEntityIds.length} products`,
        )
      : "",
  ].filter(Boolean);
  const described = interpretDecisionTask({ ...currentContext, minimumContextTokens: undefined });
  const taskPriority = describedPriority(task);
  const contextDiffers =
    !!described.minimumContextTokens &&
    !!currentContext.minimumContextTokens &&
    described.minimumContextTokens !== currentContext.minimumContextTokens;
  useEffect(() => {
    if (!draftRestored || !token || research) return;
    let cancelled = false;
    try {
      const stored = JSON.parse(
        window.sessionStorage.getItem("ai-radar-decision-result-v1") ?? "null",
      ) as { id?: string; fingerprint?: string; scroll?: number } | null;
      if (stored?.id && matchesDecisionFingerprint(stored.fingerprint, currentFingerprint)) {
        userApi
          .researchDetail(token, stored.id)
          .then((value) => {
            if (cancelled) return;
            setResearch(value);
            if (value.decisionContext)
              setPreparedDecision({
                context: value.decisionContext,
                fingerprint: decisionFingerprint(value.decisionContext),
              });
            if (typeof stored.scroll === "number")
              window.requestAnimationFrame(() => window.scrollTo({ top: stored.scroll }));
          })
          .catch(() => {
            /* Current owner and citation checks remain authoritative. */
          });
      }
    } catch {
      /* Denied storage does not block analysis. */
    }
    return () => {
      cancelled = true;
    };
  }, [draftRestored, token, currentFingerprint, research]);
  function rememberResultScroll() {
    try {
      const stored = JSON.parse(
        window.sessionStorage.getItem("ai-radar-decision-result-v1") ?? "null",
      );
      if (stored)
        window.sessionStorage.setItem(
          "ai-radar-decision-result-v1",
          JSON.stringify({ ...stored, scroll: window.scrollY }),
        );
    } catch {
      /* Storage is optional. */
    }
  }
  useEffect(() => {
    if (preparedDecision && preparedDecision.fingerprint !== currentFingerprint)
      setPreparedDecision(null);
  }, [preparedDecision, currentFingerprint]);

  const submitResearch = async () => {
    if (submissionInFlight.current) return;
    const normalizedTask = task.trim();
    if (normalizedTask.length < 5) {
      setError(
        t("请用至少 5 个字符描述任务。", "Please describe the task with at least 5 characters."),
      );
      return;
    }
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
    const decisionContext = currentContext;
    if (
      commercialUse &&
      serviceChannel.trim() &&
      serviceRegion.trim() &&
      !/^[A-Z]{2}$/.test(serviceRegion.trim().toUpperCase())
    ) {
      setError(
        t(
          "服务使用国家请填写两位代码（例如 CN、US），不确定时留空。此项不是数据存储地区。",
          "Use a two-letter country code (for example CN or US), or leave it blank if unknown. This is not data residency.",
        ),
      );
      return;
    }
    const inputConflicts = decisionInputConflicts(decisionContext);
    if (inputConflicts.length) {
      setError(
        inputConflicts.includes("service-channel")
          ? t(
              "实际服务渠道与预算计费渠道不同，请填写同一实际渠道。原厂报价不能用于判断网关费用。",
              "Service and billing channels differ. Enter the same actual channel; direct supplier prices cannot establish gateway costs.",
            )
          : t(
              "任务描述与结构化条件不一致，请先修改部署方式、上下文或预算，再确认。",
              "The task and structured constraints disagree. Align deployment, context or budget before confirming.",
            ),
      );
      setPreparedDecision(null);
      return;
    }
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
    if (!preparedDecision || preparedDecision.fingerprint !== currentFingerprint) {
      const interpreted = interpretDecisionTask(decisionContext);
      setDeployment(interpreted.deployment);
      if (interpreted.taskType) setTaskType(interpreted.taskType);
      setBudgetMode(interpreted.budget.mode);
      if (interpreted.budget.max !== undefined) setBudgetMaximum(String(interpreted.budget.max));
      if (interpreted.budget.currency) setCurrency(interpreted.budget.currency);
      if (interpreted.minimumContextTokens !== undefined)
        setMinimumContext(String(interpreted.minimumContextTokens));
      setInputModalities(interpreted.inputModalities ?? []);
      setCommercialUse(Boolean(interpreted.commercialUseRequired));
      setPreparedDecision({ context: interpreted, fingerprint: decisionFingerprint(interpreted) });
      setError("");
      return;
    }
    if (!token) {
      const showcaseAnswer = showcaseAnswers.find(
        (answer) => pick(answer.question, lang) === normalizedTask,
      );
      if (!showcaseAnswer) {
        setResearch(null);
        setSessionExpired(true);
        setError(
          t(
            "请登录后核验自定义业务与条件；当前未提交实际研究，输入会在登录后恢复。",
            "Sign in to evaluate this custom scenario and its constraints. No research was submitted; your inputs will resume after login.",
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
    setSessionExpired(false);
    try {
      const result = await userApi.research(token, { question, language: lang, decisionContext });
      setResearch(result);
      try {
        window.sessionStorage.setItem(
          "ai-radar-decision-result-v1",
          JSON.stringify({ id: result.id, fingerprint: decisionFingerprint(decisionContext) }),
        );
      } catch {
        /* Storage is optional. */
      }
    } catch (reason) {
      setResearch(null);
      const expired = reason instanceof AuthSessionExpiredError;
      setSessionExpired(expired);
      setError(
        expired
          ? t(
              "登录已过期，请重新登录后继续。当前输入会保留。",
              "Your session expired. Sign in to continue; your inputs will be preserved.",
            )
          : accountErrorMessage(reason, t),
      );
    } finally {
      submissionInFlight.current = false;
      setBusy(false);
    }
  };

  const applyExample = (example: (typeof decisionExamples)[number]) => {
    const context = decisionExampleContext(example, lang);
    setTask(context.task);
    setTaskType(context.taskType ?? "unspecified");
    setPriority(context.priority);
    setDeployment(context.deployment);
    setBudgetMode(context.budget.mode);
    setBudgetMinimum("");
    setBudgetMaximum("");
    setCurrency("CNY");
    setChannel("");
    setCostScope("all-costs");
    setInputTokens("");
    setMaximumInputPerRequest("");
    setOutputTokens("");
    setMinimumContext(context.minimumContextTokens ? String(context.minimumContextTokens) : "");
    setInputModalities(context.inputModalities ?? []);
    setRegion("");
    setCommercialUse(false);
    setExclusions("");
    setNotes("");
    setCandidateEntityIds([]);
    setPreparedDecision(null);
    setError("");
  };

  return (
    <AppShell>
      <div className="ask-page workspace-page">
        <WorkspaceHeader
          title={t("决策助手", "Decision assistant")}
          description={t(
            "结合任务、预算与部署限制，从现有证据中找到适合的选择。",
            "Find suitable options from recorded evidence, your task, budget and deployment limits.",
          )}
          actions={
            snapshot ? (
              <DemoBadge mode={snapshot.meta.mode} updatedAt={snapshot.meta.retrievedAt} />
            ) : undefined
          }
        />

        <div className="ask-container page-container flex flex-wrap items-center justify-between gap-3 pt-1 text-sm text-muted-foreground">
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
                  ? "实时接口暂时不可用，请重试；当前无法核验事实。"
                  : "实时接口正在连接，请等待当前事实加载。",
                snapshotQuery.error
                  ? "The live API is unavailable. Retry to verify current facts."
                  : "Connecting to the live API. Waiting for current facts.",
              )}
            </div>
          </div>
        )}

        <div
          className={`ask-container page-container grid gap-5 py-6 ${research && !research.decision ? "lg:grid-cols-[minmax(0,1fr)_17rem]" : ""}`}
        >
          <div className="ask-workflow min-w-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitResearch();
              }}
              className="ask-form paper-card flex flex-col gap-3 p-5"
            >
              <section
                className="decision-start"
                aria-label={t("从任务开始", "Start with your task")}
              >
                <h2>{t("你想用 AI 做什么？", "What do you want AI to do?")}</h2>
                <p>
                  {t(
                    "选一个场景开始，也可以直接写下你的任务。先看可用选项，再用实际任务验证。",
                    "Start with a scenario or describe your task. Find usable options, then validate them on your work.",
                  )}
                </p>
                <div className="decision-start__scenarios">
                  {decisionStarters.map((example) => (
                    <button
                      key={example.id}
                      type="button"
                      disabled={busy}
                      onClick={() => applyExample(example)}
                    >
                      {example.label[lang]}
                    </button>
                  ))}
                </div>
              </section>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">
                  {t("描述你的任务", "Describe your task")}
                </span>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full resize-none rounded-md border border-border bg-background/60 px-3 py-2 text-base text-foreground focus:border-signal focus:outline-none"
                  placeholder={t(
                    "例如：我想让 AI 回答公司文档里的问题，并告诉我答案来自哪里。",
                    "Example: Answer questions about company documents and show where the answers come from.",
                  )}
                />
              </label>
              <details className="decision-preferences decision-more-conditions" lang={lang}>
                <summary>
                  {t("限制与偏好（可选）", "Limits and preferences (optional)")}
                  {!!appliedLimits.length && (
                    <span className="decision-preferences__count">
                      {t(`已设置 ${appliedLimits.length} 项`, `${appliedLimits.length} set`)}
                    </span>
                  )}
                </summary>
                <p className="decision-preferences__hint">
                  {t(
                    "不确定可以留空。只填写真正影响选择的条件；指定预算或部署方式后，会按这些条件核验。",
                    "Leave uncertain requirements open. Set only limits that affect your choice; stated budgets and deployment requirements will be checked.",
                  )}
                </p>
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
                      label={t("月预算下限", "Monthly minimum")}
                      value={budgetMinimum}
                      onChange={setBudgetMinimum}
                      type="number"
                    />
                    <DecisionInput
                      label={t("月预算上限", "Monthly maximum")}
                      value={budgetMaximum}
                      onChange={setBudgetMaximum}
                      type="number"
                    />
                    <DecisionSelect
                      label={t("预算币种", "Currency")}
                      value={currency}
                      onChange={setCurrency}
                      options={[
                        ["unspecified", t("按场景识别", "Infer from scenario")],
                        ["CNY", "CNY"],
                        ["USD", "USD"],
                      ]}
                    />
                    <DecisionInput
                      label={t("计费渠道", "Billing channel")}
                      value={channel}
                      onChange={setChannel}
                      placeholder={t("例如官方 API", "For example, official API")}
                    />
                    <DecisionInput
                      label={t("每月输入 token", "Monthly input tokens")}
                      value={inputTokens}
                      onChange={setInputTokens}
                      type="number"
                    />
                    <DecisionInput
                      label={t("每月输出 token", "Monthly output tokens")}
                      value={outputTokens}
                      onChange={setOutputTokens}
                      type="number"
                    />
                    <DecisionSelect
                      label={t("预算核算范围", "Cost scope")}
                      value={costScope}
                      onChange={(value) =>
                        setCostScope(value as NonNullable<DecisionContext["budget"]["costScope"]>)
                      }
                      options={[
                        [
                          "all-costs",
                          t(
                            "全部费用（含工具与其他支出）",
                            "All costs, including tools and other charges",
                          ),
                        ],
                        [
                          "standard-token-only",
                          t("仅 Standard 模型 token 费用", "Standard model tokens only"),
                        ],
                      ]}
                    />
                    <DecisionInput
                      label={t(
                        "每个请求最多输入 token（可选）",
                        "Maximum input tokens per request (optional)",
                      )}
                      value={maximumInputPerRequest}
                      onChange={setMaximumInputPerRequest}
                      type="number"
                      placeholder={t(
                        "确定时填写；用于核验长上下文价格档位",
                        "Specify if known; checks long-context price tiers",
                      )}
                    />
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      {t(
                        "仅 token 核算不包含缓存、检索/地图工具、税费或第三方加价；输出量须包含计费的思考 token。分档价格以区间核算，不能当成一个固定单价。",
                        "Token-only estimates exclude caching, search/maps tools, tax and reseller charges. Include billed thinking tokens in output workload. Tiered rates are estimated as ranges, not a single flat price.",
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      {t(
                        "缺少工作量、渠道或同币种已核验价格时，预算适配保持未知。",
                        "Budget fit remains unknown without workload, channel and verified prices in the same currency.",
                      )}
                    </p>
                  </div>
                )}
                <details className="decision-more-conditions">
                  <summary>
                    {t("高级筛选与指定产品", "Advanced filters and exact products")}
                  </summary>
                  <div className="grid gap-3 pt-4 sm:grid-cols-2">
                    <DecisionSelect
                      label={t("选型任务", "Selection task")}
                      value={taskType}
                      onChange={(value) => {
                        setTaskType(value as NonNullable<DecisionContext["taskType"]>);
                        setCandidateEntityIds([]);
                      }}
                      options={[
                        ["unspecified", t("按业务用途识别", "Infer from business use")],
                        ["model-api", t("模型 API", "Model API")],
                        ["coding-product", t("编码产品", "Coding product")],
                        ["agent-development", t("Agent 开发", "Agent development")],
                      ]}
                    />
                    <DecisionInput
                      label={t("部署地区（可选）", "Hosting region (optional)")}
                      value={region}
                      onChange={setRegion}
                      placeholder={t(
                        "例如 CN；须有对应已核验事实",
                        "For example CN; requires verified facts",
                      )}
                      maxLength={100}
                    />
                    <DecisionInput
                      label={t("最低上下文 token（可选）", "Minimum context tokens (optional)")}
                      value={minimumContext}
                      onChange={setMinimumContext}
                      type="number"
                      helper={t(
                        "100k = 100000；2000000 = 200万。按单次输入容量核验。",
                        "100k = 100000; 2000000 is two million. Checked against input capacity per request.",
                      )}
                    />
                    <fieldset className="decision-input-modalities">
                      <legend className="mb-2 text-xs font-medium">
                        {t("必须支持的输入", "Required inputs")}
                      </legend>
                      {(
                        [
                          ["text", "文本", "Text"],
                          ["image", "图像", "Image"],
                          ["audio", "音频", "Audio"],
                          ["video", "视频", "Video"],
                        ] as const
                      ).map(([value, zh, en]) => (
                        <label key={value} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={inputModalities.includes(value)}
                            onChange={(event) =>
                              setInputModalities(
                                event.target.checked
                                  ? [...inputModalities, value]
                                  : inputModalities.filter((item) => item !== value),
                              )
                            }
                          />
                          {t(zh, en)}
                        </label>
                      ))}
                    </fieldset>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={commercialUse}
                        onChange={(event) => setCommercialUse(event.target.checked)}
                      />
                      {t("必须有可核验的商用许可", "Require verified commercial-use permission")}
                    </label>
                    {commercialUse && (
                      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                        <legend className="mb-2 text-sm font-medium">
                          {t("核对实际使用的服务", "Verify the service you actually use")}
                        </legend>
                        <DecisionInput
                          label={t("实际服务渠道", "Actual service channel")}
                          value={serviceChannel}
                          onChange={setServiceChannel}
                          placeholder={t(
                            "例如 Google Gemini Developer API；网关请写实际名称",
                            "For example Google Gemini Developer API; name your gateway when applicable",
                          )}
                        />
                        <DecisionSelect
                          label={t("该服务的账户层级", "Account tier for this service")}
                          value={serviceTier}
                          onChange={(value) => setServiceTier(value as typeof serviceTier)}
                          options={[
                            ["unknown", t("尚未确认", "Not confirmed")],
                            ["paid", t("付费服务", "Paid service")],
                            ["free", t("免费服务", "Free service")],
                          ]}
                        />
                        <DecisionInput
                          label={t(
                            "服务使用国家（两位代码）",
                            "Country of service use (two-letter code)",
                          )}
                          value={serviceRegion}
                          onChange={setServiceRegion}
                          placeholder={t(
                            "例如 CN、US；不确定可留空",
                            "For example CN or US; leave blank if unknown",
                          )}
                        />
                        <p className="text-sm text-muted-foreground sm:col-span-2">
                          {t(
                            "使用国家与数据存储地区不同。网关付费不等于原厂付费账户，原厂条款不能证明第三方网关或你的全部业务合规。",
                            "Country of service use is distinct from data residency. Paying a gateway does not establish a paid vendor account; vendor terms do not verify a third-party gateway or every condition of your business.",
                          )}
                        </p>
                      </fieldset>
                    )}
                  </div>
                  <div className="space-y-2 pt-4">
                    <DecisionSelect
                      label={t("具体版本或产品（可选）", "Exact version or product (optional)")}
                      value=""
                      onChange={(value) => {
                        if (value && candidateEntityIds.length < 20)
                          setCandidateEntityIds([...candidateEntityIds, value]);
                      }}
                      options={[
                        ["", t("添加同类候选", "Add a candidate of the same type")],
                        ...selectableCandidates.map((entity): [string, string] => [
                          entity.id,
                          pick(entity.name, lang),
                        ]),
                      ]}
                    />
                    <div className="flex flex-wrap gap-2">
                      {candidateEntityIds.map((id) => {
                        const entity = snapshot?.entities.find((item) => item.id === id);
                        return (
                          <Button
                            key={id}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCandidateEntityIds(
                                candidateEntityIds.filter((item) => item !== id),
                              )
                            }
                            aria-label={t(
                              `移除候选 ${entity ? pick(entity.name, lang) : id}`,
                              `Remove candidate ${entity ? pick(entity.name, lang) : id}`,
                            )}
                          >
                            {entity
                              ? pick(entity.name, lang)
                              : t("候选不可用", "Unavailable candidate")}{" "}
                            ×
                          </Button>
                        );
                      })}
                    </div>
                  </div>
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
                </details>
                {taskType === "coding-product" &&
                  (minimumContext || deployment === "cloud-api") && (
                    <div className="decision-input-notice" role="status">
                      <strong>
                        {t("请核对编码产品的使用条件", "Review coding product constraints")}
                      </strong>
                      <p>
                        {t(
                          "模型的上下文容量不等于仓库大小；云端编码任务也不等于模型 API。这些字段会继续作为硬条件核验。如果沿用了上一题的条件，请明确修改。",
                          "Model context is not repository size; cloud coding tasks are not model API access. These fields remain enforced constraints. Explicitly revise values inherited from a previous question.",
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setMinimumContext("");
                          setDeployment("undecided");
                        }}
                      >
                        {t(
                          "清除上下文和部署限制，按编码产品功能比较",
                          "Clear context and deployment limits; compare product features",
                        )}
                      </button>
                    </div>
                  )}
                {(contextDiffers || (taskPriority && taskPriority !== priority)) && (
                  <div className="decision-input-notice" role="status">
                    <strong>
                      {t(
                        "文字描述与表单不同，本次按确认表单核验。",
                        "The task and form differ; analysis uses the confirmed form.",
                      )}
                    </strong>
                    {contextDiffers && (
                      <p>
                        {t(
                          `文字描述至少 ${described.minimumContextTokens!.toLocaleString(lang)} token；表单为 ${currentContext.minimumContextTokens!.toLocaleString(lang)} token。`,
                          `The task requests at least ${described.minimumContextTokens!.toLocaleString(lang)} tokens; the form sets ${currentContext.minimumContextTokens!.toLocaleString(lang)} tokens.`,
                        )}
                        <button
                          type="button"
                          onClick={() => setMinimumContext(String(described.minimumContextTokens))}
                        >
                          {t(
                            "使用文字描述的上下文要求",
                            "Use the context requirement from the task",
                          )}
                        </button>
                      </p>
                    )}
                    {taskPriority && taskPriority !== priority && (
                      <p>
                        {t(
                          "文字描述的优先项与当前选择不同。",
                          "The task priority differs from the selected priority.",
                        )}
                        <button type="button" onClick={() => setPriority(taskPriority)}>
                          {t("使用文字描述的优先项", "Use the priority from the task")}
                        </button>
                      </p>
                    )}
                  </div>
                )}
                <div className="decision-examples" aria-label={t("示例场景", "Example scenarios")}>
                  <span>{t("有明确限制？使用模板", "Have specific limits? Use a template")}</span>
                  {decisionExamples.map((example) => (
                    <button
                      key={example.id}
                      type="button"
                      disabled={busy}
                      onClick={() => applyExample(example)}
                      title={example.task[lang]}
                    >
                      {example.label[lang]}
                    </button>
                  ))}
                </div>
                <DecisionGuide kind="inputs" />
              </details>
              <div className="decision-example-actions">
                {!preparedDecision && (
                  <Button type="submit" className="ml-auto" disabled={busy}>
                    <Send className="h-4 w-4" />{" "}
                    {busy
                      ? t("检索中…", "Researching…")
                      : !preparedDecision
                        ? t("下一步：核对任务", "Next: review your task")
                        : token
                          ? t("生成决策建议", "Generate recommendation")
                          : t("体验预置研究", "Run preset research")}
                  </Button>
                )}
              </div>
              {preparedDecision && (
                <section
                  className="decision-confirmation"
                  aria-label={t("确认本次决策条件", "Confirm decision conditions")}
                >
                  <h2>{t("按这个任务帮你筛选", "Find options for this task")}</h2>
                  <p>
                    {t(
                      "请核对下面的任务。需要改变限制，可以展开上方“限制与偏好”；不确定的条件不会替你假设。",
                      "Check the task below. Open Limits and preferences to change requirements. Uncertain limits are not assumed.",
                    )}
                  </p>
                  <p className="decision-confirmation__task">{preparedDecision.context.task}</p>
                  <p>
                    {t("将查找：", "Find: ")}
                    {scenario.name} · {t("优先关注：", "Focus: ")}
                    {
                      {
                        balanced: t("综合平衡", "Balanced"),
                        quality: t("任务效果", "Task quality"),
                        cost: t("费用", "Cost"),
                        speed: t("速度", "Speed"),
                        privacy: t("隐私", "Privacy"),
                        control: t("可控性", "Control"),
                      }[priority]
                    }
                  </p>
                  {appliedLimits.length ? (
                    <p className="decision-confirmation__limits">
                      <strong>{t("必须满足：", "Required: ")}</strong>
                      {appliedLimits.join(" · ")}
                    </p>
                  ) : (
                    <p>
                      {t(
                        "未指定部署、费用或容量门槛，先按用途查找。",
                        "No hosting, price or capacity gate is set; start with the task.",
                      )}
                    </p>
                  )}
                  <details className="decision-confirmation__details">
                    <summary>
                      {t("查看已识别的全部条件", "Inspect all recognized conditions")}
                    </summary>
                    <dl>
                      <dt>{t("任务", "Task")}</dt>
                      <dd>{preparedDecision.context.task}</dd>
                      <dt>{t("业务场景", "Business scenario")}</dt>
                      <dd>{scenario.name}</dd>
                      <dt>{t("验证重点", "Validation focus")}</dt>
                      <dd>{scenario.clarificationChecks.join("；")}</dd>
                      <dt>{t("选型任务与优先项", "Selection and priority")}</dt>
                      <dd>
                        {
                          {
                            "model-api": t("模型 API", "Model API"),
                            "coding-product": t("编码产品", "Coding product"),
                            "agent-development": t("Agent 开发", "Agent development"),
                            unspecified: t("未指定", "Unspecified"),
                          }[taskType]
                        }{" "}
                        ·{" "}
                        {
                          {
                            balanced: t("综合平衡", "Balanced"),
                            quality: t("效果质量", "Quality"),
                            cost: t("成本", "Cost"),
                            speed: t("速度", "Speed"),
                            privacy: t("隐私", "Privacy"),
                            control: t("可控性", "Control"),
                          }[priority]
                        }
                      </dd>
                      <dt>{t("部署", "Deployment")}</dt>
                      <dd>
                        {
                          {
                            undecided: t("暂不确定", "Undecided"),
                            "cloud-api": t("云 API", "Cloud API"),
                            private: t("私有部署", "Private"),
                            "on-device": t("端侧", "On-device"),
                            hybrid: t("混合", "Hybrid"),
                          }[deployment]
                        }
                      </dd>
                      {region && (
                        <>
                          <dt>{t("部署地区", "Hosting region")}</dt>
                          <dd>{region}</dd>
                        </>
                      )}
                      {commercialUse && (
                        <>
                          <dt>{t("商用许可", "Commercial use")}</dt>
                          <dd>{t("必须有核验证据", "Verified permission required")}</dd>
                          {serviceChannel && (
                            <>
                              <dt>{t("实际服务范围", "Actual service scope")}</dt>
                              <dd>
                                {serviceChannel} ·{" "}
                                {serviceTier === "paid"
                                  ? t("付费服务", "Paid service")
                                  : serviceTier === "free"
                                    ? t("免费服务", "Free service")
                                    : t("账户层级未确认", "Tier unconfirmed")}{" "}
                                · {serviceRegion || t("使用国家未确认", "Country unconfirmed")}
                              </dd>
                            </>
                          )}
                        </>
                      )}
                      {exclusions && (
                        <>
                          <dt>{t("排除条件", "Exclusions")}</dt>
                          <dd>{exclusions}</dd>
                        </>
                      )}
                      <dt>{t("预算", "Budget")}</dt>
                      <dd>
                        {budgetMode === "range"
                          ? `${currency} ${budgetMaximum || t("未指定上限", "No ceiling")} / ${t("月", "month")}`
                          : t("未指定硬上限", "No hard ceiling")}
                      </dd>
                      {budgetMode === "range" && (
                        <>
                          <dt>{t("核算范围", "Cost scope")}</dt>
                          <dd>
                            {costScope === "standard-token-only"
                              ? t("仅 Standard 模型 token 费用", "Standard model tokens only")
                              : t("全部费用", "All costs")}
                          </dd>
                        </>
                      )}
                      <dt>{t("上下文与输入", "Context and input")}</dt>
                      <dd>
                        {minimumContext
                          ? `≥ ${minimumContext} token`
                          : t("未限定上下文", "No context minimum")}{" "}
                        ·{" "}
                        {inputModalities
                          .map(
                            (value) =>
                              ({
                                text: t("文本", "Text"),
                                image: t("图像", "Image"),
                                audio: t("音频", "Audio"),
                                video: t("视频", "Video"),
                              })[value],
                          )
                          .join("、") || t("未限定模态", "No modality requirement")}
                      </dd>
                      <dt>{t("候选范围", "Candidate scope")}</dt>
                      <dd>
                        {candidateEntityIds.length
                          ? candidateEntityIds
                              .map((id) => {
                                const entity = snapshot?.entities.find((item) => item.id === id);
                                return entity ? pick(entity.name, lang) : id;
                              })
                              .join(" · ")
                          : t(
                              "核验全目录相关范围，最多展示 20 个具体候选；结果会说明范围，不代表性能排名",
                              "Check the relevant catalog scope and show up to 20 concrete candidates; the report explains the scope without a performance ranking",
                            )}
                      </dd>
                      {budgetMode === "range" && (!channel || !inputTokens || !outputTokens) && (
                        <>
                          <dt>{t("待补充", "Missing inputs")}</dt>
                          <dd>
                            {t(
                              "计费渠道与月输入/输出工作量须齐全，才能核验预算。",
                              "Billing channel and monthly input/output workload are needed to verify budget.",
                            )}
                          </dd>
                        </>
                      )}
                    </dl>
                  </details>
                  {notes && (
                    <p>
                      {t("补充说明", "Additional notes")}: {notes}
                    </p>
                  )}
                  {!token && (
                    <p>
                      {t(
                        "登录后获取这份任务的候选清单，并保存你的选型与试用记录。",
                        "Sign in to find candidates for this task and save your selection and trial records.",
                      )}
                    </p>
                  )}
                  <div className="decision-confirmation__actions">
                    {!token ? (
                      <Button asChild>
                        <Link
                          to="/account"
                          search={{ returnTo: decisionResumePath(preparedDecision.context) }}
                        >
                          {t("登录并获取候选", "Sign in and find candidates")}
                        </Link>
                      </Button>
                    ) : (
                      <Button type="submit" disabled={busy}>
                        <Send className="h-4 w-4" />
                        {busy
                          ? t("检索中…", "Researching…")
                          : t("查看适合的候选", "Find suitable options")}
                      </Button>
                    )}
                  </div>
                </section>
              )}
              {busy && (
                <p role="status">
                  {t(
                    "正在核对已审核资料与候选约束；等待服务返回实际结果。",
                    "Checking reviewed evidence and candidate constraints; waiting for the actual result.",
                  )}
                </p>
              )}
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {error}
                  {sessionExpired && (
                    <Link
                      to="/account"
                      search={{
                        returnTo: buildAskResumePath({
                          task,
                          priority,
                          budgetMode,
                          budgetMinimum,
                          budgetMaximum,
                          currency,
                          channel,
                          costScope,
                          inputTokens,
                          maximumInputPerRequest,
                          outputTokens,
                          taskType,
                          deployment,
                          exclusions,
                          notes,
                          candidateEntityIds,
                          region,
                          minimumContext,
                          inputModalities,
                          commercialUse,
                          serviceChannel,
                          serviceTier,
                          serviceRegion,
                        }),
                      }}
                      className="mt-2 inline-flex min-h-10 items-center font-medium underline"
                    >
                      {t("登录并继续", "Sign in and continue")}
                    </Link>
                  )}
                  {token && !userApi.configured && (
                    <Link to="/account" className="ml-2 font-medium underline">
                      {t("查看账户状态", "View account status")}
                    </Link>
                  )}
                </div>
              )}
            </form>

            {research ? (
              <section
                className="ask-result"
                aria-labelledby="decision-result-title"
                onClickCapture={(event) => {
                  if (event.target instanceof Element && event.target.closest("a"))
                    rememberResultScroll();
                }}
              >
                {research.decisionContext &&
                  decisionFingerprint(research.decisionContext) !== currentFingerprint && (
                    <p role="status" className="ask-result__notice">
                      {t(
                        "条件已修改。下面仍是上一次分析结果，请重新确认并分析。",
                        "Conditions changed. The result below belongs to the previous analysis; review and analyze again.",
                      )}
                    </p>
                  )}
                <header className="ask-result__header">
                  <div className="ask-result__title-row">
                    <h2 id="decision-result-title">{t("分析结果", "Analysis result")}</h2>
                    <span
                      className="ask-result__state"
                      data-state={research.decision?.status ?? research.status}
                    >
                      {!token
                        ? t("预置资料", "Preset evidence")
                        : research.decision?.status === "conflict"
                          ? t("需核对冲突", "Review conflicts")
                          : research.decision?.status === "ready"
                            ? t("可继续验证", "Ready for validation")
                            : research.decision?.candidates?.every(
                                  (candidate) => candidate.eligibility === "excluded",
                                ) && research.decision.candidates.length
                              ? t("全部候选不符合硬条件", "All candidates are excluded")
                              : t("适配条件待核验", "Fit needs verification")}
                    </span>
                  </div>
                  {!research.decision && <p className="ask-result__summary">{research.summary}</p>}
                  {!token && (
                    <p>
                      {t(
                        "这是预置问题的历史资料，不会应用你修改的选型条件。",
                        "Historical evidence for a preset question; edited constraints are not applied.",
                      )}
                    </p>
                  )}
                </header>

                {research.decision && (
                  <DecisionBrief
                    research={research}
                    validationContent={
                      token && (
                        <DecisionValidationPanel
                          research={research}
                          token={token}
                          entityName={(id) => {
                            const entity = snapshot?.entities.find((item) => item.id === id);
                            return entity ? pick(entity.name, lang) : id;
                          }}
                        />
                      )
                    }
                    entityName={(id) => {
                      const entity = snapshot?.entities.find((item) => item.id === id);
                      return entity ? pick(entity.name, lang) : id;
                    }}
                    isComparable={(id) =>
                      Boolean(
                        snapshot?.entities.some((item) => item.id === id && item.type === "model"),
                      )
                    }
                  />
                )}

                {factClaims.length + inferredClaims.length + unverifiedClaims.length > 0 && (
                  <details
                    className="ask-source-library"
                    open={research.decision ? undefined : true}
                  >
                    <summary>
                      {t(
                        `查看全部原始依据（${factClaims.length + inferredClaims.length + unverifiedClaims.length} 条）`,
                        `Inspect all source evidence (${factClaims.length + inferredClaims.length + unverifiedClaims.length})`,
                      )}
                    </summary>
                    <p className="ask-result__citation-note">
                      {t(
                        `引用构成 · 已核验 ${factClaims.length} · 推断 ${inferredClaims.length} · 待核验 ${unverifiedClaims.length}`,
                        `Citations · verified ${factClaims.length} · inferred ${inferredClaims.length} · unverified ${unverifiedClaims.length}`,
                      )}
                    </p>

                    {factClaims.length > 0 && (
                      <AnswerBlock
                        title={t("关键依据", "Key evidence")}
                        icon={<ShieldCheck />}
                        tint="verified"
                        count={factClaims.length}
                      >
                        {factClaims.map((c, index) => (
                          <ClaimRow
                            key={c.id}
                            index={index + 1}
                            id={c.id}
                            zh={c.text.zh}
                            en={c.text.en}
                            sourceIds={c.sourceIds}
                            evidence={evidence}
                          />
                        ))}
                      </AnswerBlock>
                    )}
                    {(inferredClaims.length > 0 || unverifiedClaims.length > 0) && (
                      <details className="ask-secondary-evidence">
                        <summary>
                          {t(
                            `查看其他判断（${inferredClaims.length + unverifiedClaims.length}）`,
                            `Review other findings (${inferredClaims.length + unverifiedClaims.length})`,
                          )}
                        </summary>
                        <div className="ask-secondary-evidence__grid">
                          {inferredClaims.length > 0 && (
                            <AnswerBlock
                              title={t("基于证据的推断", "Evidence-based inference")}
                              icon={<Info />}
                              tint="inferred"
                              count={inferredClaims.length}
                            >
                              {inferredClaims.map((c, index) => (
                                <ClaimRow
                                  key={c.id}
                                  index={index + 1}
                                  id={c.id}
                                  zh={c.text.zh}
                                  en={c.text.en}
                                  sourceIds={c.sourceIds}
                                  evidence={evidence}
                                />
                              ))}
                            </AnswerBlock>
                          )}
                          {unverifiedClaims.length > 0 && (
                            <AnswerBlock
                              title={t("待核验信息", "Needs verification")}
                              icon={<HelpCircle />}
                              tint="unverified"
                              count={unverifiedClaims.length}
                            >
                              {unverifiedClaims.map((c, index) => (
                                <ClaimRow
                                  key={c.id}
                                  index={index + 1}
                                  id={c.id}
                                  zh={c.text.zh}
                                  en={c.text.en}
                                  sourceIds={c.sourceIds}
                                  evidence={evidence}
                                />
                              ))}
                            </AnswerBlock>
                          )}
                        </div>
                      </details>
                    )}
                  </details>
                )}
                <div className="ask-result__footer">
                  <p>
                    {t(
                      "结论仅基于当前收录证据；信息不足时会明确标注。",
                      "Conclusions use the currently recorded evidence; gaps are explicitly marked.",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {token ? (
                      <Link
                        to="/research/$id"
                        params={{ id: research.id }}
                        className="text-sm font-medium text-signal hover:underline"
                      >
                        {t("打开完整研究记录 →", "Open full research record →")}
                      </Link>
                    ) : (
                      <Link
                        to="/account"
                        className="text-sm font-medium text-signal hover:underline"
                      >
                        {t(
                          "登录后创建并保存私密研究 →",
                          "Sign in to create and save private research →",
                        )}
                      </Link>
                    )}
                  </div>
                </div>
              </section>
            ) : (
              <div className="paper-card mt-8 p-6 text-sm leading-relaxed text-muted-foreground">
                {t(
                  "先描述场景并确认条件，再查看候选与依据。已知事实用于比较，缺少的条件会单独列出，便于继续核验。",
                  "Describe the scenario and confirm constraints, then inspect candidates and evidence. Known facts support comparison; missing conditions are listed for follow-up.",
                )}
              </div>
            )}
          </div>
          {research && !research.decision && <EvidenceSidebar evidence={evidence} />}
        </div>
      </div>
    </AppShell>
  );
}

function buildAskResumePath(input: {
  task: string;
  priority: DecisionContext["priority"];
  budgetMode: DecisionContext["budget"]["mode"];
  budgetMinimum: string;
  budgetMaximum: string;
  currency: string;
  channel: string;
  costScope?: DecisionContext["budget"]["costScope"];
  inputTokens: string;
  maximumInputPerRequest?: string;
  outputTokens: string;
  taskType: NonNullable<DecisionContext["taskType"]>;
  deployment: DecisionContext["deployment"];
  exclusions: string;
  notes: string;
  candidateEntityIds: string[];
  region?: string;
  minimumContext?: string;
  inputModalities?: string[];
  commercialUse?: boolean;
  serviceChannel?: string;
  serviceTier?: "paid" | "free" | "unknown";
  serviceRegion?: string;
}) {
  const search = new URLSearchParams({
    task: input.task,
    priority: input.priority,
    budget: input.budgetMode,
    deployment: input.deployment,
    currency: input.currency,
    channel: input.channel,
    costScope: input.costScope ?? "all-costs",
    inputTokens: input.inputTokens,
    maximumInputPerRequest: input.maximumInputPerRequest ?? "",
    outputTokens: input.outputTokens,
    taskType: input.taskType,
  });
  if (input.budgetMinimum) search.set("budgetMin", input.budgetMinimum);
  if (input.budgetMaximum) search.set("budgetMax", input.budgetMaximum);
  if (input.exclusions) search.set("exclusions", input.exclusions);
  if (input.notes) search.set("notes", input.notes);
  if (input.candidateEntityIds.length) search.set("candidates", input.candidateEntityIds.join(","));
  if (input.region) search.set("region", input.region);
  if (input.minimumContext) search.set("minimumContext", input.minimumContext);
  if (input.inputModalities?.length) search.set("modalities", input.inputModalities.join(","));
  if (input.commercialUse) search.set("commercialUse", "true");
  if (input.serviceChannel) search.set("serviceChannel", input.serviceChannel);
  if (input.serviceTier) search.set("serviceTier", input.serviceTier);
  if (input.serviceRegion) search.set("serviceRegion", input.serviceRegion);
  return `/ask?${search.toString()}`;
}

function isDecisionPriority(value: string | null): value is DecisionContext["priority"] {
  return ["quality", "cost", "speed", "privacy", "control", "balanced"].includes(value ?? "");
}

function isBudgetMode(value: string | null): value is DecisionContext["budget"]["mode"] {
  return ["cost-first", "range", "unknown"].includes(value ?? "");
}

function isDeployment(value: string | null): value is DecisionContext["deployment"] {
  return ["cloud-api", "private", "on-device", "hybrid", "undecided"].includes(value ?? "");
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
          decision: {
            status: answer.status === "ready" ? "ready" : "insufficient-evidence",
            asOf: answer.generatedAt,
            recommendation: {
              alternativeEntityIds: [],
              summary: pick(answer.summary, lang),
            },
            conditions: [
              `${lang === "zh" ? "预置问题" : "Preset question"}: ${pick(answer.question, lang)}`,
            ],
            tradeoffs: [],
            risks: [
              {
                state: "inferred" as const,
                detail:
                  lang === "zh"
                    ? "公开研究仅覆盖预置问题与快照证据。"
                    : "Public research covers only preset questions and snapshot evidence.",
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
    <label className="decision-field">
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
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  maxLength?: number;
  helper?: string;
}) {
  const helpId = useId();
  return (
    <label className="decision-field">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        aria-label={label}
        aria-describedby={helper ? helpId : undefined}
        type={type}
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? 1_000_000_000_000 : undefined}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus:border-signal focus:outline-none sm:text-sm"
      />
      {helper && (
        <span id={helpId} className="decision-field__help">
          {helper}
        </span>
      )}
    </label>
  );
}

function AnswerBlock({
  title,
  icon,
  tint,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tint: "verified" | "inferred" | "unverified" | "conflict";
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className={`ask-answer-block is-${tint}`}>
      <div className="ask-answer-block__heading">
        {icon}
        <h3 className="font-semibold text-foreground">{title}</h3>
        <span>{count}</span>
      </div>
      <div className="ask-answer-block__body">{children}</div>
    </section>
  );
}

function EvidenceSidebar({ evidence }: { evidence: Evidence[] }) {
  const { t, lang } = useApp();
  const sourceCards = evidence.map((source, index) => (
    <div key={source.id} id={`source-${source.id}`} className="paper-card scroll-mt-24 p-3">
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="group flex items-start gap-3 hover:text-signal"
      >
        <span className="font-mono text-xs text-signal">[{index + 1}]</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium [overflow-wrap:anywhere]">
            {pick(source.title, lang)}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {source.publisher} ·{" "}
            {source.publishedAt || t("来源日期未标注", "Source date unavailable")}
          </span>
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-signal" />
      </a>
      <SourceExcerpt source={source} lang={lang} />
    </div>
  ));
  return (
    <aside className="self-start lg:sticky lg:top-20">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("证据与来源", "Evidence & sources")}</h2>
        <span className="mono-meta">{evidence.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{sourceCards.slice(0, 8)}</div>
      {sourceCards.length > 8 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-signal hover:underline">
            {t(`更多来源（${sourceCards.length - 8}）`, `More sources (${sourceCards.length - 8})`)}
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {sourceCards.slice(8)}
          </div>
        </details>
      )}
    </aside>
  );
}

function ClaimRow({
  index,
  id,
  zh,
  en,
  sourceIds,
  evidence,
}: {
  index: number;
  id: string;
  zh: string;
  en: string;
  sourceIds: string[];
  evidence: Evidence[];
}) {
  const { lang } = useApp();
  return (
    <article id={`claim-${id}`} className="ask-claim-row scroll-mt-24">
      <span className="ask-claim-row__index">{String(index).padStart(2, "0")}</span>
      <div className="min-w-0">
        <p>{lang === "zh" ? zh : en}</p>
        <div className="ask-claim-row__sources">
          {sourceIds.map((id) => {
            const s = evidence.find((item) => item.id === id);
            if (!s) return null;
            return (
              <a key={id} href={`#source-${s.id}`} title={lang === "zh" ? s.title.zh : s.title.en}>
                [{evidence.findIndex((item) => item.id === id) + 1}] {s.publisher}
                <span>{s.publishedAt}</span>
              </a>
            );
          })}
        </div>
      </div>
    </article>
  );
}
