import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { accountErrorMessage } from "@/services/auth-errors";
import { decisionReportHtml, downloadReport } from "@/domain/decision-report-html";
import { validationTitle } from "@/domain/decision-presentation";
import {
  groupValidationItems,
  fillCandidateConditions,
  mergeValidationPlan,
  retainValidationDraft,
  validationItemHeading,
  patchValidationItem,
  type ValidationItemPatch,
} from "@/domain/decision-validation-view";
import { validationReviewReading } from "@/domain/decision-validation-review";
import { DecisionMeasurements, RecordedMeasurements } from "./DecisionMeasurements";
import { DecisionTrialEntry } from "./DecisionTrialEntry";
import { DecisionApiTrial } from "./DecisionApiTrial";
import { candidateRecordMode } from "@/domain/decision-choice";
import {
  createValidationPlan,
  decisionResumePath,
  validationMarkdown,
} from "@/domain/decision-workflow";
import {
  userApi,
  type DecisionValidation,
  type DecisionValidationItem,
  type ResearchResult,
} from "@/services/user-api";

export function DecisionValidationPanel({
  research,
  token,
  entityName,
  headingLevel = 3,
  onRecordsChange,
  onValidationChange,
  trialRequest,
}: {
  research: ResearchResult;
  token: string;
  entityName: (id: string) => string;
  headingLevel?: 2 | 3;
  onRecordsChange?: (recorded: boolean) => void;
  onValidationChange?: (validation: DecisionValidation | null) => void;
  trialRequest?: { ids: string[]; nonce: number };
}) {
  const { t, lang } = useApp();
  const PanelHeading = headingLevel === 2 ? "h2" : "h3";
  const GroupHeading = headingLevel === 2 ? "h3" : "h4";
  const ItemHeading = headingLevel === 2 ? "h4" : "h5";
  const [saved, setSaved] = useState<DecisionValidation | null>(null);
  const [items, setItems] = useState<DecisionValidationItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const handledTrialRequest = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [reportPreview, setReportPreview] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selectedTrialIds, setSelectedTrialIds] = useState<string[]>([]);
  const [privateFile, setPrivateFile] = useState<{ url: string; filename: string } | null>(null);
  useEffect(
    () => () => {
      if (privateFile) URL.revokeObjectURL(privateFile.url);
    },
    [privateFile],
  );
  useEffect(() => {
    setPrivateFile(null);
  }, [items, research.id, lang]);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSaved(null);
    setItems([]);
    setError("");
    setMessage("");
    setShowAll(false);
    setSelectedTrialIds([]);
    userApi
      .decisionValidation(token, research.id)
      .then((value) => {
        if (cancelled) return;
        setSaved(value);
        setItems(value.items);
        setLoaded(true);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "验证记录读取失败 / Validation failed to load",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [research.id, token]);
  useEffect(() => {
    onRecordsChange?.(
      saved?.items.some(
        (item) =>
          !!item.result.trim() ||
          item.status !== "pending" ||
          (item.measurements &&
            Object.values(item.measurements).some((value) => value != null && value !== "")),
      ) ?? false,
    );
  }, [onRecordsChange, saved]);
  const currentSaved =
    saved && JSON.stringify(saved.items) === JSON.stringify(items) ? saved : null;
  useEffect(() => {
    onValidationChange?.(currentSaved);
  }, [onValidationChange, currentSaved]);
  useEffect(() => {
    if (!loaded || !trialRequest || handledTrialRequest.current === trialRequest.nonce) return;
    handledTrialRequest.current = trialRequest.nonce;
    const ids = trialRequest.ids;
    const mode = candidateRecordMode(research, ids);
    if (!mode) return;
    setSelectedTrialIds(ids);
    try {
      setItems(mergeValidationPlan(items, createValidationPlan(research, ids)));
    } catch (reason) {
      setError(accountErrorMessage(reason, t));
      return;
    }
    setMessage(
      mode === "qualification"
        ? t(
            "已准备资格核验记录，只核对使用条件；没有生成业务实测成绩，原有笔记保留。",
            "Qualification notes prepared for use-condition checks only. No task results generated; existing notes retained.",
          )
        : t(
            "已为所选候选准备待测记录。实际试用后再填写，原有笔记保留。",
            "Pending records prepared for the selected candidates. Fill them after testing; existing notes are retained.",
          ),
    );
  }, [loaded, trialRequest, research, items, t]);
  if (!research.decisionContext) return null;
  const stale = Object.values(research.citationStates ?? {}).some((state) => state !== "current");
  const trialIds = research.decision?.plan?.trialCandidateIds ?? [];
  const selectionIds = trialIds.length
    ? trialIds
    : (research.decision?.candidates
        ?.filter((candidate) => candidate.eligibility !== "excluded")
        .map((candidate) => candidate.entityId) ?? []);
  const canPrepare =
    !research.decision?.plan ||
    !["needs-input", "all-excluded", "no-candidates", "failed"].includes(
      research.decision.plan.state,
    );
  const chooseCandidates = canPrepare && selectionIds.length > 3;
  const selectedPlan = () =>
    createValidationPlan(research, chooseCandidates ? selectedTrialIds : undefined);
  const groups = groupValidationItems(items);
  const recordedGroups = groups.filter((group) => group.recorded);
  const hasActualResults = items.some(
    (item) =>
      item.status !== "pending" ||
      item.result.trim() ||
      Object.values(item.measurements ?? {}).some((value) => value != null && value !== ""),
  );
  const visibleGroups = showAll || !recordedGroups.length ? groups : recordedGroups;
  const isSaved = !!saved && JSON.stringify(saved.items) === JSON.stringify(items);
  const review =
    isSaved && saved?.review?.sourceRevision === saved?.revision ? saved?.review : undefined;
  const reviewReading = review
    ? validationReviewReading(review, entityName, lang, items)
    : undefined;
  const statusLabel = (status: DecisionValidationItem["status"]) =>
    ({
      pending: t("待验证", "Pending"),
      passed: t("实测通过", "Passed in testing"),
      failed: t("实测未通过", "Failed in testing"),
      blocked: t("缺少验证条件", "Blocked"),
    })[status];
  const update = (id: string, patch: ValidationItemPatch) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? patchValidationItem(item, patch) : item)),
    );
    setMessage("");
  };
  return (
    <section
      className="decision-validation"
      aria-label={t("验证计划与实际结果", "Validation plan and actual results")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelHeading className="decision-validation__title">
          {t("准备试用与记录结果", "Prepare a trial and record results")}
        </PanelHeading>
        <a
          href={decisionResumePath(research.decisionContext)}
          className="text-sm text-signal hover:underline"
        >
          {t("带入条件重新分析", "Reanalyze with these conditions")} →
        </a>
      </div>
      <p>
        {t(
          "用同一批业务样本核验候选。记录属于当前账户，不会自动成为公开事实；重新分析会保留原记录。",
          "Validate candidates with the same business samples. Notes belong to your account and do not become public facts. Reanalysis preserves the original record.",
        )}
      </p>
      {stale && (
        <p role="status">
          {t(
            "原引用已发生变化；请重新分析后再决定。此处保留你记录的实际测试结果。",
            "Original citations have changed. Reanalyze before deciding; your actual test notes remain here.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!loaded && !error && (
        <p role="status">{t("正在读取私密验证记录…", "Loading private validation notes…")}</p>
      )}
      {loaded && chooseCandidates && (
        <details className="decision-validation__conditions" open={!items.length}>
          <summary>
            {trialIds.length
              ? t("选择本轮要验证的候选", "Select candidates for this trial")
              : t("选择先核验资格的候选", "Select candidates for eligibility checks")}
          </summary>
          <p>
            {trialIds.length
              ? t(
                  "先选1–3个合格候选，使用同一批样本。展示顺序不代表性能排名；原有测试记录保留。",
                  "Choose 1–3 qualified candidates for the same samples. Display order is not a performance ranking; existing records are retained.",
                )
              : t(
                  "先选1–3个待核验候选，补足具体版本、入口与条款依据后再测试业务。展示顺序不代表排名，原记录保留。",
                  "Choose 1–3 candidates to verify versions, interfaces and terms before business testing. Display order is not a ranking; existing records are retained.",
                )}
          </p>
          <div className="decision-validation__trial-choices">
            {selectionIds.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={selectedTrialIds.includes(id)}
                  disabled={!selectedTrialIds.includes(id) && selectedTrialIds.length >= 3}
                  onChange={(event) =>
                    setSelectedTrialIds((ids) =>
                      event.target.checked ? [...ids, id] : ids.filter((key) => key !== id),
                    )
                  }
                />
                {entityName(id)}
              </label>
            ))}
          </div>
        </details>
      )}
      {loaded && !items.length && !canPrepare && (
        <p>
          {t(
            "先完成下方‘现在先做什么’，再创建验证清单。",
            "Complete the next action below before creating a validation checklist.",
          )}
        </p>
      )}
      {loaded && !items.length && canPrepare && (
        <Button
          type="button"
          variant="outline"
          disabled={chooseCandidates && !selectedTrialIds.length}
          onClick={() => {
            setItems(selectedPlan());
            setMessage(t("清单已生成，尚未保存。", "Checklist created; not saved yet."));
          }}
        >
          {research.decision?.plan && research.decision.plan.state !== "ready-to-validate"
            ? t("创建资格核验清单", "Create qualification checklist")
            : t("准备一次试用", "Prepare a trial")}
        </Button>
      )}
      {items.length > 0 && (
        <div className="decision-validation__items">
          <div className="decision-validation__overview">
            <p role="status">
              {t(
                `已准备 ${groups.length} 个候选 · 填写进度 ${recordedGroups.length}/${groups.length}`,
                `${groups.length} candidates prepared · notes started for ${recordedGroups.length}/${groups.length}`,
              )}
              <span>{isSaved ? t("已保存", "Saved") : t("有未保存的修改", "Unsaved changes")}</span>
            </p>
            {recordedGroups.length > 0 && recordedGroups.length < groups.length && (
              <Button type="button" variant="outline" onClick={() => setShowAll((value) => !value)}>
                {showAll
                  ? t("只看已有记录", "Show candidates with notes")
                  : t(`显示全部候选（${groups.length}）`, `Show all candidates (${groups.length})`)}
              </Button>
            )}
          </div>
          <div className="decision-validation__review">
            {reviewReading ? (
              <>
                {reviewReading.conclusion && (
                  <section
                    className="decision-validation__conclusion"
                    aria-label={t(
                      "基于私人实测的选型判断",
                      "Selection based on private test records",
                    )}
                  >
                    <GroupHeading>
                      {t("基于私人实测的选型判断", "Selection based on private test records")}
                    </GroupHeading>
                    <p className="decision-validation__judgment">
                      <strong>{reviewReading.conclusion.headline}</strong>
                    </p>
                    <p>{reviewReading.conclusion.action}</p>
                    {reviewReading.conclusion.numericGroups.map((group, index) => (
                      <section key={index}>
                        <ItemHeading>{group.title}</ItemHeading>
                        <table className="decision-validation__numeric-table">
                          <thead>
                            <tr>
                              <th>{t("候选", "Candidate")}</th>
                              <th>{t("记录数值", "Recorded value")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map((row) => (
                              <tr key={row.id}>
                                <td>{row.preferred ? <strong>{row.name}</strong> : row.name}</td>
                                <td>{row.preferred ? <strong>{row.value}</strong> : row.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="decision-validation__review-note">{group.note}</p>
                        <details className="decision-secondary-details">
                          <summary>
                            {t(
                              "查看本组样本与配置",
                              "Inspect this group's samples and configuration",
                            )}
                          </summary>
                          <p>{group.basis}</p>
                        </details>
                      </section>
                    ))}
                    {reviewReading.conclusion.findings.map((row) => (
                      <div key={row.candidateId}>
                        <p>
                          <strong>{row.title}</strong>：{row.finding}
                        </p>
                        {row.result && <p>{row.result}</p>}
                        {row.scope && (
                          <details className="decision-secondary-details">
                            <summary>
                              {t("查看测试范围与版本", "Inspect test scope and version")}
                            </summary>
                            <p className="decision-validation__review-note">{row.scope}</p>
                          </details>
                        )}
                      </div>
                    ))}
                    {reviewReading.conclusion.untested && (
                      <p className="decision-validation__review-note">
                        {reviewReading.conclusion.untested}
                      </p>
                    )}
                  </section>
                )}
                {(!reviewReading.conclusion || reviewReading.comparisons.length > 0) && (
                  <p>{reviewReading.nextStep}</p>
                )}
                {reviewReading.comparisons.length > 0 && (
                  <details className="decision-secondary-details">
                    <summary>
                      {t(
                        `查看同口径记录（${reviewReading.comparisons.length} 组）`,
                        `Inspect matching records (${reviewReading.comparisons.length} groups)`,
                      )}
                    </summary>
                    {reviewReading.comparisons.map((group) => (
                      <div key={group.title + group.basis}>
                        <p>
                          <strong>{group.title}</strong>
                        </p>
                        <p>{group.basis}</p>
                      </div>
                    ))}
                  </details>
                )}
              </>
            ) : (
              <p>
                {t(
                  "保存后复核记录完整度与比较口径；未保存的修改不沿用旧复核。",
                  "Save to review completeness and comparison bases. Unsaved changes do not reuse an earlier review.",
                )}
              </p>
            )}
            {review?.candidates.some((row) =>
              row.checks.some((check) => check.reason === "missing"),
            ) && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || (chooseCandidates && !selectedTrialIds.length)}
                onClick={() => {
                  try {
                    setItems(mergeValidationPlan(items, selectedPlan()));
                    setMessage(
                      t(
                        "缺少的验证项目已补入草稿，原记录已保留；请保存。",
                        "Missing checks added to the draft; original notes retained. Save to review.",
                      ),
                    );
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                  }
                }}
              >
                {t("补齐缺少的验证项目", "Add missing checks")}
              </Button>
            )}
          </div>
          <DecisionApiTrial
            research={research}
            items={items}
            entityName={entityName}
            onApply={(next) => {
              setItems(next);
              setMessage("");
            }}
          />
          <DecisionTrialEntry
            research={research}
            requestedCandidate={
              trialRequest?.ids[0]
                ? { id: trialRequest.ids[0], nonce: trialRequest.nonce }
                : undefined
            }
            items={items}
            priority={research.decisionContext.priority}
            entityName={entityName}
            onChange={update}
            onReuse={(sourceId) => {
              setItems((current) => fillCandidateConditions(current, sourceId));
              setMessage(
                t(
                  "仅填入该候选的空口径字段，已有记录保留。",
                  "Only empty conditions filled for this candidate; existing records retained.",
                ),
              );
            }}
          />
          <details className="decision-validation__records" open={showAll}>
            <summary>
              {t(
                `查看测试记录与配置（${visibleGroups.reduce((count, group) => count + group.items.length, 0)} 项）`,
                `Inspect test records and configuration (${visibleGroups.reduce((count, group) => count + group.items.length, 0)} checks)`,
              )}
            </summary>
            {reviewReading && (
              <>
                <p>
                  <strong>{reviewReading.headline}</strong>
                </p>
                <p className="decision-validation__review-note">{reviewReading.caution}</p>
              </>
            )}
            {visibleGroups.map((group) => (
              <section
                key={group.candidateId ?? "decision"}
                className="decision-validation__candidate"
              >
                <GroupHeading className="decision-validation__candidate-heading">
                  {group.candidateId
                    ? entityName(group.candidateId)
                    : t("本次决策", "This decision")}
                </GroupHeading>
                {review?.candidates.find(
                  (row) => row.candidateId === (group.candidateId ?? null),
                ) && (
                  <p className="decision-validation__candidate-progress">
                    {t("记录口径齐备", "Complete records")}{" "}
                    {
                      review.candidates.find(
                        (row) => row.candidateId === (group.candidateId ?? null),
                      )!.completedChecks
                    }
                    /4
                  </p>
                )}
                {group.items.map((item) => (
                  <div key={item.id} className="decision-validation__item">
                    <div className="decision-validation__item-heading">
                      <ItemHeading className="decision-validation__item-title">
                        {validationItemHeading(item, lang)}
                      </ItemHeading>
                      <span>{statusLabel(item.status)}</span>
                    </div>
                    {review?.candidates
                      .flatMap((row) => row.checks)
                      .filter(
                        (check) =>
                          check.itemIds.includes(item.id) &&
                          ["conditions-missing", "ambiguous"].includes(check.reason),
                      )
                      .map((check) => (
                        <p key={check.dimension} className="decision-validation__review-note">
                          {check.reason === "ambiguous"
                            ? t(
                                "同一项目存在多份记录，暂不能确认比较口径。",
                                "Multiple records exist for this check; its comparison basis is ambiguous.",
                              )
                            : t(
                                "旧笔记缺少实测口径，请补齐版本、配置、样本量、日期和范围。",
                                "Legacy notes lack complete test conditions. Add version, configuration, sample count, date and scope.",
                              )}
                        </p>
                      ))}
                    {item.result.trim() && (
                      <p className="decision-validation__result">{item.result}</p>
                    )}
                    <RecordedMeasurements item={item} />
                    <details className="decision-validation__editor">
                      <summary>{t("编辑验证记录", "Edit validation record")}</summary>
                      <p>{validationTitle(item.title, lang)}</p>
                      <DecisionMeasurements
                        item={item}
                        onChange={(patch) => update(item.id, patch)}
                      />
                      <label>
                        {t("核验状态", "Validation status")}
                        <select
                          value={item.status}
                          onChange={(event) =>
                            update(item.id, {
                              status: event.target.value as DecisionValidationItem["status"],
                            })
                          }
                        >
                          <option value="pending">{t("待验证", "Pending")}</option>
                          <option value="passed">{t("实测通过", "Passed in testing")}</option>
                          <option value="failed">{t("实测未通过", "Failed in testing")}</option>
                          <option value="blocked">{t("缺少验证条件", "Blocked")}</option>
                        </select>
                      </label>
                      <details className="decision-validation__conditions">
                        <summary>{t("记录实测口径", "Record test conditions")}</summary>
                        <p>
                          {t(
                            "填写实测口径后，标记通过或未通过时须填齐各项。旧笔记会保留，未填写的条件仍未知。",
                            "Once test conditions are entered, all fields are required to mark a pass or failure. Existing notes are retained; missing conditions remain unknown.",
                          )}
                        </p>
                        <div className="decision-validation__condition-fields">
                          {(
                            [
                              "modelVersion",
                              "configuration",
                              "sampleCount",
                              "testedAt",
                              "scope",
                            ] as const
                          ).map((field) => (
                            <label key={field}>
                              {
                                {
                                  modelVersion: t(
                                    "具体模型或产品版本",
                                    "Exact model or product version",
                                  ),
                                  configuration: t(
                                    "配置、工具与环境",
                                    "Configuration, tools and environment",
                                  ),
                                  sampleCount: t("样本量", "Sample count"),
                                  testedAt: t("测试日期", "Test date"),
                                  scope: t(
                                    "业务样本范围与合格标准",
                                    "Business sample scope and acceptance criteria",
                                  ),
                                }[field]
                              }
                              <input
                                type={field === "sampleCount" ? "number" : "text"}
                                placeholder={field === "testedAt" ? "YYYY-MM-DD" : undefined}
                                min={field === "sampleCount" ? 1 : undefined}
                                max={field === "sampleCount" ? 100000000 : undefined}
                                maxLength={
                                  field === "configuration" || field === "scope"
                                    ? 1000
                                    : field === "testedAt"
                                      ? 10
                                      : 200
                                }
                                value={
                                  field === "testedAt"
                                    ? (item.testConditions?.testedAt?.slice(0, 10) ?? "")
                                    : (item.testConditions?.[field] ?? "")
                                }
                                onChange={(event) =>
                                  update(item.id, {
                                    testConditions: {
                                      [field]:
                                        field === "sampleCount"
                                          ? event.target.value
                                            ? Number(event.target.value)
                                            : null
                                          : event.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setItems((current) => fillCandidateConditions(current, item.id));
                            setMessage(
                              t(
                                "已填入同一候选的空口径字段。保存前请核对各项目的实际设置。",
                                "Empty condition fields filled for this candidate. Check each measurement's actual settings before saving.",
                              ),
                            );
                          }}
                        >
                          {t(
                            "将口径填入本候选的空字段",
                            "Reuse settings in this candidate's empty fields",
                          )}
                        </Button>
                      </details>
                      <label>
                        {t("实际结果与测试条件", "Actual results and test conditions")}
                        <textarea
                          value={item.result}
                          maxLength={3000}
                          rows={5}
                          placeholder={t(
                            "记录样本、具体版本、环境、结果和日期；不要把待验证项标成通过。",
                            "Record samples, exact version, environment, results and date. Do not mark untested items as passed.",
                          )}
                          onChange={(event) => update(item.id, { result: event.target.value })}
                        />
                      </label>
                    </details>
                  </div>
                ))}
              </section>
            ))}
          </details>
        </div>
      )}
      {privateFile && (
        <p role="status">
          {t(
            "私人报告已生成。如果未开始下载：",
            "Private report generated. If download did not start: ",
          )}
          <a
            href={privateFile.url}
            download={privateFile.filename}
            className="font-medium text-signal underline"
          >
            {privateFile.filename.endsWith(".md")
              ? t("保存私人 Markdown", "Save private Markdown")
              : t("保存私人排版报告", "Save private report")}
          </a>
        </p>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <details className="decision-validation__exports">
          <summary>{t("导出或预览我的记录", "Export or preview my records")}</summary>
          <div className="flex flex-wrap gap-3">
            {items.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setReportPreview((value) => !value)}
              >
                {reportPreview
                  ? t("收起排版预览", "Hide report preview")
                  : t("预览排版报告", "Preview formatted report")}
              </Button>
            )}
            {items.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const isSaved = !!saved && JSON.stringify(saved.items) === JSON.stringify(items);
                  setPrivateFile(
                    downloadReport(
                      decisionReportHtml(research, items, entityName, isSaved, lang, review),
                      `${research.id}-validation.html`,
                      "application/octet-stream",
                    ),
                  );
                }}
              >
                {t("下载排版报告", "Download formatted report")}
              </Button>
            )}
            {items.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const isSaved = !!saved && JSON.stringify(saved.items) === JSON.stringify(items);
                  setPrivateFile(
                    downloadReport(
                      validationMarkdown(research, items, entityName, isSaved, review),
                      `${research.id}-validation.md`,
                      "text/markdown;charset=utf-8",
                    ),
                  );
                }}
              >
                {t("导出 Markdown", "Export Markdown")}
              </Button>
            )}
          </div>
        </details>
        {items.length > 0 && (
          <Button
            type="button"
            variant={hasActualResults ? "default" : "outline"}
            disabled={busy || !saved}
            onClick={async () => {
              if (!saved || busy) return;
              setBusy(true);
              setError("");
              setMessage("");
              try {
                const value = await userApi.saveDecisionValidation(
                  token,
                  research.id,
                  saved.revision,
                  items,
                );
                setSaved(value);
                setItems((current) => retainValidationDraft(current, items, value.items));
                setMessage(
                  t(
                    "提交的版本已私密保存；后续编辑以页面保存状态为准。",
                    "Submitted notes saved privately; check the page status for later edits.",
                  ),
                );
              } catch (reason) {
                setError(accountErrorMessage(reason, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? t("保存中…", "Saving…")
              : hasActualResults
                ? t("保存结果，更新判断", "Save results and update advice")
                : t("保存试用计划", "Save trial plan")}
          </Button>
        )}
        {error && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const value = await userApi.decisionValidation(token, research.id);
                setSaved(value);
                setItems(value.items);
                setLoaded(true);
                setError("");
                setMessage(t("已重新读取保存的记录。", "Reloaded saved notes."));
              } catch (reason) {
                setError(accountErrorMessage(reason, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("重新读取已保存记录", "Reload saved notes")}
          </Button>
        )}
      </div>
      {items.length > 0 && (
        <p className="decision-export-note">
          {t(
            "此处单独导出私人验证记录，包含当前草稿；页面顶部的 PDF 和 Markdown 仅包含选型分析。导出不会自动保存验证草稿。",
            "These separate exports include private validation notes and current drafts. PDF and Markdown at the top contain the selection analysis only. Exporting does not save draft notes.",
          )}
        </p>
      )}
      {reportPreview && (
        <iframe
          className="decision-report-preview"
          sandbox=""
          title={t("私人决策报告预览", "Private decision report preview")}
          srcDoc={decisionReportHtml(
            research,
            items,
            entityName,
            !!saved && JSON.stringify(saved.items) === JSON.stringify(items),
            lang,
            review,
          )}
        />
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
