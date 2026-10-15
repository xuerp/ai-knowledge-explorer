import { Link } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import {
  candidateRecordMode,
  candidateEvidenceStatus,
  decisionVisibleChoices,
  decisionComparisonRows,
  refreshDecision,
} from "@/domain/decision-choice";
import { decisionResumePath } from "@/domain/decision-workflow";
import { planDimensionName } from "@/domain/decision-plan-reading";
import { readAuthToken } from "@/services/auth-session";
import { accountErrorMessage } from "@/services/auth-errors";
import { userApi, type DecisionValidationReview, type ResearchResult } from "@/services/user-api";
import "./decision-choice.css";

export function DecisionChoice({
  research,
  entityName,
  isComparable,
  onTrial,
  testedFindings,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
  isComparable: (id: string) => boolean;
  onTrial?: (ids: string[]) => void;
  testedFindings?: NonNullable<DecisionValidationReview["conclusion"]>["findings"];
}) {
  const { t, lang } = useApp();
  const selectionId = useId();
  const [selected, setSelected] = useState<string[]>(() => {
    const { shown } = decisionVisibleChoices(research);
    return shown.length === 1 && shown[0].ready ? [shown[0].entityId] : [];
  });
  const [busy, setBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const { shown, more } = decisionVisibleChoices(research);
  const comparisonRows = decisionComparisonRows(research, selected);
  const canCompare = selected.length >= 2;
  const recordMode = candidateRecordMode(research, selected);
  const canTrial = recordMode === "business";
  const dimension = (key: string) => planDimensionName(key, lang);
  const renderRow = (row: (typeof shown)[number]) => (
    <div
      key={row.entityId}
      className="decision-choice__candidate"
      data-selected={selected.includes(row.entityId)}
    >
      <input
        type="checkbox"
        id={`${selectionId}-${row.entityId}`}
        aria-label={t(`选择 ${entityName(row.entityId)}`, `Select ${entityName(row.entityId)}`)}
        checked={selected.includes(row.entityId)}
        disabled={!selected.includes(row.entityId) && selected.length >= 3}
        onChange={(event) =>
          setSelected((ids) =>
            event.target.checked ? [...ids, row.entityId] : ids.filter((id) => id !== row.entityId),
          )
        }
      />
      <div className="decision-choice__content">
        <label htmlFor={`${selectionId}-${row.entityId}`} className="decision-choice__name">
          <strong>{entityName(row.entityId)}</strong>
        </label>
        <span className="decision-choice__status">
          {testedFindings?.find((finding) => finding.candidateId === row.entityId)?.outcome ===
          "limited-fit"
            ? t("已测范围可试用", "Trial within tested scope")
            : testedFindings?.find((finding) => finding.candidateId === row.entityId)?.outcome ===
                "tested-fail"
              ? t("该批任务实测未通过", "This task batch failed")
              : testedFindings?.find((finding) => finding.candidateId === row.entityId)?.outcome ===
                  "entry-unverified"
                ? t("样本通过，入口待核验", "Samples passed; verify interface")
                : row.ready
                  ? t("可以试用，效果待测", "Ready to try; quality untested")
                  : candidateEvidenceStatus(row, lang)}
        </span>
        {row.known.length ? (
          <div className="decision-choice__reasons">
            <span className="decision-choice__facts">
              {row.known
                .filter(
                  (finding, index, all) =>
                    all.findIndex((other) => other.finding === finding.finding) === index,
                )
                .map((finding) => (
                  <span key={finding.dimension}>
                    <b>{dimension(finding.dimension)}：</b>
                    {finding.finding.split(/(?<=[。])\s*|(?<=\.)\s+(?=[A-Z])/)[0]}
                    <span className="decision-choice__sources">
                      {(research.citations ?? [])
                        .filter((citation) => finding.claimIds.includes(citation.claim.id))
                        .flatMap((citation) => citation.evidence)
                        .filter(
                          (evidence, index, all) =>
                            all.findIndex((item) => item.url === evidence.url) === index,
                        )
                        .slice(0, 2)
                        .map((evidence) => (
                          <a
                            key={evidence.id}
                            href={evidence.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {evidence.url.includes("/models/")
                              ? t("型号说明", "Model documentation")
                              : evidence.url.includes("changelog")
                                ? t("更新记录", "Changelog")
                                : t("原始资料", "Original source")}
                          </a>
                        ))}
                    </span>
                  </span>
                ))}
            </span>
          </div>
        ) : (
          <span className="decision-choice__description">
            {t(
              "当前知识库尚无足够的已审核用途依据",
              "The current knowledge base lacks sufficient reviewed purpose evidence",
            )}
          </span>
        )}
        {!row.ready && (
          <span className="decision-choice__description">
            {row.missing.length
              ? t("本次未核验项：", "Not verified in this analysis: ") +
                row.missing.map(dimension).join("、")
              : t(
                  "请先查看产品资料，当前不能确认满足要求",
                  "Check product information; fit is not established",
                )}
          </span>
        )}
        {row.estimatedCost && (
          <span className="decision-choice__estimate">{row.estimatedCost.finding}</span>
        )}
        {!row.ready && row.gaps?.some((gap) => gap.reason === "needs-input") && (
          <span className="decision-choice__description">
            {row.gaps.find((gap) => gap.reason === "needs-input")?.detail}
            {research.decisionContext && (
              <Link
                className="decision-choice__link"
                to={decisionResumePath(research.decisionContext)}
                onClick={(event) => event.stopPropagation()}
              >
                {t("补充这些条件", "Clarify these conditions")}
              </Link>
            )}
          </span>
        )}
      </div>
    </div>
  );
  return (
    <section
      className="decision-choice"
      aria-label={t("选择候选与下一步", "Choose candidates and the next step")}
    >
      {error && (
        <p role="alert">
          {error}{" "}
          <Link to="/account" search={{ returnTo: `/research/${research.id}` }}>
            {t("登录并返回", "Sign in and return")}
          </Link>
        </p>
      )}
      {!!shown.length && (
        <>
          <h3>{t("先选一个试用", "Choose one to try")}</h3>
          <p className="decision-choice__context">
            {research.decisionContext?.taskType === "model-api"
              ? t(
                  "这里选择的是底层模型，需要在你已有的 API、网关或产品入口使用。勾选不会开通账户或调用模型。",
                  "These are underlying models for an existing API, gateway or product interface. Selecting does not provision access or call a model.",
                )
              : t(
                  "在已有产品中完成一次真实任务，再回来记录效果。准备任务不会调用产品或产生费用。",
                  "Try one real task in a product you can access, then record the outcome here. Preparing a task makes no calls or charges.",
                )}
          </p>
          <div className="decision-choice__list">{shown.map(renderRow)}</div>
          {!!more.length && (
            <details className="decision-choice__more">
              <summary>
                {t(`查看其他候选（${more.length}个）`, `Inspect other candidates (${more.length})`)}
              </summary>
              <p className="decision-choice__hint">
                {t(
                  "以下状态只描述本次分析取得的知识库依据；未核验不代表网上没有资料或产品不支持。",
                  "These states describe knowledge-base evidence retrieved for this analysis. Unverified does not mean unavailable online or unsupported.",
                )}
              </p>
              <div className="decision-choice__list">{more.map(renderRow)}</div>
            </details>
          )}
          <div className="decision-choice__actions">
            {onTrial && (
              <Button disabled={!recordMode} onClick={() => onTrial(selected)}>
                {recordMode === "qualification"
                  ? t(
                      "准备这些候选的资格核验记录",
                      "Prepare qualification records for these candidates",
                    )
                  : t("查看试用任务", "View trial task")}
              </Button>
            )}
            {canCompare ? (
              <Button variant="outline" onClick={() => setComparing(true)}>
                {t(
                  `对比已选 ${selected.length} 个`,
                  `Compare ${selected.length} selected candidates`,
                )}
              </Button>
            ) : null}
          </div>
          <p className="decision-choice__hint" role="status">
            {selected.length
              ? t(
                  `已选：${selected.map(entityName).join("、")}`,
                  `Selected: ${selected.map(entityName).join(", ")}`,
                )
              : t("先勾选一个候选，再继续。", "Select a candidate to continue.")}
          </p>
          {!!selected.length && !canTrial && (
            <p className="decision-choice__hint">
              {recordMode === "qualification"
                ? t(
                    "使用条件尚未确认。资格核验记录只记录实际入口与必要条件，不作为业务效果成绩。",
                    "Use conditions are unconfirmed. Qualification notes record interfaces and required conditions, not task performance.",
                  )
                : t(
                    "所选候选有尚未确认的条件。先只勾选“可以试用”的候选；其他候选需补充条件或资料后重新分析。",
                    "A selected candidate has unconfirmed conditions. Select only candidates marked ready to try, or clarify conditions/evidence and reanalyze first.",
                  )}
            </p>
          )}
          {comparing && canCompare && (
            <section
              aria-label={t("已选候选功能对比", "Selected candidate feature comparison")}
              className="decision-choice__comparison"
            >
              <h3>{t("已选候选的已知功能", "Documented features of selected candidates")}</h3>
              <Button variant="ghost" onClick={() => setComparing(false)}>
                {t("收起对比", "Hide comparison")}
              </Button>
              <p className="decision-choice__hint">
                {t(
                  "未确认项不表示不支持。实际效果需要同一批任务试用。",
                  "Unconfirmed does not mean unsupported. Compare actual quality with the same tasks.",
                )}
              </p>
              {comparisonRows.length ? (
                <table className="decision-choice__table">
                  <thead>
                    <tr>
                      <th>{t("比较项", "Feature")}</th>
                      {selected.map((id) => (
                        <th key={id}>{entityName(id)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">{row.dimension}</th>
                        {selected.map((id) => {
                          const cell = row.cells.find((item) => item.entityId === id);
                          return (
                            <td key={id} data-candidate={entityName(id)}>
                              {cell?.facts.length
                                ? cell.facts.map((fact) => (
                                    <p key={fact.finding}>
                                      {fact.finding}{" "}
                                      {fact.claimIds.map((claimId, index) => (
                                        <a
                                          key={claimId}
                                          href={`#claim-${claimId}`}
                                          className="decision-choice__link"
                                        >
                                          {t("依据", "Source")} {index + 1}
                                        </a>
                                      ))}
                                    </p>
                                  ))
                                : cell?.otherPriceBasis
                                  ? t(
                                      "报价口径不同，见对应报价行",
                                      "Different quote basis; see its quote row",
                                    )
                                  : t("尚未确认", "Unconfirmed")}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>
                  {t(
                    "这几个候选暂时没有可并列比较的已知资料。可以先更新结果，或换其他候选。",
                    "These candidates have no documented facts to compare yet. Update the results or choose different candidates.",
                  )}
                </p>
              )}
              {selected.every(isComparable) && (
                <Link
                  className="decision-choice__link"
                  to="/compare"
                  search={{ models: selected.join(","), research: research.id }}
                >
                  {t("打开完整模型参数对比", "Open full model specification comparison")}
                </Link>
              )}
            </section>
          )}
        </>
      )}
      <div className="decision-choice__refresh">
        <div className="decision-choice__actions">
          <Button
            variant="link"
            disabled={busy || !research.decisionContext}
            onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setBusy(true);
              setError("");
              try {
                const next = await refreshDecision(
                  research,
                  lang,
                  readAuthToken(),
                  userApi.research,
                );
                window.location.assign(`/research/${encodeURIComponent(next.id)}`);
              } catch (reason) {
                setError(accountErrorMessage(reason, t));
              } finally {
                inFlight.current = false;
                setBusy(false);
              }
            }}
          >
            {busy
              ? t("正在更新结果…", "Updating results…")
              : t("用最新资料重新分析", "Reanalyze with current evidence")}
          </Button>
          {research.decisionContext && (
            <Link
              className="decision-choice__link"
              to={decisionResumePath(research.decisionContext)}
            >
              {t("修改我的要求", "Edit my requirements")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
