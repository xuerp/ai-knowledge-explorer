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
import "./decision-guidance.css";

export function DecisionGuidanceView({
  research,
  entityName,
  isComparable,
  onRevision,
  onTrial,
  privateAdvice,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
  isComparable: (id: string) => boolean;
  onRevision?: (result: ResearchResult) => void;
  onTrial?: (ids: string[]) => void;
  privateAdvice?: { headline: string; summary: string; boundary: string; next: string };
}) {
  const { t, lang } = useApp();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingAnswer, setPendingAnswer] = useState<DecisionIntentAnswer | null>(null);
  const submitting = useRef(false);
  const actionRef = useRef<HTMLDivElement>(null);
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
  const comparisons = decisionComparisonRows(research, comparisonIds);
  const documentation = (research.citations ?? [])
    .filter((citation) => advice.entityIds.includes(citation.claim.entityId ?? ""))
    .flatMap((citation) => citation.evidence)
    .filter(
      (source, index, all) =>
        source.type === "official" && all.findIndex((item) => item.url === source.url) === index,
    )
    .slice(0, 3);
  const question = guidance.clarification;
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
  const prompt = `${task}\n\n${guidance.nextAction.instruction}`;
  const editPath = research.decisionContext
    ? decisionResumePath({ ...research.decisionContext, parentResearchId: research.id })
    : "/ask";
  return (
    <section
      className="decision-guidance"
      aria-label={t("建议与下一步", "Advice and next step")}
      aria-busy={busy}
    >
      <div className="decision-guidance__request">
        <p>
          <strong>{t("你的任务", "Your task")}</strong> {task}
        </p>
        <a href={editPath}>{t("修改", "Edit")}</a>
      </div>
      {research.decisionContext?.parentResearchId && (
        <p className="decision-guidance__revision">
          {t(
            "这是修改后的新建议，旧记录仍保留。",
            "This is a new revision; the earlier record is retained.",
          )}{" "}
          <Link to="/research/$id" params={{ id: research.decisionContext.parentResearchId }}>
            {t("查看上一版", "Previous revision")}
          </Link>
        </p>
      )}
      <h3 className="decision-outcome__headline" tabIndex={-1}>
        {advice.headline}
      </h3>
      <p className="decision-outcome__summary">{advice.summary}</p>
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
          {!!advice.reasons.length && (
            <div className="decision-guidance__reasons">
              <h4>{t("为什么这样选", "Why this fits")}</h4>
              <ul>
                {advice.reasons.map((reason, index) => (
                  <li key={index}>
                    {reason.finding}
                    {reason.claimIds.length > 0 && (
                      <span className="decision-guidance__references">
                        {" "}
                        {reason.claimIds.slice(0, 2).map((id) => (
                          <a
                            key={id}
                            href={`#claim-${id}`}
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
                            {t("依据", "Source")}
                          </a>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {advice.tradeoff && (
            <p>
              <strong>{t("主要取舍：", "Main tradeoff: ")}</strong>
              {advice.tradeoff}
            </p>
          )}
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
              <Button
                onClick={() => {
                  setOpened(true);
                  requestAnimationFrame(() => {
                    actionRef.current?.scrollIntoView({ block: "nearest" });
                    actionRef.current?.focus();
                  });
                }}
              >
                {guidance.nextAction.label}
              </Button>
            )}
          </div>
          <div
            ref={actionRef}
            hidden={!opened}
            tabIndex={-1}
            className="decision-guidance__action-area"
          >
            <h4>
              {guidance.nextAction.kind === "start"
                ? t("从这里开始", "Start here")
                : t("会影响选择的差异", "Differences that affect this choice")}
            </h4>
            <p>{guidance.nextAction.instruction}</p>
            {guidance.nextAction.kind === "start" && (
              <>
                <p>
                  {t(
                    "使用入口：本次未验证你的账户是否已开通，请在已有产品中确认。",
                    "Access: your account availability has not been verified; check inside your existing product.",
                  )}
                </p>
                {!!documentation.length && (
                  <p className="decision-guidance__references">
                    {documentation.map((source) => (
                      <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                        {t("操作资料：", "Documentation: ")}
                        {source.title[lang]}
                      </a>
                    ))}
                  </p>
                )}
                <p>
                  {t(
                    "在你选择的产品中执行；本页不会替你运行任务。",
                    "Run this in your selected product; this page does not execute the task.",
                  )}
                </p>
                <label htmlFor={`start-${research.id}`}>
                  {t("可复制的任务说明", "Copyable task instructions")}
                </label>
                <textarea id={`start-${research.id}`} readOnly value={prompt} rows={4} />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(prompt)
                      .then(() => setCopied(true))
                      .catch(() =>
                        setError(
                          t(
                            "复制失败，请选择上方文字复制。",
                            "Copy failed; select and copy the text above.",
                          ),
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
                    <p>
                      {t(
                        "费用与账户入口需要按实际使用方式确认。",
                        "Confirm cost and account access for your actual interface.",
                      )}
                    </p>
                    {onTrial && (
                      <Button variant="outline" onClick={() => onTrial([id])}>
                        {t("已有此入口，准备一个任务", "I have access; prepare a task")}
                      </Button>
                    )}
                  </section>
                ))}
              </div>
            )}
            {!!guidance.unknowns.length && guidance.outcome !== "advice" && (
              <ul>
                {[
                  ...new Set(
                    guidance.unknowns.filter((row) => row.decisive).map((row) => row.detail),
                  ),
                ]
                  .slice(0, 5)
                  .map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
              </ul>
            )}
          </div>
          {onTrial && guidance.outcome === "advice" && (
            <details className="decision-guidance__optional">
              <summary>
                {t("验证是否适合我 / 记录使用结果", "Validate fit / record actual results")}
              </summary>
              <p>
                {t(
                  "可选：执行一个实际任务后记录结果。下载操作说明不会替你执行。",
                  "Optional: record results after doing an actual task. Downloading instructions does not execute it.",
                )}
              </p>
              {advice.primaryEntityId ? (
                <Button variant="outline" onClick={() => onTrial([advice.primaryEntityId!])}>
                  {t("准备验证任务", "Prepare a validation task")}
                </Button>
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
          <aside className="decision-guidance__boundary">
            {advice.premises.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </aside>
        </>
      )}
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
