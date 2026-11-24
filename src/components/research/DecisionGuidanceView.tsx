import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { readAuthToken } from "@/services/auth-session";
import {
  AuthSessionExpiredError,
  userApi,
  type DecisionIntentAnswer,
  type ResearchResult,
} from "@/services/user-api";
import { accountErrorMessage } from "@/services/auth-errors";
import { decisionResumePath } from "@/domain/decision-workflow";
import { DecisionChoice } from "./DecisionChoice";
import { decisionComparisonRows } from "@/domain/decision-choice";
import { planDimensionName } from "@/domain/decision-plan-reading";
import { guidanceReasonText } from "@/domain/decision-reading";
import { answerSourceNotice } from "@/domain/answer-source";
import { copyTaskText } from "@/lib/copy-task-text";
import "./decision-guidance.css";

export function DecisionGuidanceView({
  research,
  outcomeLevel,
  entityName,
  isComparable,
  onRevision,
  onTrial,
  privateAdvice,
}: {
  research: ResearchResult;
  outcomeLevel: 2 | 3;
  entityName: (id: string) => string;
  isComparable: (id: string) => boolean;
  onRevision?: (result: ResearchResult) => void;
  onTrial?: (ids: string[]) => void;
  privateAdvice?: { headline: string; summary: string; boundary: string; next: string };
}) {
  const { t, lang } = useApp();
  const OutcomeHeading = outcomeLevel === 2 ? "h2" : "h3";
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingAnswer, setPendingAnswer] = useState<DecisionIntentAnswer | null>(null);
  const submitting = useRef(false);
  const actionRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const guidance = research.decision!.guidance!;
  const advice = privateAdvice
    ? {
        ...guidance.recommendation,
        headline: privateAdvice.headline,
        summary: privateAdvice.summary,
        reasons: [],
        premises: [privateAdvice.boundary],
      }
    : guidance.recommendation;
  const comparisonIds = guidance.recommendation.entityIds.slice(0, 3);
  const legacyPremises = [
    "公开资料支持功能和条件判断；实际效果、你的账户权限及最终费用仍以实际使用为准。",
    "公开资料支持功能和条件判断；实际效果、你的账户权限及最终费用仍以实际使用为准。 费用未估算，不表示免费。",
    "Public evidence supports feature and condition checks; actual results, account access and final charges remain unmeasured.",
    "Public evidence supports feature and condition checks; actual results, account access and final charges remain unmeasured. Cost is not estimated, not assumed free.",
  ];
  const premises = [
    ...new Set(
      advice.premises.map((line) =>
        !privateAdvice && legacyPremises.includes(line)
          ? t(
              "使用前确认账号权限和费用。实际效果可用任务样本验证。",
              "Check account access and pricing before use. Try a task sample to assess results.",
            )
          : line,
      ),
    ),
  ];
  const comparisons = decisionComparisonRows(research, comparisonIds);
  const localDeployment = ["private", "on-device"].includes(
    research.decisionContext?.deployment ?? "",
  );
  const reasonClaimIds = new Set(advice.reasons.flatMap((reason) => reason.claimIds));
  const reasonSourceIds = new Set(
    (research.citations ?? [])
      .filter((citation) => reasonClaimIds.has(citation.claim.id))
      .flatMap((citation) => citation.evidence.map((source) => source.id)),
  );
  const documentation = (research.citations ?? [])
    .filter((citation) => advice.entityIds.includes(citation.claim.entityId ?? ""))
    .flatMap((citation) => citation.evidence)
    .filter(
      (source, index, all) =>
        source.type === "official" && all.findIndex((item) => item.url === source.url) === index,
    )
    .sort((a, b) =>
      localDeployment ? Number(reasonSourceIds.has(b.id)) - Number(reasonSourceIds.has(a.id)) : 0,
    )
    .slice(0, 3);
  const question = guidance.clarification;
  const relevantUnknowns = guidance.unknowns.filter(
    (item) =>
      !item.candidateId ||
      advice.entityIds.includes(item.candidateId) ||
      (research.decision?.scope?.explicit &&
        research.decisionContext?.candidateEntityIds.includes(item.candidateId)),
  );
  const draftKey = `ai-radar-clarification:${research.id}`;
  useEffect(() => {
    try {
      setAnswer(sessionStorage.getItem(draftKey) ?? "");
      setPendingAnswer(JSON.parse(sessionStorage.getItem(draftKey + ":pending") ?? "null"));
    } catch {
      /* Optional storage. */
    }
  }, [draftKey]);
  async function respond(value: DecisionIntentAnswer) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setExpired(false);
    setPendingAnswer(value);
    try {
      sessionStorage.setItem(draftKey + ":pending", JSON.stringify(value));
    } catch {
      /* Optional storage. */
    }
    try {
      const result = await userApi.research(readAuthToken(), {
        question: research.question,
        language: lang,
        parentResearchId: research.id,
        clarificationAnswer: value,
      });
      try {
        sessionStorage.removeItem(draftKey + ":pending");
      } catch {
        /* Optional storage. */
      }
      if (onRevision) onRevision(result);
      else window.location.assign(`/research/${encodeURIComponent(result.id)}`);
    } catch (reason) {
      setExpired(reason instanceof AuthSessionExpiredError);
      setError(accountErrorMessage(reason, t));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const task = research.decisionContext?.task ?? research.question;
  const prompt =
    guidance.nextAction.executionPrompt ?? `${task}\n\n${guidance.nextAction.instruction}`;
  const procedure = research.decision?.plan?.trial?.procedure ?? [];
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();
  // Only reuse the structured steps when they contain exactly this instruction.
  // Older records and non-trial actions may carry a different next action.
  const instructionParagraphs =
    procedure.length > 0 &&
    normalizeWhitespace(procedure.join(" ")) ===
      normalizeWhitespace(guidance.nextAction.instruction)
      ? procedure
      : guidance.nextAction.instruction.split(/\n+/).filter((text) => text.trim());
  const editPath = research.decisionContext
    ? decisionResumePath({ ...research.decisionContext, parentResearchId: research.id })
    : "/ask";
  const entryUrl =
    !privateAdvice && guidance.nextAction.kind === "start" && guidance.outcome === "advice"
      ? guidance.nextAction.entryUrl
      : null;
  const sourceNotice = answerSourceNotice(research.retrievalDiagnostics.generationFallbackReason);
  const retry = async () => {
    if (submitting.current || !research.decisionContext) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      // A fresh research from the same saved task and conditions; no clarification.
      const context = { ...research.decisionContext, intentAnswers: [] };
      delete (context as { parentResearchId?: string }).parentResearchId;
      const result = await userApi.research(readAuthToken(), {
        question: research.question,
        language: lang,
        decisionContext: context,
      });
      if (onRevision) onRevision(result);
      else window.location.assign(`/research/${encodeURIComponent(result.id)}`);
    } catch (reason) {
      setExpired(reason instanceof AuthSessionExpiredError);
      setError(accountErrorMessage(reason, t));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const singleStartId =
    guidance.nextAction.targetIds.length === 1
      ? guidance.nextAction.targetIds[0]
      : advice.primaryEntityId;
  const showNextAction = () => {
    setOpened(true);
    requestAnimationFrame(() => {
      actionRef.current?.scrollIntoView({ block: "nearest" });
      actionRef.current?.focus();
    });
  };
  return (
    <section
      className="decision-guidance"
      aria-label={t("建议与下一步", "Advice and next step")}
      aria-busy={busy}
    >
      <OutcomeHeading className="decision-outcome__headline" tabIndex={-1}>
        {advice.headline}
      </OutcomeHeading>
      <p className="decision-outcome__summary">{advice.summary}</p>
      {!privateAdvice && research.answerMode === "generated" && (
        <p className="decision-guidance__source">
          {advice.summarySource === "model"
            ? t(
                "这段结论和下方理由由模型根据已审核资料撰写；候选与条件筛选由规则完成。",
                "This conclusion and the reasons below were written by a model from reviewed evidence; candidates and constraints were checked by rules.",
              )
            : t(
                "下方理由由模型根据已审核资料撰写；结论与候选筛选由规则完成。",
                "The reasons below were written by a model from reviewed evidence; the conclusion and candidate checks come from rules.",
              )}
        </p>
      )}
      {sourceNotice === "model-unavailable" && (
        <p className="text-sm text-muted-foreground">
          {t(
            "模型综合暂不可用，以下依据来自已审核资料和条件筛选。",
            "Model synthesis is unavailable. The findings below use reviewed evidence and your constraints.",
          )}
        </p>
      )}
      {sourceNotice === "model-analysis-failed" && (
        <div className="decision-guidance__model-failed" role="status">
          <p>
            {research.retrievalDiagnostics.generationFallbackReason === "model-led-unavailable"
              ? t(
                  "模型分析这次没有运行：今天的调用次数或预算已用完。下面是根据已审核资料整理的结果。",
                  "Model analysis did not run: today's call allowance or budget is used up. The result below is drawn from reviewed evidence.",
                )
              : research.retrievalDiagnostics.generationFallbackReason ===
                  "model-led-provider-error"
                ? t(
                    "模型服务这次没有正常返回。下面是根据已审核资料整理的结果，可以稍后重新分析。",
                    "The model service did not respond normally. The result below is drawn from reviewed evidence; try again later.",
                  )
                : t(
                    "模型分析这次没有通过校验，已自动重试仍未成功。下面是根据已审核资料整理的结果。",
                    "The model analysis failed validation, including one automatic retry. The result below is drawn from reviewed evidence.",
                  )}
          </p>
          {research.decisionContext &&
            !privateAdvice &&
            research.retrievalDiagnostics.generationFallbackReason !== "model-led-unavailable" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void retry()}>
                {busy ? t("正在重新分析…", "Analyzing again…") : t("重新分析", "Analyze again")}
              </Button>
            )}
        </div>
      )}
      {sourceNotice === "invite-only" && (
        <p className="text-sm text-muted-foreground">
          {t(
            "以下内容摘自已审核资料并按你的条件筛选；模型生成目前仅对受邀账号开放。",
            "The findings below are drawn from reviewed evidence and filtered by your constraints; model-generated answers are currently invite-only.",
          )}
        </p>
      )}
      {privateAdvice && (
        <p>
          <strong>{t("下一步：", "Next: ")}</strong>
          {privateAdvice.next}
        </p>
      )}
      {guidance.tasks.length > 1 && (
        <details>
          <summary>{t("原题中的全部工作", "All jobs in your request")}</summary>
          <ul>
            {guidance.tasks.map((task, index) => (
              <li key={index}>{task}</li>
            ))}
          </ul>
        </details>
      )}
      {question ? (
        <div className="decision-guidance__clarification">
          <div className="decision-guidance__options">
            {question.options.map((option) => (
              <button
                type="button"
                key={option.id}
                disabled={busy}
                onClick={() => void respond({ questionId: question.id, optionId: option.id })}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (answer.trim()) void respond({ questionId: question.id, text: answer.trim() });
            }}
          >
            <label htmlFor={`clarification-${research.id}`}>
              {t("也可以用自己的话补充", "Or answer in your own words")}
            </label>
            <textarea
              id={`clarification-${research.id}`}
              value={answer}
              maxLength={500}
              onChange={(event) => {
                setAnswer(event.target.value);
                try {
                  sessionStorage.setItem(draftKey, event.target.value);
                } catch {
                  /* Optional storage. */
                }
              }}
              disabled={busy}
              rows={2}
            />
            <div className="decision-guidance__actions">
              <Button type="submit" disabled={busy || !answer.trim()}>
                {t("按补充继续", "Continue with my answer")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void respond({ questionId: question.id, optionId: "unknown" })}
              >
                {t("暂不确定，先看路线", "Unsure; show possible routes")}
              </Button>
            </div>
          </form>
          {busy && (
            <p role="status">
              {t("正在保留原条件并重新分析…", "Reanalyzing with your original requirements…")}
            </p>
          )}
        </div>
      ) : (
        <>
          {!privateAdvice &&
            !opened &&
            guidance.nextAction.kind === "start" &&
            instructionParagraphs[0] && (
              <p>
                <strong>{t("下一步：", "Next: ")}</strong>
                {instructionParagraphs[0].split(/(?<=。)|(?<=[.!?])\s+/u)[0]}
              </p>
            )}
          {entryUrl && (
            <div className="decision-guidance__actions">
              <Button asChild>
                <a
                  href={entryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="decision-guidance__entry"
                >
                  {research.decisionContext?.taskType === "model-api"
                    ? t("打开官方 API 文档", "Open official API docs")
                    : t("打开官方入口", "Open official entry")}
                </a>
              </Button>
              <Button variant="ghost" onClick={showNextAction} aria-expanded={opened}>
                {t("查看上手步骤", "See how to start")}
              </Button>
            </div>
          )}
          {!!advice.reasons.length && (
            <div className="decision-guidance__reasons">
              <h4>{t("为什么这样选", "Why this fits")}</h4>
              <ul>
                {advice.reasons.map((reason, index) => (
                  <li key={index}>
                    <span>
                      {guidanceReasonText(reason, research, entryUrl ? singleStartId : null, lang)}
                    </span>
                    {reason.claimIds.length > 0 && (
                      <span className="decision-guidance__reason-links">
                        {reason.claimIds.slice(0, 2).map((id, sourceIndex, sources) => (
                          <a
                            key={id}
                            href={`#claim-${id}`}
                            aria-label={t(
                              `第 ${index + 1} 条理由的来源 ${sourceIndex + 1}`,
                              `Source ${sourceIndex + 1} for reason ${index + 1}`,
                            )}
                            onClick={() => {
                              const target = document.getElementById(`claim-${id}`);
                              let ancestor = target?.parentElement;
                              while (ancestor) {
                                if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
                                ancestor = ancestor.parentElement;
                              }
                              target?.scrollIntoView({ block: "start" });
                            }}
                          >
                            {sources.length === 1
                              ? t("来源", "Source")
                              : t(`来源 ${sourceIndex + 1}`, `Source ${sourceIndex + 1}`)}
                          </a>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {advice.tradeoff && (!entryUrl || advice.primaryEntityId) && (
            <p>
              <strong>{t("主要取舍：", "Main tradeoff: ")}</strong>
              {advice.tradeoff}
            </p>
          )}
          {!entryUrl && (
            <div className="decision-guidance__actions">
              {privateAdvice && onTrial ? (
                <Button onClick={() => onTrial([])}>
                  {t("查看使用记录", "View actual records")}
                </Button>
              ) : guidance.nextAction.kind === "edit" ? (
                <Button asChild>
                  <a href={editPath}>{guidance.nextAction.label}</a>
                </Button>
              ) : (
                <Button onClick={showNextAction} aria-expanded={opened}>
                  {guidance.nextAction.label}
                </Button>
              )}
            </div>
          )}
          <div
            ref={actionRef}
            hidden={!opened}
            tabIndex={-1}
            className="decision-guidance__action-area"
          >
            <h4>
              {guidance.nextAction.kind === "start"
                ? t("从这里开始", "Start here")
                : guidance.nextAction.kind === "compare"
                  ? t("会影响选择的差异", "Differences that affect this choice")
                  : t("范围与下一步", "Scope and next step")}
            </h4>
            <div className="decision-guidance__instructions">
              {instructionParagraphs.map((paragraph, index) => {
                const stepHeading = paragraph.match(
                  /^(?:第\s*\d+\s*步[：:]|Step\s+\d+[:.]).*?[。\n]/i,
                )?.[0];
                return (
                  <p key={index}>
                    {stepHeading ? (
                      <>
                        <strong className="decision-guidance__step-title">{stepHeading}</strong>
                        {paragraph.slice(stepHeading.length)}
                      </>
                    ) : (
                      paragraph
                    )}
                  </p>
                );
              })}
            </div>
            {guidance.nextAction.kind === "start" && (
              <>
                {!!documentation.length && (
                  <p className="decision-guidance__references decision-guidance__documentation">
                    {documentation.map((source) => (
                      <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                        {t("操作资料：", "Documentation: ")}
                        {source.title[lang]}
                      </a>
                    ))}
                  </p>
                )}
                <label htmlFor={`start-${research.id}`}>
                  {t("可复制的任务说明", "Copyable task instructions")}
                </label>
                <textarea
                  ref={promptRef}
                  id={`start-${research.id}`}
                  readOnly
                  value={prompt}
                  rows={12}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    setError("");
                    setCopied(false);
                    const success = await copyTaskText(prompt, promptRef.current);
                    setCopied(success);
                    if (!success)
                      setError(
                        t(
                          "浏览器未允许自动复制。已选中全文，请使用系统的“复制”操作。",
                          "Automatic copying was blocked. All text is selected; use your system's Copy action.",
                        ),
                      );
                  }}
                >
                  {copied ? t("已复制", "Copied") : t("复制任务说明", "Copy instructions")}
                </Button>
                <p role="status">
                  {copied
                    ? t(
                        "已复制，粘贴到你选择的产品后执行。",
                        "Copied. Paste into your selected product to run.",
                      )
                    : ""}
                </p>
              </>
            )}
            {guidance.nextAction.kind !== "start" && comparisonIds.length > 0 && (
              <div className="decision-guidance__comparison">
                {comparisonIds.map((id) => (
                  <section key={id}>
                    <h4>{entityName(id)}</h4>
                    {comparisons.slice(0, 4).map((row) => (
                      <p key={row.id}>
                        <strong>{planDimensionName(row.dimension, lang)}：</strong>
                        {row.cells
                          .find((cell) => cell.entityId === id)
                          ?.facts.map((fact) => fact.finding)
                          .join(" ") || t("当前资料未核验", "Unverified in current sources")}
                      </p>
                    ))}
                    {onTrial && (
                      <Button variant="outline" onClick={() => onTrial([id])}>
                        {t("已有此入口，准备一个任务", "I have access; prepare a task")}
                      </Button>
                    )}
                  </section>
                ))}
              </div>
            )}
            {!!relevantUnknowns.length && guidance.outcome !== "advice" && (
              <ul>
                {[
                  ...new Set(
                    relevantUnknowns.filter((row) => row.decisive).map((row) => row.detail),
                  ),
                ]
                  .slice(0, 5)
                  .map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
              </ul>
            )}
          </div>
          {!entryUrl && premises.length > 0 && (
            <aside className="decision-guidance__boundary">
              {premises.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </aside>
          )}
        </>
      )}
      <div className="decision-guidance__details">
        {!question &&
          onTrial &&
          (guidance.outcome === "advice" ||
            (guidance.outcome === "conditional" && advice.entityIds.length > 0)) && (
            <details className="decision-result-disclosure decision-guidance__optional">
              <summary>{t("记录这次使用（可选）", "Record this use (optional)")}</summary>
              <p>
                {t(
                  "试用后可以记录结果和实际费用。",
                  "Save the result and actual cost after trying the tool.",
                )}
              </p>
              {singleStartId ? (
                <>
                  <Button variant="outline" onClick={() => onTrial([singleStartId])}>
                    {t("准备这一个方案的记录", "Prepare a record for this option")}
                  </Button>
                  {advice.entityIds.some((id) => id !== singleStartId) && (
                    <details>
                      <summary>{t("选择其他方案记录", "Record a different option")}</summary>
                      <DecisionChoice
                        research={research}
                        entityName={entityName}
                        isComparable={isComparable}
                        onTrial={onTrial}
                      />
                    </details>
                  )}
                </>
              ) : (
                <DecisionChoice
                  research={research}
                  entityName={entityName}
                  isComparable={isComparable}
                  onTrial={onTrial}
                />
              )}
            </details>
          )}
        <details className="decision-result-disclosure">
          <summary>{t("原始需求", "Original requirements")}</summary>
          <div className="decision-guidance__request">
            <p>{task}</p>
            <a href={editPath}>{t("修改", "Edit")}</a>
          </div>
          {research.decisionContext?.parentResearchId && (
            <Link to="/research/$id" params={{ id: research.decisionContext.parentResearchId }}>
              {t("查看上一版", "Previous revision")}
            </Link>
          )}
        </details>
      </div>
      {error && <p role="alert">{error}</p>}
      {pendingAnswer && !busy && question && (
        <Button variant="outline" onClick={() => void respond(pendingAnswer)}>
          {t("继续刚才的回答", "Retry my previous answer")}
        </Button>
      )}
      {expired && (
        <Link to="/account" search={{ returnTo: `/research/${research.id}` }}>
          {t("登录后继续，补充内容已保留", "Sign in to continue; your answer is retained")}
        </Link>
      )}
    </section>
  );
}
