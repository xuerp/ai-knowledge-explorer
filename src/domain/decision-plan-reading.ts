import type { DecisionResult } from "@/services/user-api";
import scenarios from "../../backend/data/decision_scenarios.v1.json";

export function trialQualificationLabel(
  decision: DecisionResult,
  id: string,
  lang: "zh" | "en",
): string | undefined {
  if (!decision.plan) return undefined;
  const candidate = decision.candidates?.find((row) => row.entityId === id);
  if (candidate?.eligibility !== "eligible") return undefined;
  if (decision.plan.trialCandidateIds.includes(id))
    return lang === "zh" ? "可进入业务验证" : "Ready for a business trial";
  const features = decision.scenario?.requiredFeatures ?? [];
  const known = new Set(candidate.strengths?.map((row) => row.dimension));
  if (features.some((key) => !known.has(key)))
    return lang === "zh" ? "必要功能待核验" : "Required features unverified";
  return lang === "zh" ? "先解决当前决定条件" : "Resolve current decision gates first";
}

export function planDimensionName(key: string, lang: "zh" | "en") {
  const feature = scenarios.features[key as keyof typeof scenarios.features];
  if (feature) return feature.name[lang];
  const labels: Record<string, [string, string]> = {
    evidence: ["当前证据", "Current evidence"],
    context: ["上下文容量", "Context capacity"],
    deployment: ["部署方式", "Deployment"],
    region: ["部署地区", "Hosting region"],
    "api-price": ["费用", "Cost"],
    "input-modalities": ["输入模态", "Input modalities"],
    "commercial-use": ["商用许可", "Commercial use"],
    access: ["权重获取", "Weight access"],
    "budget-ceiling": ["预算上限", "Budget ceiling"],
    "budget-currency": ["币种", "Currency"],
    "billing-channel": ["计费渠道", "Billing channel"],
    "monthly-input-tokens": ["月输入 token", "Monthly input tokens"],
    "monthly-output-tokens": ["月输出 token", "Monthly output tokens"],
  };
  return labels[key]?.[lang === "zh" ? 0 : 1] ?? key;
}

/** Same server plan for both private exports; no recommendation inferred here. */
export function decisionPlanSections(
  plan: DecisionResult["plan"],
  entityName: (id: string) => string,
  lang: "zh" | "en",
): Array<{ title: string; lines: string[] }> {
  if (!plan) return [];
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const sections = [
    { title: t("当前能决定什么", "What can be decided now"), lines: [plan.canDecide] },
    ...plan.actions.map((action) => ({
      title: action.title,
      lines: [
        ...(action.candidateIds.length
          ? [t("适用候选：", "Candidates: ") + action.candidateIds.map(entityName).join("、")]
          : []),
        ...(action.dimensions.length
          ? [
              t("需要解决：", "Resolve: ") +
                action.dimensions.map((key) => planDimensionName(key, lang)).join("、"),
            ]
          : []),
        action.instruction,
        action.unlocks,
      ],
    })),
  ];
  if (plan.trial)
    sections.push({
      title: t("业务测试方案（尚未执行）", "Business trial protocol (not executed)"),
      lines: [
        plan.trial.sample,
        ...plan.trial.procedure,
        ...plan.trial.metrics.map((line) => t("记录指标：", "Metric: ") + line),
        ...plan.trial.acceptance.map((line) => t("合格标准：", "Acceptance: ") + line),
        ...(plan.trialCandidateIds.length
          ? [
              t("可进入本轮验证：", "Eligible for this trial: ") +
                plan.trialCandidateIds.map(entityName).join("、"),
            ]
          : [
              t(
                "先完成必要资格与来源核验，再执行此方案。",
                "Verify required eligibility and sources before executing this protocol.",
              ),
            ]),
      ],
    });
  return sections;
}
