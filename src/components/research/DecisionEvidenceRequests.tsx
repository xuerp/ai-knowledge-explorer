import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-state";
import { readAuthToken } from "@/services/auth-session";
import { accountErrorMessage } from "@/services/auth-errors";
import { userApi, type DecisionEvidenceRequest, type ResearchResult } from "@/services/user-api";
import { requestableEvidenceCandidates } from "@/domain/decision-trial-kit";
import { planDimensionName } from "@/domain/decision-plan-reading";
import { decisionResumePath } from "@/domain/decision-workflow";

export function DecisionEvidenceRequests({
  research,
  entityName,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
}) {
  const { t, lang } = useApp();
  const candidates = requestableEvidenceCandidates(research);
  const [selected, setSelected] = useState("");
  const [receipts, setReceipts] = useState<DecisionEvidenceRequest[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const candidate = candidates.find((row) => row.entityId === selected) ?? candidates[0];
  const receipt = receipts.find((row) => row.candidateId === candidate?.entityId);
  const dimensions = [
    ...new Set(
      candidate?.gaps
        ?.filter((gap) =>
          ["not-recorded", "not-structured", "not-current", "conflicting"].includes(gap.reason),
        )
        .map((gap) => gap.dimension) ?? [],
    ),
  ];
  useEffect(() => {
    let active = true;
    const token = readAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }
    userApi
      .decisionEvidenceRequests(token, research.id)
      .then((value) => {
        if (active) {
          setReceipts(value);
          setError("");
        }
      })
      .catch((reason) => {
        if (active) setError(accountErrorMessage(reason, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [research.id, t]);
  if (!candidate && !receipts.length) return null;
  const state = (value: DecisionEvidenceRequest["status"]) =>
    ({
      pending: t("等待资料审核", "Awaiting source review"),
      "in-review": t("资料正在核验", "Sources under review"),
      resolved: t("资料审核已完成", "Source review completed"),
      rejected: t("本次请求未采纳，条件仍需核验", "Request declined; conditions remain unverified"),
    })[value];
  return (
    <details
      className="decision-evidence-request"
      open={
        research.decision?.plan?.state === "needs-evidence" ||
        research.decision?.plan?.state === "conflict"
      }
    >
      <summary>
        {t(
          "缺项资料：请求补充与查看进度",
          "Missing evidence: request an update and check progress",
        )}
      </summary>
      <p>
        {t(
          "选择候选提交缺项，资料维护人员会核对官方来源。这里会按当前已审核事实检查实际进展；补齐后带着原要求重新分析。",
          "Select a candidate to request official-source verification. Progress is checked against current reviewed facts. Reanalyze with your original requirements when evidence is ready.",
        )}
      </p>
      {candidate && (
        <>
          <label>
            {t("需要补资料的候选", "Candidate needing evidence")}
            <select
              value={candidate.entityId}
              onChange={(event) => setSelected(event.target.value)}
              disabled={busy}
            >
              {candidates.map((row) => (
                <option key={row.entityId} value={row.entityId}>
                  {entityName(row.entityId)}
                </option>
              ))}
            </select>
          </label>
          <p>
            {receipt
              ? t("原分析待补项：", "Evidence missing from the original analysis: ")
              : t("待核验：", "To verify: ")}
            {dimensions.map((key) => planDimensionName(key, lang)).join("、")}
          </p>
          <p className="decision-choice__hint">
            {t(
              "只提交公开候选名称和缺项，不提交你的任务原文、文件或试用笔记。请求已处理也不代表条件通过，以重新分析结果为准。",
              "Only public candidate names and gaps are submitted, without your task text, files or trial notes. A processed request does not establish eligibility; reanalyze to verify.",
            )}
          </p>
          <Button
            variant="outline"
            disabled={loading || busy || !!receipt}
            onClick={async () => {
              if (inFlight.current) return;
              const token = readAuthToken();
              if (!token) {
                setError(
                  t(
                    "请先登录这份记录所属的账户。",
                    "Sign in to the account that owns this record.",
                  ),
                );
                return;
              }
              const id = candidate.entityId;
              if (!requestIds.current.has(id)) requestIds.current.set(id, crypto.randomUUID());
              inFlight.current = true;
              setBusy(true);
              setError("");
              try {
                const result = await userApi.requestDecisionEvidence(
                  token,
                  research.id,
                  id,
                  requestIds.current.get(id)!,
                );
                setReceipts((current) => [
                  ...current.filter((row) => row.candidateId !== result.candidateId),
                  result,
                ]);
              } catch (reason) {
                setError(accountErrorMessage(reason, t));
              } finally {
                inFlight.current = false;
                setBusy(false);
              }
            }}
          >
            {loading
              ? t("正在读取进度…", "Loading progress…")
              : busy
                ? t("正在提交…", "Submitting…")
                : receipt
                  ? state(receipt.status)
                  : t("提交资料补充请求", "Request an evidence update")}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!!receipts.length && (
        <>
          <Button
            variant="outline"
            disabled={checking || busy || loading}
            onClick={async () => {
              if (checking || inFlight.current) return;
              const token = readAuthToken();
              if (!token) {
                setError(
                  t(
                    "请先登录这份记录所属的账户。",
                    "Sign in to the account that owns this record.",
                  ),
                );
                return;
              }
              setChecking(true);
              setError("");
              try {
                setReceipts(await userApi.decisionEvidenceRequests(token, research.id));
              } catch (reason) {
                setError(accountErrorMessage(reason, t));
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking
              ? t("正在核对最新资料…", "Checking current evidence…")
              : t("检查资料是否补齐", "Check for evidence updates")}
          </Button>
          <ul
            className="decision-evidence-request__progress"
            aria-label={t("本次资料请求进度", "Evidence request progress")}
          >
            {receipts.map((row) => (
              <li key={row.id}>
                <strong>{entityName(row.candidateId)}</strong>
                <p>
                  {row.verificationState === "evidence-ready"
                    ? t(
                        "所请求资料已补齐，可以重新分析。",
                        "Requested evidence is ready for reanalysis.",
                      )
                    : row.verificationState === "candidate-unavailable"
                      ? t(
                          "原候选已不在当前目录，请保留要求重新选择。",
                          "The candidate is no longer available; keep your requirements and choose again.",
                        )
                      : t("仍需补齐：", "Still missing: ") +
                        (row.remainingDimensions ?? row.dimensions)
                          .map((key) => planDimensionName(key, lang))
                          .join("、")}
                </p>
                {!!row.verifiedDimensions?.length && (
                  <p className="decision-choice__hint">
                    {t("已补齐的资料项：", "Evidence now available: ")}
                    {row.verifiedDimensions.map((key) => planDimensionName(key, lang)).join("、")}
                  </p>
                )}
                {row.verificationState === "evidence-ready" && (
                  <p className="decision-choice__hint">
                    {row.currentEligibility === "excluded"
                      ? t(
                          "新资料表明不符合原硬条件，重新分析可查看排除原因。",
                          "Current facts exclude this candidate under your original requirements; reanalyze for the reasons.",
                        )
                      : row.currentEligibility !== "eligible"
                        ? t(
                            "所请求资料补齐不代表所有条件通过；其他限制仍以重新分析为准。",
                            "Completed evidence does not establish every condition; reanalyze to check the remaining requirements.",
                          )
                        : t(
                            "这只表示必要条件有依据，业务效果仍需实际试用。",
                            "This establishes evidence for requirements; task performance still needs a real trial.",
                          )}
                  </p>
                )}
                <p className="decision-choice__hint">
                  {state(row.status)}
                  {row.checkedAt && (
                    <>
                      {" "}
                      · {t("核对时间：", "Checked: ")}
                      <time dateTime={row.checkedAt}>
                        {new Date(row.checkedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}
                      </time>
                    </>
                  )}
                </p>
                {["evidence-ready", "candidate-unavailable"].includes(row.verificationState) &&
                  research.decisionContext && (
                    <Link
                      className="decision-evidence-request__continue"
                      to={decisionResumePath(research.decisionContext)}
                    >
                      {t("保留原要求，重新分析", "Reanalyze with original requirements")}
                    </Link>
                  )}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
