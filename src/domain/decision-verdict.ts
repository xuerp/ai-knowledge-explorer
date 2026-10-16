import type { DecisionValidation, ResearchResult } from "@/services/user-api";
import { decisionPresentation } from "./decision-presentation";
import { decisionChoices } from "./decision-choice";
import { compactFindings } from "./decision-reading";
import { validationReviewReading } from "./decision-validation-review";
import { planDimensionName } from "./decision-plan-reading";
import { validationDimension } from "./decision-validation-view";

/** One reading judgment. Only a saved, matching server review can supply private advice. */
export function decisionVerdict(
  research: ResearchResult,
  validation: DecisionValidation | null,
  entityName: (id: string) => string,
  lang: "zh" | "en",
) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const decision = research.decision;
  const presentation = decisionPresentation(research, lang);
  const recorded = validation?.items.some(
    (item) =>
      item.result.trim() ||
      item.status !== "pending" ||
      Object.values(item.measurements ?? {}).some((value) => value != null && value !== ""),
  );
  const review =
    recorded &&
    validation?.researchId === research.id &&
    validation.review?.sourceRevision === validation.revision
      ? validation.review
      : undefined;
  const reading = review
    ? validationReviewReading(review, entityName, lang, validation!.items).conclusion
    : undefined;
  const meaningfulFinding = review?.conclusion?.findings.some(
    (row) => row.outcome !== "unverified",
  );
  const entryBlockers = review
    ? validation!.items.filter(
        (item) =>
          validationDimension(item.id) === "terms" && ["blocked", "failed"].includes(item.status),
      )
    : [];
  if (!meaningfulFinding && entryBlockers.length)
    return {
      source: "private" as const,
      headline: t("先解决实际入口与使用条件", "Resolve actual interface and use conditions first"),
      summary: entryBlockers
        .slice(0, 2)
        .map(
          (item) =>
            `${item.candidateId ? entityName(item.candidateId) : t("本次选择", "This selection")}：${item.result || t("入口或必要条件未通过核验", "Interface or required conditions have not passed verification")}`,
        )
        .join(" "),
      boundary: t(
        "依据是你保存的入口核验记录；这不是业务效果成绩，不据此推荐采用。",
        "Based on saved entry checks, not task performance; adoption is not recommended from these records.",
      ),
      next: t(
        "先核对记录中的入口、版本与必要条件，解决阻塞后再更新资格核验记录。",
        "Check the recorded interface, version and requirements; update qualification notes after resolving blockers.",
      ),
      action: "records" as const,
      reasons: [],
    };
  if (reading && review?.conclusion && meaningfulFinding) {
    const conclusion = review.conclusion;
    const choices = conclusion.measuredChoices ?? [];
    const group = choices.length === 1 ? choices[0] : undefined;
    const names = (ids: string[]) => ids.map(entityName).join(lang === "zh" ? "、" : ", ");
    const comparison = group && Object.keys(group.values).length >= 2;
    const headline = group
      ? comparison
        ? group.candidateIds.length === 1
          ? t(
              `本批建议：${names(group.candidateIds)}`,
              `Choice for this batch: ${names(group.candidateIds)}`,
            )
          : t(
              `本批并列：${names(group.candidateIds)}`,
              `Tie for this batch: ${names(group.candidateIds)}`,
            )
        : t(
            `已测范围可试用：${names(group.candidateIds)}`,
            `Scoped trial: ${names(group.candidateIds)}`,
          )
      : choices.length > 1
        ? t("不同测试口径分别选，暂不合并主选", "Choose within each test group; no combined winner")
        : conclusion.status === "limited-fit" && conclusion.trialCandidateIds.length
          ? t(
              `已测范围可试用：${names(conclusion.trialCandidateIds)}`,
              `Scoped trial: ${names(conclusion.trialCandidateIds)}`,
            )
          : reading.headline;
    return {
      source: "private" as const,
      headline,
      summary: group
        ? t(
            `${comparison ? "按本批" : "本批记录的"}${group.metric === "successful-samples" ? "合格样本数" : group.metric === "total-cost" ? "实际费用" : "P95耗时"}${comparison ? "比较" : ""}：${Object.entries(
              group.values,
            )
              .map(
                ([id, value]) =>
                  `${entityName(id)} ${value}${group.metric === "successful-samples" ? `/${group.sampleCount}` : ` ${group.unit}`}`,
              )
              .join(
                "；",
              )}。${!comparison && group.metric === "successful-samples" && group.minimumSuccessfulSamples != null ? `试测前约定最低合格 ${group.minimumSuccessfulSamples} 个。` : ""}`,
            `${comparison ? "Batch" : "Recorded batch"} ${group.metric === "successful-samples" ? "successful samples" : group.metric === "total-cost" ? "actual cost" : "P95 time"}: ${Object.entries(
              group.values,
            )
              .map(
                ([id, value]) =>
                  `${entityName(id)} ${value}${group.metric === "successful-samples" ? `/${group.sampleCount}` : ` ${group.unit}`}`,
              )
              .join(
                "; ",
              )}.${!comparison && group.metric === "successful-samples" && group.minimumSuccessfulSamples != null ? ` Minimum successful samples agreed before testing: ${group.minimumSuccessfulSamples}.` : ""}`,
          )
        : reading.findings
            .slice(0, 2)
            .map((row) => `${row.title}：${row.finding}`)
            .join(" "),
      boundary: group
        ? t(
            `依据是你保存的私人记录：${group.sampleCount}个样本，${group.testDate}，范围：${group.scope}。${comparison ? "结论仅适用于本组口径。" : "只有一个候选有完整数值，不能判断优于其他产品。"}`,
            `Based on saved private records: ${group.sampleCount} samples, ${group.testDate}, scope: ${group.scope}. ${comparison ? "Applies only within this test group." : "Only one candidate has complete measurements; superiority is not established."}`,
          )
        : t(
            "依据是你保存的私人试用记录，只适用于已记录的版本、入口和任务范围。",
            "Based on saved private trial records, limited to the recorded version, interface and task scope.",
          ),
      next:
        conclusion.status === "limited-fit"
          ? t(
              "先在已测范围小规模使用；扩大任务或更换入口前，再补同口径验证。",
              "Start within the tested scope; validate again before expanding tasks or changing interfaces.",
            )
          : conclusion.findings.some((row) => row.outcome === "entry-unverified")
            ? t(
                "核对实际使用入口、模型版本和数据条款，在试用记录中补齐入口检查后保存。",
                "Verify the actual interface, model version and data terms; complete the entry check and save.",
              )
            : conclusion.status === "priority-unverified"
              ? t(
                  "任务通过还不够：补齐你首要优先项的实测数值或条件，然后保存更新判断。",
                  "Task passes alone are insufficient. Record the measurements or checks for your main priority, then save.",
                )
              : reading.action,
      action: "records" as const,
      reasons: [],
    };
  }
  const ready = decisionChoices(research).filter((candidate) => candidate.ready);
  const primary = ready.find(
    (candidate) => candidate.entityId === decision?.recommendation.primaryEntityId,
  );
  const trialNames = ready
    .slice(0, 3)
    .map((candidate) => entityName(candidate.entityId))
    .join(lang === "zh" ? "、" : ", ");
  const reasons = compactFindings(decision?.recommendation.reasons ?? []).slice(0, 2);
  const state = decision?.plan?.state;
  const missing = [
    ...new Set(
      decision?.plan?.actions
        .filter((action) => action.kind === "source")
        .flatMap((action) => action.dimensions) ?? [],
    ),
  ]
    .slice(0, 3)
    .map((key) => planDimensionName(key, lang))
    .join(lang === "zh" ? "、" : ", ");
  return {
    source: "public" as const,
    headline: ready.length
      ? primary && decision?.recommendation.basis === "comparable-cost"
        ? t(
            `按已核验费用可先试用：${entityName(primary.entityId)}`,
            `Trial based on verified costs: ${entityName(primary.entityId)}`,
          )
        : t(
            `可先试用：${trialNames}${ready.length > 3 ? t("等", " and others") : ""}`,
            `Ready to try: ${trialNames}${ready.length > 3 ? " and others" : ""}`,
          )
      : state === "needs-evidence"
        ? t("还不能确定哪款符合你的全部要求", "Fit with all your requirements is not established")
        : state === "needs-input" && decision?.scenario?.id === "unspecified"
          ? ready.length || decision.candidates?.length
            ? t("必要条件尚未同时核验", "Mandatory conditions are not jointly verified")
            : t("先选一件具体工作", "Choose one concrete task first")
          : presentation.headline,
    summary: ready.length
      ? primary &&
        decision &&
        (decision.recommendation.basis === "comparable-cost" || ready.length === 1)
        ? decision.recommendation.summary
        : t(
            "这些候选的必要功能与使用条件有资料支持。选你能使用的产品，先验证是否满足自己的任务标准。",
            "Required features and use conditions have evidence. Choose an available product and check whether it meets your own task criteria.",
          )
      : state === "needs-evidence"
        ? t(
            `这份分析中的${missing || "必要条件"}资料尚不完整。仍可比较已知功能；缺资料不表示产品不支持。`,
            `This analysis has incomplete evidence for ${missing || "required conditions"}. Documented features remain comparable; missing evidence does not mean unsupported.`,
          )
        : presentation.summary,
    boundary:
      state === "needs-input" && !decision?.candidates?.length
        ? t(
            "当前先明确需求，尚未进行候选筛选或产品测试。",
            "Clarify the task first; no candidate screening or product test has been completed.",
          )
        : t(
            "这里依据公开资料筛选试用资格，尚未证明你的业务效果或产品间优劣。",
            "Public sources establish trial eligibility; they do not prove task quality or superiority.",
          ),
    next: ready.length
      ? t(
          "先选一个你能使用的候选，查看试用任务；使用后再回来记录结果。有多个入口时再比较。",
          "Choose one candidate you can access and inspect its trial task. Return to record results after use; compare when you have multiple interfaces.",
        )
      : state === "needs-evidence"
        ? t(
            "先在下方“缺项资料”提交补充请求；已有请求可检查补齐进度。资料齐备后，保留原要求重新分析。",
            "Request missing evidence below, or check progress on an existing request. Reanalyze with your original requirements when evidence is ready.",
          )
        : state === "needs-input" &&
            decision?.scenario?.id === "unspecified" &&
            !decision.candidates?.length
          ? t(
              "在任务描述里补一句：我先做____，材料是____，希望得到____。",
              "Add one sentence to your task: first I want to ____, using ____, to produce ____.",
            )
          : (decision?.plan?.actions[0]?.instruction ?? presentation.action),
    action: ready.length ? ("choose" as const) : ("edit" as const),
    reasons,
  };
}
