import { Link } from "@tanstack/react-router";
import { cloneElement, isValidElement, useCallback, useRef, useState, type ReactNode } from "react";
import { useApp } from "@/lib/app-state";
import type { DecisionValidation, ResearchResult } from "@/services/user-api";
import scenarios from "../../../backend/data/decision_scenarios.v1.json";
import { decisionPresentation } from "@/domain/decision-presentation";
import { DecisionGuide } from "./DecisionGuide";
import { compactFindings, decisionReading } from "@/domain/decision-reading";
import { DecisionPlan } from "./DecisionPlan";
import { planDimensionName, trialQualificationLabel } from "@/domain/decision-plan-reading";
import { DecisionChoice } from "./DecisionChoice";
import { DecisionEvidenceRequests } from "./DecisionEvidenceRequests";
import { decisionVerdict } from "@/domain/decision-verdict";
import { Button } from "@/components/ui/button";

export function DecisionBrief({
  research,
  entityName,
  isComparable = () => true,
  outcomeLevel = 3,
  validationContent,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
  isComparable?: (id: string) => boolean;
  outcomeLevel?: 2 | 3;
  validationContent?: ReactNode;
}) {
  const { t, lang } = useApp();
  const [expandedCandidates, setExpandedCandidates] = useState(false);
  const [recordedResearchId, setRecordedResearchId] = useState<string | null>(null);
  const [trialRequest, setTrialRequest] = useState<{ ids: string[]; nonce: number } | undefined>();
  const [validation, setValidation] = useState<DecisionValidation | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const onValidationChange = useCallback(
    (value: DecisionValidation | null) => setValidation(value),
    [],
  );
  const onRecordsChange = useCallback(
    (recorded: boolean) => setRecordedResearchId(recorded ? research.id : null),
    [research.id],
  );
  const validationNode = isValidElement<{
    onRecordsChange?: (recorded: boolean) => void;
    onValidationChange?: (validation: DecisionValidation | null) => void;
    trialRequest?: { ids: string[]; nonce: number };
  }>(validationContent)
    ? cloneElement(validationContent, {
        key: "private-validation",
        onRecordsChange,
        onValidationChange,
        trialRequest,
      })
    : validationContent;
  const validationFirst = recordedResearchId === research.id;
  const workspace = validationNode && (
    <div
      key="private-workspace"
      ref={workspaceRef}
      className="decision-workspace"
      hidden={!validationFirst && !trialRequest}
    >
      {validationNode}
    </div>
  );
  const dimensionName = (key: string) => {
    const feature = scenarios.features[key as keyof typeof scenarios.features];
    if (feature) return t(feature.name.zh, feature.name.en);
    return (
      (
        {
          "task-quality": t("业务效果", "Task quality"),
          speed: t("速度", "Speed"),
          "api-price": t("API 费用", "API cost"),
          context: t("上下文", "Context"),
          deployment: t("部署", "Deployment"),
          region: t("地区", "Region"),
          "input-modalities": t("输入模态", "Input modalities"),
          "commercial-use": t("商用许可", "Commercial use"),
          access: t("权重获取", "Weight access"),
          evidence: t("当前证据", "Current evidence"),
        } as Record<string, string>
      )[key] ?? key
    );
  };
  const decision = research.decision;
  if (!decision) return null;
  const hasTrialCandidates = !!decision.plan?.trialCandidateIds.length;
  const reading = decisionReading(decision, entityName);
  const presentation = decisionPresentation(research, lang);
  const verdict = decisionVerdict(research, validation, entityName, lang);
  const OutcomeHeading = outcomeLevel === 2 ? "h2" : "h3";
  const shownCandidates = expandedCandidates
    ? decision.candidates
    : decision.candidates?.slice(0, 6);
  const compareIds = [
    decision.recommendation.primaryEntityId,
    ...decision.recommendation.alternativeEntityIds,
    ...(decision.recommendation.validationEntityIds ?? []),
  ]
    .filter(
      (id, index, values): id is string =>
        typeof id === "string" && values.indexOf(id) === index && isComparable(id),
    )
    .slice(0, 4);

  return (
    <section
      className="decision-brief decision-brief--choice"
      lang={lang === "zh" ? "zh-CN" : "en"}
      aria-label={t("结构化决策说明", "Decision brief")}
    >
      <div className="decision-brief__recommendation">
        <div
          className="decision-outcome"
          data-outcome={presentation.allExcluded ? "excluded" : decision.status}
        >
          <OutcomeHeading className="decision-outcome__headline">{verdict.headline}</OutcomeHeading>
          <p className="decision-outcome__summary">{verdict.summary}</p>
          <p className="decision-verdict__next">
            <strong>{t("下一步：", "Next: ")}</strong>
            {verdict.next}
          </p>
          {verdict.source === "private" && validationContent && (
            <Button
              variant="outline"
              onClick={() => {
                setTrialRequest({ ids: [], nonce: Date.now() });
                requestAnimationFrame(() => {
                  workspaceRef.current?.scrollIntoView({ block: "start" });
                  workspaceRef.current
                    ?.querySelector<HTMLElement>(".decision-validation__title")
                    ?.focus();
                });
              }}
            >
              {t("查看或补齐我的试用记录", "Inspect or complete my trial records")}
            </Button>
          )}
          {validationFirst && !validation && (
            <p role="status" className="decision-choice__hint">
              {t(
                "试用记录有修改或正在读取，当前不沿用旧实测判断；保存后更新。",
                "Trial notes are changing or loading. Earlier findings are not reused; save to update.",
              )}
            </p>
          )}
          <div className="decision-screening">
            {decision.candidates?.length ? (
              <p className="decision-outcome__counts">
                {t(
                  `可试用 ${decision.plan?.trialCandidateIds.length ?? presentation.counts.eligible} · 排除 ${presentation.counts.excluded} · 待核验 ${presentation.counts.unknown + (decision.plan ? presentation.counts.eligible - decision.plan.trialCandidateIds.length : 0)} · 冲突 ${presentation.counts.conflict}`,
                  `Ready for a business trial ${decision.plan?.trialCandidateIds.length ?? presentation.counts.eligible} · excluded ${presentation.counts.excluded} · awaiting verification ${presentation.counts.unknown + (decision.plan ? presentation.counts.eligible - decision.plan.trialCandidateIds.length : 0)} · conflicting ${presentation.counts.conflict}`,
                )}
              </p>
            ) : null}
          </div>
          <aside className="decision-note" aria-label={t("结论适用范围", "Scope of this advice")}>
            <span>{t("说明", "Note")}</span>
            <p>{verdict.boundary}</p>
          </aside>
        </div>
        {!!decision.missingInputs?.length && (
          <p role="status">
            {t("请补齐以下条件后重新分析：", "Complete these conditions and reanalyze: ")}
            {decision.missingInputs
              .map(
                (key) =>
                  ({
                    "budget-ceiling": t("预算上限", "Budget ceiling"),
                    "budget-currency": t("币种", "Currency"),
                    "billing-channel": t("计费渠道", "Billing channel"),
                    "matching-service-channel": t(
                      "一致的实际服务与计费渠道",
                      "Matching actual service and billing channels",
                    ),
                    "monthly-input-tokens": t("月输入 token", "Monthly input tokens"),
                    "monthly-output-tokens": t("月输出 token", "Monthly output tokens"),
                  })[key] ?? key,
              )
              .join("、")}
          </p>
        )}
        {decision.scenario && (
          <p className="decision-comparison__note">
            {t("业务场景：", "Business scenario: ")}
            {decision.scenario.name}
          </p>
        )}
      </div>
      <DecisionChoice
        key={research.id}
        research={research}
        entityName={entityName}
        isComparable={isComparable}
        testedFindings={
          verdict.source === "private" ? validation?.review?.conclusion?.findings : undefined
        }
        onTrial={
          validationContent
            ? (ids) => {
                setTrialRequest({ ids, nonce: Date.now() });
                requestAnimationFrame(() => {
                  workspaceRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
                  workspaceRef.current
                    ?.querySelector<HTMLElement>(".decision-validation__title")
                    ?.focus({ preventScroll: true });
                });
              }
            : undefined
        }
      />
      {validationContent && !hasTrialCandidates && (
        <DecisionEvidenceRequests
          key={`evidence-${research.id}`}
          research={research}
          entityName={entityName}
        />
      )}
      {workspace}
      <details className="decision-audit">
        <summary>{t("筛选依据与其他候选", "Screening details and other candidates")}</summary>
        {validationContent && hasTrialCandidates && (
          <div className="decision-maintenance">
            <p>
              {t(
                "以下资料缺口属于其他未入选候选，不影响上方候选的试用。只在你想进一步考虑这些候选时处理。",
                "These gaps concern other unqualified candidates and do not block trials above. Use this only to explore those alternatives.",
              )}
            </p>
            <DecisionEvidenceRequests
              key={`evidence-${research.id}`}
              research={research}
              entityName={entityName}
            />
          </div>
        )}
        {!!decision.recommendation.reasons?.length && (
          <EvidenceBoundList
            title={t("建议依据", "Recommendation basis")}
            items={compactFindings(decision.recommendation.reasons)}
          />
        )}
        {decision.scope && (
          <details className="decision-scope">
            <summary>{t("查看本次候选范围", "Inspect this candidate scope")}</summary>
            <p>{decision.scope.selectionBasis}</p>
            <p>
              {t("已检查相关对象", "Relevant candidates checked")}{" "}
              {decision.scope.consideredEntityIds.length} ·{" "}
              {t("本报告展示", "Shown in this report")} {decision.candidates?.length ?? 0}
            </p>
            {!!decision.scope.omittedEntityIds.length && (
              <p>
                {t("未展示的候选：", "Candidates outside this report: ")}
                {decision.scope.omittedEntityIds.map(entityName).join("、")}
              </p>
            )}
          </details>
        )}
        <div className="decision-next-actions">
          {decision.plan ? (
            <DecisionPlan
              plan={decision.plan}
              entityName={entityName}
              dimensionName={(key) => planDimensionName(key, lang)}
            />
          ) : (
            <DecisionList title={t("下一步行动", "Next actions")} items={reading.nextChecks} />
          )}
          <EvidenceBoundList
            title={t("影响决定的风险与未知", "Risks and unknowns affecting the decision")}
            items={decision.risks.map((item) => ({
              finding: item.detail,
              claimIds: item.claimIds,
            }))}
          />
        </div>
        {(reading.knownComparisons.length > 0 || reading.missingDimensions.length > 0) && (
          <section
            className="decision-comparison"
            aria-label={t("同维度依据", "Evidence by dimension")}
          >
            <h3>{t("同维度依据", "Evidence by dimension")}</h3>
            <p className="decision-comparison__note">
              {t(
                "未覆盖项保持未知。参数量、来源数量和不同测试成绩不作为能力排名。",
                "Uncovered dimensions remain unknown. Model size, source counts and different tests do not establish a ranking.",
              )}
            </p>
            {reading.knownComparisons.map((row, index) => (
              <details
                key={row.id}
                className="decision-comparison__row"
                open={index < 2 && row.cells.filter((cell) => cell.state !== "unknown").length <= 6}
              >
                <summary>
                  <h4>{row.dimension}</h4>
                  <span>
                    {t(
                      `${row.cells.filter((cell) => cell.state !== "unknown").length} 个候选有依据`,
                      `${row.cells.filter((cell) => cell.state !== "unknown").length} candidates with evidence`,
                    )}
                  </span>
                </summary>
                {row.cells.some((cell) => cell.state !== "unknown") &&
                  row.cells.some((cell) => cell.state === "unknown") && (
                    <details className="decision-comparison__note">
                      <summary>
                        {t(
                          `${row.cells.filter((cell) => cell.state === "unknown").length} 个候选此项待核验`,
                          `${row.cells.filter((cell) => cell.state === "unknown").length} candidates need evidence for this dimension`,
                        )}
                      </summary>
                      <p>
                        {row.cells
                          .filter((cell) => cell.state === "unknown")
                          .map((cell) => entityName(cell.entityId))
                          .join("、")}
                      </p>
                    </details>
                  )}
                {
                  <ul className="decision-comparison__cells">
                    {row.cells
                      .filter((cell) => cell.state !== "unknown")
                      .map((cell) => (
                        <li key={cell.entityId}>
                          <strong>{entityName(cell.entityId)}</strong>
                          {cell.state === "unknown" ? (
                            <p className="decision-comparison__unknown">
                              {t("当前引用未覆盖此项", "Not covered by current citations")}
                            </p>
                          ) : (
                            cell.facts.map((fact) => (
                              <p key={fact.claimIds.join("-")}>
                                {fact.finding}
                                <span className="decision-brief__claims">
                                  {fact.claimIds.map((claimId, index) => (
                                    <a
                                      key={claimId}
                                      href={`#claim-${claimId}`}
                                      className="text-signal hover:underline"
                                    >
                                      {t("查看依据", "View evidence")} {index + 1}
                                    </a>
                                  ))}
                                </span>
                              </p>
                            ))
                          )}
                        </li>
                      ))}
                  </ul>
                }
              </details>
            ))}
            {reading.missingDimensions.length > 0 && (
              <div className="decision-coverage-summary">
                <h4>{t("尚不能比较的维度", "Dimensions awaiting evidence")}</h4>
                <p>{reading.missingDimensions.join("、")}</p>
                <p>
                  {t(
                    "规格与条款需补充明确来源；业务效果与速度需同口径实测。资料缺失不表示产品不支持。",
                    "Specifications and terms need explicit sources; quality and speed need comparable tests. Missing evidence does not establish lack of support.",
                  )}
                </p>
              </div>
            )}
          </section>
        )}
        {decision.candidates && decision.candidates.length > 0 && (
          <section
            className="decision-candidates"
            aria-label={t("候选资格与证据覆盖", "Candidate eligibility and coverage")}
          >
            <div className="decision-candidates__title">
              <h3>{t("候选资格与证据覆盖", "Candidate eligibility and coverage")}</h3>
              <span>
                {t(
                  `${decision.candidates.length} 个候选`,
                  `${decision.candidates.length} candidates`,
                )}
              </span>
            </div>
            <p>
              {t(
                "先看候选是否满足必要条件，再比较已知事实。依据覆盖表示资料完整度，不代表模型能力排名。",
                "Check necessary constraints first, then compare known facts. Evidence coverage describes available information, not model capability.",
              )}
            </p>
            {reading.commonReasons.length > 0 && (
              <div className="decision-candidates__shared">
                <h4>{t("共同的资格缺口", "Shared qualification gaps")}</h4>
                <ul>
                  {reading.commonReasons.map(([reason, ids]) => (
                    <li key={reason}>
                      <span>{reason}</span>
                      <small>
                        {ids.length === decision.candidates!.length
                          ? t("全部候选", "All candidates")
                          : ids.map(entityName).join("、")}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="decision-candidates__list">
              {shownCandidates?.map((candidate) => (
                <li key={candidate.entityId}>
                  <div className="decision-candidates__heading">
                    <h4>{entityName(candidate.entityId)}</h4>
                    <span>
                      {trialQualificationLabel(decision, candidate.entityId, lang) ??
                        (candidate.eligibility === "eligible"
                          ? t("可继续验证", "Eligible for validation")
                          : candidate.eligibility === "excluded"
                            ? t("不符合硬条件", "Excluded by constraints")
                            : candidate.eligibility === "conflict"
                              ? t("证据冲突", "Conflicting evidence")
                              : t("待补充资料", "Needs evidence"))}
                    </span>
                  </div>
                  <p>
                    {reading.coverage(candidate.entityId).features > 0 && (
                      <>
                        {t("功能描述", "Described features")}{" "}
                        {reading.coverage(candidate.entityId).described}/
                        {reading.coverage(candidate.entityId).features} ·{" "}
                      </>
                    )}
                    {reading.coverage(candidate.entityId).hard > 0
                      ? t(
                          `硬条件依据 ${reading.coverage(candidate.entityId).verified}/${reading.coverage(candidate.entityId).hard}`,
                          `Constraint evidence ${reading.coverage(candidate.entityId).verified}/${reading.coverage(candidate.entityId).hard}`,
                        )
                      : t("未设置硬条件", "No hard constraints set")}
                    {!candidate.isConcreteVersion
                      ? ` · ${t("尚未确定具体版本", "Exact version not established")}`
                      : ""}
                  </p>
                  {reading.individualReasons(candidate.entityId).length > 0 && (
                    <ul>
                      {reading.individualReasons(candidate.entityId).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  {!!candidate.strengths?.length && (
                    <details>
                      <summary>
                        {t("查看功能描述与引用", "Inspect described features and citations")}
                      </summary>
                      <EvidenceBoundList
                        level={5}
                        title={t("与业务有关的功能描述", "Features described for this business")}
                        items={compactFindings(candidate.strengths)}
                      />
                    </details>
                  )}
                  {!!candidate.gaps?.length && (
                    <details>
                      <summary>
                        {t("未知原因与补充方向", "Unknowns and how to resolve them")}
                      </summary>
                      <ul>
                        {candidate.gaps.map((gap) => (
                          <li key={gap.dimension}>
                            <strong>{dimensionName(gap.dimension)}</strong>
                            {" · "}
                            {
                              {
                                "not-recorded": t("未收录", "Not recorded"),
                                "not-structured": t("资料未结构化", "Not structured"),
                                "not-current": t(
                                  "资料当前不可用于核验",
                                  "Evidence not current for verification",
                                ),
                                "needs-input": t("待补充条件", "Needs inputs"),
                                conflicting: t("事实冲突", "Conflicting facts"),
                                "requires-poc": t("待同口径实测", "Needs comparable testing"),
                              }[gap.reason]
                            }
                            <p>{gap.detail}</p>
                            {gap.claimIds.map((id) => (
                              <a
                                key={id}
                                href={`#claim-${id}`}
                                className="decision-brief__claims text-signal hover:underline"
                              >
                                {t("查看现有相关资料", "Inspect related evidence")}
                              </a>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {candidate.claimIds.length > 0 && (
                    <details>
                      <summary>{t("查看候选依据", "Inspect candidate evidence")}</summary>
                      <div className="decision-brief__claims">
                        {candidate.claimIds.map((id, index) => (
                          <a key={id} href={`#claim-${id}`} className="text-signal hover:underline">
                            {t("查看依据", "View evidence")} {index + 1}
                          </a>
                        ))}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            {decision.candidates.length > 6 && (
              <button
                type="button"
                className="text-signal hover:underline"
                aria-expanded={expandedCandidates}
                onClick={() => setExpandedCandidates((value) => !value)}
              >
                {expandedCandidates
                  ? t("收起候选列表", "Show fewer candidates")
                  : t(
                      `查看其余 ${decision.candidates.length - 6} 个候选`,
                      `Inspect ${decision.candidates.length - 6} remaining candidates`,
                    )}
              </button>
            )}
          </section>
        )}
        <details className="decision-supporting-details">
          <summary>
            {t("查看分析条件与补充依据", "Inspect applied conditions and additional evidence")}
          </summary>
          <div className="decision-brief__grid">
            <DecisionList
              title={t("分析采用的条件", "Applied conditions")}
              items={decision.conditions}
            />
            <EvidenceBoundList
              title={t("补充依据与边界", "Additional evidence and bounds")}
              items={reading.extraEvidence}
            />
          </div>
        </details>
        <DecisionGuide kind="results" />
        <div className="decision-brief__meta">
          {research.citationStates &&
            Object.values(research.citationStates).some((state) => state !== "current") && (
              <span role="status">
                {t("历史引用已重新核验：", "Historical citations revalidated: ")}
                {
                  Object.values(research.citationStates).filter((state) => state === "updated")
                    .length
                }
                {t("条已更新，", " updated, ")}
                {
                  Object.values(research.citationStates).filter((state) => state === "unavailable")
                    .length
                }
                {t("条当前不可用。请重新运行选型。", " unavailable. Run the decision again.")}
              </span>
            )}
          <span>
            {t("证据截止", "Evidence as of")} {new Date(decision.asOf).toLocaleString()}
          </span>
          {compareIds.length >= 2 && (
            <Link
              to="/compare"
              search={{ models: compareIds.join(","), research: research.id }}
              className="font-medium text-signal hover:underline"
            >
              {t("打开模型对比", "Open model comparison")} →
            </Link>
          )}
        </div>
      </details>
    </section>
  );
}

function DecisionList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="decision-brief__list">
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EvidenceBoundList({
  title,
  items,
  level = 3,
}: {
  title: string;
  items: Array<{ finding: string; claimIds: string[] }>;
  level?: 3 | 5;
}) {
  const { t } = useApp();
  if (!items.length) return null;
  const Heading = level === 5 ? "h5" : "h3";
  return (
    <div className="decision-brief__list">
      <Heading>{title}</Heading>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={`${item.finding}-${item.claimIds.join("-")}`}>
              <span>{item.finding}</span>
              {item.claimIds.length > 0 && (
                <span className="decision-brief__claims">
                  {item.claimIds.map((claimId, index) => (
                    <a
                      key={claimId}
                      href={`#claim-${claimId}`}
                      className="font-mono text-xs text-signal hover:underline"
                    >
                      {t("查看依据", "View evidence")} {index + 1}
                    </a>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
