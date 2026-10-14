import type { DecisionValidationItem, DecisionValidationReview } from "@/services/user-api";

export function validationReviewReading(
  review: DecisionValidationReview,
  entityName: (id: string) => string,
  lang: "zh" | "en",
  items: DecisionValidationItem[] = [],
) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const complete = review.candidates.reduce((sum, row) => sum + row.completedChecks, 0);
  const required = review.candidates.reduce((sum, row) => sum + row.requiredChecks, 0);
  const dimension = (key: string) =>
    ({
      quality: t("任务效果", "Task quality"),
      latency: t("耗时", "Time"),
      cost: t("费用", "Cost"),
      terms: t("入口与条款", "Interface and terms"),
    })[key] ?? key;
  const conclusion = review.conclusion;
  const measuredChoices = conclusion?.measuredChoices ?? [];
  const untestedIds =
    conclusion?.findings
      .filter((row) => row.outcome === "unverified")
      .map((row) => row.candidateId) ?? [];
  const numericGroups = measuredChoices.map((choice) => ({
    title:
      choice.metric === "total-cost"
        ? t(`本批总费用（${choice.unit}）`, `Batch cost (${choice.unit})`)
        : choice.metric === "successful-samples"
          ? t(
              `本批合格样本数（共 ${choice.sampleCount} 个）`,
              `Successful samples (of ${choice.sampleCount})`,
            )
          : t("本批 P95（毫秒）", "Batch P95 (milliseconds)"),
    rows: Object.entries(choice.values).map(([id, value]) => ({
      id,
      name: entityName(id),
      value: String(value),
      preferred: choice.candidateIds.includes(id),
    })),
    basis: t(
      `${choice.sampleCount} 个样本 · ${choice.testDate} · 范围：${choice.scope} · 共有配置：${choice.configuration}${choice.metric === "successful-samples" ? ` · 最低合格 ${choice.minimumSuccessfulSamples} 个` : ""}`,
      `${choice.sampleCount} samples · ${choice.testDate} · Scope: ${choice.scope} · Shared configuration: ${choice.configuration}${choice.metric === "successful-samples" ? ` · Minimum successful: ${choice.minimumSuccessfulSamples}` : ""}`,
    ),
    note:
      Object.keys(choice.values).length < 2
        ? t(
            "只有一份完整数值记录，不能判断比其他候选更好。",
            "Only one complete numeric record; superiority over other candidates is not established.",
          )
        : t(
            "按已保存的用户数值比较，仅适用于本组口径；加粗项为本组优先对象，同值保留并列。",
            "Compares saved user measurements within this group's conditions. Bold entries are preferred within this group; ties are retained.",
          ),
  }));
  const passedWithOpenConditions =
    conclusion?.status === "insufficient-tests"
      ? conclusion.findings.filter((row) =>
          ["entry-unverified", "eligibility-unverified"].includes(row.outcome),
        )
      : [];
  const conclusions = {
    "limited-fit": ["可在已测范围内试用", "Consider a trial within the tested scope"],
    "no-tested-fit": [
      "已有任务样本未通过，暂不据此采用",
      "A tested task failed; adoption is not supported by that result",
    ],
    "validation-blocked": [
      "本轮实测未完成，暂不作效果主选",
      "Testing is incomplete; no quality choice yet",
    ],
    "insufficient-tests": ["现有实测不足以支持选型", "Testing is insufficient for a selection"],
    "priority-unverified": [
      "任务样本通过，首要选择条件仍待核验",
      "Task samples passed; your main selection criterion is unverified",
    ],
  };
  const outcomes = {
    "limited-fit": [
      "已记录的任务样本通过，入口检查通过；可限定范围试用",
      "Recorded task samples and entry checks passed; consider a scoped trial",
    ],
    "tested-fail": [
      "已记录的任务样本未通过，不建议用于该测试范围",
      "Recorded task samples failed; do not adopt for that tested scope",
    ],
    "testing-blocked": [
      "实测中断或验证条件缺失，不能形成通过结论；先解决阻塞再续测",
      "Testing is blocked; resolve the blocker before resuming",
    ],
    "record-incomplete": [
      "记录缺少完整测试口径或存在重复项目，暂不用于选型",
      "Test conditions are incomplete or duplicated; exclude from selection",
    ],
    "entry-unverified": [
      "任务样本通过，但入口检查未通过或尚未核验；先核对入口条件",
      "Task samples passed, but entry checks have not passed; verify entry conditions",
    ],
    "eligibility-unverified": [
      "任务样本通过，但本次资格条件未通过核验；暂不进入试用建议",
      "Task samples passed, but eligibility is not established; no trial suggestion yet",
    ],
    unverified: ["尚无完整实测", "No complete test record"],
  };
  const languageIndex = lang === "zh" ? 0 : 1;
  return {
    conclusion: conclusion
      ? {
          headline: measuredChoices.length
            ? t("实测记录支持按优先项试用", "Recorded measurements support a scoped trial")
            : passedWithOpenConditions.length
              ? t(
                  "任务样本已通过，采用条件仍待核验",
                  "Task samples passed; adoption conditions still need verification",
                )
              : conclusions[conclusion.status][languageIndex],
          action: measuredChoices.length
            ? measuredChoices
                .map(
                  (choice) =>
                    t(
                      `按本组${choice.metric === "total-cost" ? `实际费用（${choice.unit}）` : choice.metric === "successful-samples" ? "合格样本数" : "P95耗时（ms）"}，可先在已测范围试用 ${choice.candidateIds.map(entityName).join("、")}。各组数值与成立条件见下表，不推广到其他任务或未测候选。`,
                      `Within this group's ${choice.metric === "total-cost" ? `actual cost (${choice.unit})` : choice.metric === "successful-samples" ? "successful sample" : "P95 time (ms)"} measurements, try ${choice.candidateIds.map(entityName).join(", ")} within the tested scope. See each group's values and conditions below; this does not generalize to other tasks or untested candidates.`,
                    ) +
                    (Object.keys(choice.values).length < 2
                      ? t(
                          " 只有一份完整数值记录，不能判断比其他候选更好。",
                          " Only one complete numeric record is available; superiority over other candidates is not established.",
                        )
                      : ""),
                )
                .join("\n\n")
            : passedWithOpenConditions.length
              ? t(
                  `已测候选：${passedWithOpenConditions.map((row) => entityName(row.candidateId)).join("、")}。先核对使用入口、条款和本次资格条件，再决定是否在下列范围试用。其余候选需要完成相同任务后再比较；当前不作优劣排名。`,
                  `Tested candidates: ${passedWithOpenConditions.map((row) => entityName(row.candidateId)).join(", ")}. Verify the interface, terms and eligibility before a trial within the scope below. Compare other candidates after the same tasks; no superiority ranking is established.`,
                )
              : conclusion.status === "limited-fit"
                ? t(
                    `试用候选：${conclusion.trialCandidateIds.map(entityName).join("、")}。建议只覆盖下列已测样本，不代表比未测候选更好；更多任务需要另行验证。`,
                    `Trial candidates: ${conclusion.trialCandidateIds.map(entityName).join(", ")}. This applies only to the tested samples below, does not establish superiority over untested candidates, and requires further testing for other tasks.`,
                  )
                : conclusion.status === "priority-unverified"
                  ? t(
                      "先补足首要优先级对应的依据。任务通过不能替代成本、速度、隐私或控制条件；文字描述不能自动形成数值排名。",
                      "Verify evidence for the chosen priority. Task passes do not establish cost, speed, privacy or control; prose is not a numeric ranking.",
                    )
                  : t(
                      "查看已记录的结果与阻塞项。未完成的测试先定位原因；没有实测的候选仍待验证，不从笔记文字猜测通过。",
                      "Review recorded results and blockers. Diagnose incomplete tests first; untested candidates remain unverified, and prose does not establish a pass.",
                    ),
          numericGroups,
          findings: conclusion.findings
            .filter((row) => row.outcome !== "unverified")
            .map((row) => ({
              candidateId: row.candidateId,
              title: entityName(row.candidateId),
              finding: outcomes[row.outcome][languageIndex],
              result: [
                "limited-fit",
                "tested-fail",
                "entry-unverified",
                "eligibility-unverified",
              ].includes(row.outcome)
                ? (items
                    .find(
                      (item) =>
                        row.itemIds.includes(item.id) &&
                        item.id.endsWith("-quality") &&
                        ["passed", "failed"].includes(item.status),
                    )
                    ?.result.split(/\n\s*\n/)[0] ?? "")
                : "",
              scope: row.scope
                ? t(
                    `测试范围：${row.scope}；版本：${row.modelVersion}`,
                    `Test scope: ${row.scope}; version: ${row.modelVersion}`,
                  )
                : "",
            })),
          untested:
            untestedIds.length > 3
              ? t(
                  `尚有 ${untestedIds.length} 个候选无完整实测，不参与本次排名；范围见候选资格与测试记录。`,
                  `${untestedIds.length} candidates have no complete tests and are excluded from this ranking. See candidate eligibility and test records.`,
                )
              : untestedIds.length
                ? t(
                    `尚无完整实测：${conclusion.findings
                      .filter((row) => row.outcome === "unverified")
                      .map((row) => entityName(row.candidateId))
                      .join("、")}`,
                    `No complete tests: ${conclusion.findings
                      .filter((row) => row.outcome === "unverified")
                      .map((row) => entityName(row.candidateId))
                      .join(", ")}`,
                  )
                : "",
        }
      : undefined,
    headline: t(
      `记录口径齐备 ${complete}/${required} 项`,
      `${complete}/${required} checks have complete test records`,
    ),
    candidates: review.candidates.map(
      (row) =>
        `${row.candidateId ? entityName(row.candidateId) : t("本次决策", "This decision")}: ${row.completedChecks}/${row.requiredChecks}`,
    ),
    comparisons: review.comparableGroups.map((group) => ({
      title: `${dimension(group.dimension)}${group.measurementUnit ? ` (${group.measurementUnit}; ${group.costBasis === "estimate" ? t("估算", "estimate") : t("实际扣费", "actual charge")})` : ""} · ${group.candidateIds.map(entityName).join("、")}`,
      basis: t(
        `${group.sampleCount} 个样本 · ${group.testDate}；配置：${group.configuration}；范围：${group.scope}`,
        `${group.sampleCount} samples · ${group.testDate}; configuration: ${group.configuration}; scope: ${group.scope}`,
      ),
    })),
    nextStep: review.comparableGroups.length
      ? t(
          "以下记录声明了相同配置、业务范围、样本量和测试日期，可并列查看；版本各自保留。",
          "These records declare matching configuration, sample scope, count and test date; exact versions remain separate.",
        )
      : t(
          "暂无可并列比较的同口径记录；至少需要两个候选完成同一项目，并填写相同的配置、样本范围、样本量和测试日期。",
          "No matching test records to compare yet. At least two candidates must complete the same check with matching configuration, sample scope, count and test date.",
        ),
    caution: t(
      "齐备度只检查用户记录，不是产品得分；通过和未通过都可构成完整记录。费用不从文字猜测，私人记录不会改变公开建议。",
      "Completeness checks your records, not product quality. Both passes and failures can have complete records. Costs are not inferred from prose, and private records do not change public recommendations.",
    ),
  };
}
