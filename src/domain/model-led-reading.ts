import type { ModelLedAnalysis, ModelLedLine } from "@/services/user-api";

export type ModelLedSection = { title: string; lines: Array<{ text: string; claimIds: string[] }> };

/** Shared reading of a validated model-led analysis for exports and summaries. */
export function modelLedSections(
  analysis: ModelLedAnalysis,
  entityName: (id: string) => string,
  lang: "zh" | "en",
): ModelLedSection[] {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const mark = (line: ModelLedLine) => ({
    text:
      line.basis === "verified"
        ? line.text
        : `${line.text}${t("（模型常识，未核验）", " (model knowledge, unverified)")}`,
    claimIds: line.basis === "verified" ? line.claimIds : [],
  });
  const sections: ModelLedSection[] = [
    {
      title: t("理解的任务", "Understood task"),
      lines: [{ text: analysis.understoodTask, claimIds: [] }],
    },
    ...analysis.candidates.map((candidate) => ({
      title: `${entityName(candidate.entityId)}（${candidate.role === "primary" ? t("首选", "primary") : t("备选", "alternative")}）`,
      lines: candidate.points.map(mark),
    })),
    { title: t("主要取舍", "Main tradeoffs"), lines: analysis.tradeoffs.map(mark) },
    { title: t("还需要确认", "Still to check"), lines: analysis.gaps.map(mark) },
    { title: t("第一步", "First steps"), lines: analysis.firstSteps.map(mark) },
  ];
  return sections.filter((section) => section.lines.length);
}

export const MODEL_LED_NOTICE = {
  zh: "由模型根据已收录资料和自身常识分析：带引用的内容已核验；标为“模型常识，未核验”的内容请自行确认。明确提出的硬条件已由系统检查。",
  en: "Analysed by a model from the catalog and its own knowledge. Cited items are verified; items marked as model knowledge are unverified. Explicit hard requirements were checked by the system.",
};

const REQUIREMENT_LABELS: Record<string, [string, string]> = {
  excluded: ["符合你的排除条件", "Matches your exclusions"],
  "data-boundary-violated": [
    "资料显示不符合你的数据处理要求",
    "Evidence contradicts your data boundary",
  ],
  "commercial-use-prohibited": ["许可禁止商用", "License prohibits commercial use"],
  "over-budget": ["已核验价格超出你的预算", "Verified price exceeds your budget"],
  "context-too-small": ["上下文长度不够", "Context window too small"],
  "unavailable-version": ["版本已退役或尚未发布", "Version retired or not yet available"],
  "billing-channel-mismatch": [
    "计费渠道与你的预算不一致",
    "Billing channel differs from your budget",
  ],
};

/** Plain-language reason a candidate was removed by a hard requirement. */
export function screeningReason(reason: string, lang: "zh" | "en"): string | null {
  if (!reason.startsWith("hard-requirement:")) return null;
  const labels = reason
    .slice("hard-requirement:".length)
    .split(",")
    .map((key) => REQUIREMENT_LABELS[key]?.[lang === "zh" ? 0 : 1])
    .filter((label): label is string => !!label);
  return labels.length ? labels.join(lang === "zh" ? "；" : "; ") : null;
}
