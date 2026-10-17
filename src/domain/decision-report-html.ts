import type {
  DecisionValidationItem,
  DecisionValidationReview,
  ResearchResult,
} from "@/services/user-api";
import { validationReviewReading } from "./decision-validation-review";
import {
  decisionPresentation,
  decisionStatusLabel,
  reportCitationNumbers,
  validationTitle,
} from "./decision-presentation";
import { compactFindings, decisionReading } from "./decision-reading";
import { groupValidationItems, validationItemHeading } from "./decision-validation-view";
import { decisionPlanSections, trialQualificationLabel } from "./decision-plan-reading";
import { measurementRows, protocolRows } from "./decision-measurements";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** Standalone local report; no scripts, remote fonts or network resources. */
export function decisionReportHtml(
  research: ResearchResult,
  items: DecisionValidationItem[],
  entityName: (id: string) => string,
  saved: boolean,
  lang: "zh" | "en",
  review?: DecisionValidationReview | null,
) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const e = escapeHtml;
  const missing = t("未填写", "Unspecified");
  const status = (key: string) => decisionStatusLabel(key, lang);
  const list = (rows: string[]) => `<ul>${rows.map((row) => `<li>${e(row)}</li>`).join("")}</ul>`;
  const table = (rows: Array<[string, string]>) =>
    `<table><tbody>${rows.map(([key, value]) => `<tr><th scope="row">${e(key)}</th><td>${e(value || missing)}</td></tr>`).join("")}</tbody></table>`;
  const citation = (ids: string[]) =>
    ids.length
      ? ` <small>${e(t("依据", "References"))}: ${e(reportCitationNumbers(research, ids).join(", "))}</small>`
      : "";
  const presentation = decisionPresentation(research, lang);
  const decision = research.decision;
  const reading = decision ? decisionReading(decision, entityName) : undefined;
  const context = research.decisionContext;
  const reviewed = saved && review ? validationReviewReading(review, entityName, lang) : undefined;
  const privateConclusion = reviewed?.conclusion
    ? [
        `<h2>${e(t("基于私人实测的选型判断", "Selection based on private test records"))}</h2><p><strong>${e(reviewed.conclusion.headline)}</strong></p><p>${e(reviewed.conclusion.action)}</p>`,
        ...reviewed.conclusion.numericGroups.map(
          (group) =>
            `<h3>${e(group.title)}</h3><table class="numeric-table"><thead><tr><th>${e(t("候选", "Candidate"))}</th><th>${e(t("记录数值", "Recorded value"))}</th></tr></thead><tbody>${group.rows.map((row) => `<tr><td>${row.preferred ? `<strong>${e(row.name)}</strong>` : e(row.name)}</td><td>${row.preferred ? `<strong>${e(row.value)}</strong>` : e(row.value)}</td></tr>`).join("")}</tbody></table><p>${e(group.basis)}</p><p>${e(group.note)}</p>`,
        ),
        ...reviewed.conclusion.findings.map(
          (row) =>
            `<p><strong>${e(row.title)}</strong>：${e(row.finding)}</p>${row.scope ? `<p>${e(row.scope)}</p>` : ""}`,
        ),
        `<p>${e(reviewed.conclusion.untested)}</p>`,
      ]
    : [];
  const body = [
    `<header><h1>${e(t("私人决策与验证报告", "Private decision and validation report"))}</h1><p>${e(saved ? t("已保存验证记录", "Saved validation notes") : t("包含尚未保存的验证草稿", "Includes unsaved validation draft"))}</p><p>${e(t("用户笔记属于私人记录，不是已核验公开事实。", "User notes are private records, not verified public facts."))}</p></header>`,
    ...privateConclusion,
    `<h2>${e(t("公开资料分析与任务条件", "Public evidence and task conditions"))}</h2><p>${e(research.decisionContext?.task ?? research.question)}</p><p><strong>${e(presentation.headline)}</strong></p><p>${e(presentation.summary)}</p><p>${e(presentation.action)}</p>`,
    ...(decision?.guidance
      ? [
          ...decision.guidance.recommendation.reasons.map(
            (reason) =>
              `<p><strong>${e(reason.dimension)}</strong>：${e(reason.finding)}${citation(reason.claimIds)}</p>`,
          ),
          ...(decision.guidance.recommendation.tradeoff
            ? [`<p>${e(decision.guidance.recommendation.tradeoff)}</p>`]
            : []),
          list(decision.guidance.recommendation.premises),
          ...(decision.guidance.clarification
            ? [
                `<h3>${e(decision.guidance.clarification.question)}</h3><p>${e(decision.guidance.clarification.reason)}</p>${list(decision.guidance.clarification.options.map((option) => `${option.label}：${option.description}`))}`,
              ]
            : []),
        ]
      : []),
    table([
      [t("研究记录", "Research ID"), research.id],
      [t("核验时间", "Evaluated at"), decision?.asOf ?? research.createdAt],
    ]),
    `<h2>${e(t("分析采用的条件", "Applied conditions"))}</h2>${list(decision?.conditions ?? [])}`,
    ...decisionPlanSections(decision?.guidance ? undefined : decision?.plan, entityName, lang).map(
      (section) => `<h3>${e(section.title)}</h3>${list(section.lines)}`,
    ),
    ...(context
      ? [
          table([
            [
              t("选型任务", "Selection type"),
              {
                "model-api": t("模型 API", "Model API"),
                "coding-product": t("编码产品", "Coding product"),
                "knowledge-product": t("知识库应用与平台", "Knowledge application / platform"),
                "agent-development": t("Agent 开发", "Agent development"),
                unspecified: t("按业务用途识别", "Infer from business use"),
              }[context.taskType ?? "unspecified"],
            ],
            [
              t("预算下限 / 上限", "Budget minimum / maximum"),
              `${context.budget.min ?? missing} / ${context.budget.max ?? missing}`,
            ],
            [
              t("币种与周期", "Currency and period"),
              `${context.budget.currency ?? missing} / ${context.budget.period ?? t("月", "month")}`,
            ],
            [t("计费渠道", "Billing channel"), context.budget.channel ?? ""],
            [
              t("月输入 / 输出 token", "Monthly input / output tokens"),
              `${context.budget.monthlyInputTokens ?? missing} / ${context.budget.monthlyOutputTokens ?? missing}`,
            ],
            [t("部署地区", "Hosting region"), context.region ?? ""],
            [
              t("最低上下文 token", "Minimum context tokens"),
              String(context.minimumContextTokens ?? ""),
            ],
            [
              t("必须支持的输入", "Required inputs"),
              (context.inputModalities ?? [])
                .map(
                  (key) =>
                    ({
                      text: t("文本", "Text"),
                      image: t("图像", "Image"),
                      audio: t("音频", "Audio"),
                      video: t("视频", "Video"),
                    })[key],
                )
                .join("、"),
            ],
            [
              t("要求核验商用许可", "Verified commercial permission required"),
              context.commercialUseRequired ? t("是", "Yes") : t("未设此门槛", "Not required"),
            ],
            [
              t("指定候选", "Selected candidates"),
              context.candidateEntityIds.map(entityName).join("、"),
            ],
            [t("排除条件", "Exclusions"), context.exclusions.join("、")],
            [t("补充说明", "Notes"), context.notes ?? ""],
          ]),
        ]
      : []),
    `<h2>${e(t("候选核验", "Candidate checks"))}</h2>`,
    ...(reading?.commonReasons ?? []).map(
      ([reason, ids]) => `<p>${e(reason)} — ${e(ids.map(entityName).join("、"))}</p>`,
    ),
    ...(reading?.commonGaps.length
      ? [
          `<h3>${e(t("共同资料缺口", "Shared evidence gaps"))}</h3>${reading.commonGaps.map(({ gap, ids }) => `<p>${e(gap.detail || gap.reason)} — ${e(ids.map(entityName).join("、"))}${citation(gap.claimIds)}</p>`).join("")}`,
        ]
      : []),
    ...(decision?.candidates ?? []).map((candidate) => {
      const coverage = reading!.coverage(candidate.entityId);
      return `<section><h3>${e(entityName(candidate.entityId))}</h3>${table([
        [
          t("状态", "Status"),
          trialQualificationLabel(decision!, candidate.entityId, lang) ??
            status(candidate.eligibility),
        ],
        [t("功能描述", "Feature descriptions"), `${coverage.described}/${coverage.features}`],
        [
          t("硬条件核验", "Constraint verification"),
          coverage.hard
            ? `${coverage.verified}/${coverage.hard}`
            : t("未设置硬条件", "No hard constraints set"),
        ],
      ])}${list(reading?.individualReasons(candidate.entityId) ?? candidate.reasons)}${compactFindings(
        candidate.strengths ?? [],
      )
        .map((fact) => `<p>${e(fact.finding)}${citation(fact.claimIds)}</p>`)
        .join(
          "",
        )}${(reading?.individualGaps(candidate.entityId) ?? []).map((gap) => `<p>${e(gap.detail || gap.reason)}${citation(gap.claimIds)}</p>`).join("")}</section>`;
    }),
    ...(reading?.knownComparisons.length
      ? [`<h2>${e(t("维度比较", "Evidence by dimension"))}</h2>`]
      : []),
    ...(reading?.knownComparisons ?? []).map(
      (row) =>
        `<section><h3>${e(row.dimension)}</h3>${row.cells
          .filter((cell) => cell.facts.length)
          .map(
            (cell) =>
              `<h4>${e(entityName(cell.entityId))}</h4>${cell.facts.map((fact) => `<p>${e(fact.finding)}${citation(fact.claimIds)}</p>`).join("")}`,
          )
          .join("")}<p>${
          row.cells.some((cell) => !cell.facts.length)
            ? e(
                t("当前引用未覆盖：", "No explicit citation for: ") +
                  row.cells
                    .filter((cell) => !cell.facts.length)
                    .map((cell) => entityName(cell.entityId))
                    .join("、"),
              )
            : ""
        }</p></section>`,
    ),
    ...(reading?.missingDimensions.length
      ? [
          `<h3>${e(t("尚不能比较的维度", "Dimensions awaiting evidence"))}</h3><p>${e(reading.missingDimensions.join("、"))}</p>`,
        ]
      : []),
    ...(decision?.scope
      ? [
          `<h2>${e(t("候选范围", "Candidate scope"))}</h2><p>${e(decision.scope.selectionBasis)}</p>${table(
            [
              [
                t("已考虑", "Considered"),
                decision.scope.consideredEntityIds.map(entityName).join("、"),
              ],
              [
                t("本报告未展示", "Omitted from this report"),
                decision.scope.omittedEntityIds.map(entityName).join("、") || t("无", "None"),
              ],
            ],
          )}`,
        ]
      : []),
    ...(decision?.recommendation.reasons?.length
      ? [
          `<h2>${e(t("建议依据", "Recommendation basis"))}</h2>${compactFindings(
            decision.recommendation.reasons,
          )
            .map((reason) => `<p>${e(reason.finding)}${citation(reason.claimIds)}</p>`)
            .join("")}`,
        ]
      : []),
    ...(decision?.scenario
      ? [
          `<h2>${e(t("业务场景与澄清", "Scenario and clarification"))}</h2><p>${e(decision.scenario.name)}</p>${list(decision.scenario.clarificationChecks)}`,
        ]
      : []),
    ...(reading?.extraEvidence.length
      ? [
          `<h2>${e(t("补充依据与取舍", "Additional evidence and tradeoffs"))}</h2>${reading.extraEvidence.map((fact) => `<p>${e(fact.finding)}${citation(fact.claimIds)}</p>`).join("")}`,
        ]
      : []),
    `<h2>${e(t("风险与下一步", "Risks and next steps"))}</h2>${list([...(decision?.risks ?? []).map((risk) => risk.detail), ...(decision?.plan ? [] : (reading?.nextChecks ?? []))])}`,
    `<h2>${e(t("私人验证记录", "Private validation notes"))}</h2>`,
    ...(reviewed
      ? [
          `<p><strong>${e(reviewed.headline)}</strong></p>${list(reviewed.candidates)}<p>${e(reviewed.nextStep)}</p>`,
          ...reviewed.comparisons.map(
            (group) => `<p><strong>${e(group.title)}</strong></p><p>${e(group.basis)}</p>`,
          ),
          `<p>${e(reviewed.caution)}</p>`,
        ]
      : [
          `<p>${e(t("保存后复核记录完整度与比较口径；此报告未沿用旧复核。", "Save to review record completeness and comparison bases. This report does not reuse an earlier review."))}</p>`,
        ]),
    ...groupValidationItems(items).map(
      (group) =>
        `<section><h3>${e(group.candidateId ? entityName(group.candidateId) : t("本次决策", "This decision"))}</h3>${group.items
          .map(
            (item) =>
              `<h4>${e(validationItemHeading(item, lang))}</h4><p>${e(validationTitle(item.title, lang))}</p>${table(
                [
                  [t("状态", "Status"), status(item.status)],
                  [t("具体版本", "Exact version"), item.testConditions?.modelVersion ?? ""],
                  [t("配置与环境", "Configuration"), item.testConditions?.configuration ?? ""],
                  [t("样本量", "Sample count"), String(item.testConditions?.sampleCount ?? "")],
                  [t("测试日期", "Test date"), item.testConditions?.testedAt ?? ""],
                  [t("范围与标准", "Scope and criteria"), item.testConditions?.scope ?? ""],
                  ...measurementRows(item, lang),
                  ...protocolRows(item, lang),
                ],
              )}<p class="validation-result">${e(item.result || t("尚未实测", "Untested"))}</p>`,
          )
          .join("")}</section>`,
    ),
    `<h2>${e(t("引用来源", "Cited sources"))}</h2>`,
    ...(research.citations ?? []).map(
      ({ claim, evidence }, index) =>
        `<section><h3>${e(t("依据", "Reference"))} ${index + 1}</h3><p>${e(claim.text[lang])}</p>${evidence.map((source) => `<p>${/^https?:\/\//i.test(source.url) ? `<a href="${e(source.url)}">${e(source.url)}</a>` : e(source.url)} · ${e(source.publishedAt || t("来源日期未知", "Source date unknown"))}</p>`).join("")}</section>`,
    ),
  ].join("\n");
  return `<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(t("私人决策报告", "Private decision report"))}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#121722;font:16px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:960px;margin:32px auto;padding:32px;background:white}h1{font-size:24px;line-height:1.4;margin:0 0 12px}h2{font-size:19px;line-height:1.45;margin:28px 0 12px;padding-top:16px;border-top:1px solid #dfe3e9}h3{font-size:16px;line-height:1.5;margin:18px 0 8px}h4{font-size:14px;line-height:1.6;font-weight:600;margin:16px 0 6px}p,ul{margin:8px 0 12px}li+li{margin-top:6px}p,li,td,a{overflow-wrap:break-word}table{border-collapse:collapse;width:100%;margin:12px 0 20px;table-layout:fixed}th,td{padding:10px 12px;vertical-align:top;text-align:left;border-bottom:1px solid #dfe3e9;overflow-wrap:anywhere}th{width:24%;font-weight:600;background:#f6f7f9}small{display:block;color:#596273;font-size:13px}a{color:#1859e8}header p{color:#596273;font-size:14px}@media(max-width:600px){main{margin:0;padding:20px 16px}h1{font-size:22px}th{width:32%}}@media print{@page{margin:18mm}body{background:white;font-size:11pt}main{margin:0;padding:0;max-width:none}h1{font-size:18pt}h2{font-size:14pt;break-after:avoid}h3{break-after:avoid}tr{break-inside:avoid}a{color:inherit}}
.validation-result{white-space:pre-wrap}
.numeric-table th{width:auto}.numeric-table th:last-child,.numeric-table td:last-child{width:28%;text-align:right;font-variant-numeric:tabular-nums}
</style></head><body><main>${body}</main></body></html>`;
}

export function downloadReport(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { url, filename };
}
