import type { DecisionContext, ResearchResult } from "@/services/user-api";

export function guidanceStatusLabel(outcome: string, lang: "zh" | "en") {
  const labels: Record<string, [string, string]> = {
    advice: ["建议已生成", "Advice ready"],
    clarify: ["等待你的选择", "Awaiting your choice"],
    conditional: ["有前提的路线", "Conditional route"],
    unsupported: ["暂未覆盖", "Outside current scope"],
    blocked: ["必要条件未满足", "Required conditions not met"],
  };
  return labels[outcome]?.[lang === "zh" ? 0 : 1] ?? outcome;
}

export function decisionStatusLabel(key: string, lang: "zh" | "en") {
  const labels: Record<string, [string, string]> = {
    eligible: ["可继续验证", "Ready for validation"],
    excluded: ["不符合硬条件", "Excluded by constraints"],
    unknown: ["待补充资料", "Needs evidence"],
    conflict: ["证据冲突", "Conflicting evidence"],
    pending: ["待验证", "Pending"],
    passed: ["实测通过", "Passed in testing"],
    failed: ["实测未通过", "Failed in testing"],
    blocked: ["缺少验证条件", "Blocked"],
    supported: ["有引用支持", "Supported by citations"],
  };
  return labels[key]?.[lang === "zh" ? 0 : 1] ?? key;
}

export function reportCitationNumbers(research: ResearchResult, ids: string[]) {
  return [...new Set(ids)].map((id) => {
    const index = (research.citations ?? []).findIndex((citation) => citation.claim.id === id);
    return index < 0 ? id : String(index + 1);
  });
}

export function validationTitle(title: string, lang: "zh" | "en") {
  const prefix = "用相同业务样本核对 / Test identical business samples: ";
  if (title.startsWith(prefix))
    return (
      (lang === "zh" ? "用相同业务样本核对：" : "Test identical business samples: ") +
      title.slice(prefix.length)
    );
  const parts = title.split(" / ");
  return parts.length === 2 ? parts[lang === "zh" ? 0 : 1] : title;
}

export function describedPriority(task: string): DecisionContext["priority"] | undefined {
  const rules: Array<[DecisionContext["priority"], RegExp]> = [
    [
      "quality",
      /(?:效果|质量)(?:最重要|优先|第一)|quality (?:first|priority)|prioriti[sz]e quality/i,
    ],
    ["cost", /(?:成本|费用|预算)(?:最重要|优先|第一)|cost (?:first|priority)/i],
    ["speed", /(?:速度|时延|延迟)(?:最重要|优先|第一)|speed (?:first|priority)/i],
    ["privacy", /隐私(?:最重要|优先|第一)|privacy (?:first|priority)/i],
    ["control", /可控性(?:最重要|优先|第一)|control (?:first|priority)/i],
  ];
  const clauses = task
    .split(/[，,。；;.!]/)
    .filter((text) => !/不以|不需要|不优先|不要|not |no need/i.test(text));
  const matches = rules.filter(([, rule]) => clauses.some((text) => rule.test(text)));
  return matches.length === 1 ? matches[0][0] : undefined;
}

export function decisionPresentation(research: ResearchResult, lang: "zh" | "en") {
  const choose = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const decision = research.decision;
  const candidates = decision?.candidates ?? [];
  const counts = { eligible: 0, excluded: 0, unknown: 0, conflict: 0 };
  candidates.forEach((candidate) => counts[candidate.eligibility]++);
  const allExcluded = candidates.length > 0 && counts.excluded === candidates.length;
  const reasons = [...new Set(candidates.flatMap((item) => item.reasons))];
  if (decision?.guidance)
    return {
      counts,
      allExcluded,
      headline: decision.guidance.recommendation.headline,
      summary: decision.guidance.recommendation.summary,
      action: decision.guidance.nextAction.instruction,
    };
  return {
    counts,
    allExcluded,
    headline: allExcluded
      ? choose("没有符合当前硬条件的候选", "No candidate meets the current constraints")
      : counts.conflict || decision?.status === "conflict"
        ? choose("候选证据存在冲突", "Candidate evidence conflicts")
        : decision?.recommendation.primaryEntityId
          ? choose("有条件建议", "Conditional recommendation")
          : decision?.plan
            ? {
                "needs-input": choose(
                  "先补齐决定性条件",
                  "Complete decision-critical inputs first",
                ),
                "needs-evidence": choose(
                  "先核验必要条件，再决定试用对象",
                  "Verify required evidence before a trial",
                ),
                conflict: choose("先解除证据冲突", "Resolve evidence conflicts first"),
                "all-excluded": choose(
                  "没有符合当前硬条件的候选",
                  "No candidate meets the constraints",
                ),
                "no-candidates": choose(
                  "先明确相关候选范围",
                  "Establish a relevant candidate scope",
                ),
                "ready-to-validate": choose(
                  "可开始小范围业务验证",
                  "Ready for a limited business trial",
                ),
                failed: choose("分析未完成，请重新分析", "Analysis failed; reanalyze"),
              }[decision.plan.state]
            : counts.eligible
              ? choose("可继续验证，效果未实测", "Ready for validation; task quality is untested")
              : choose("资料不足，暂不能确认适配", "Evidence is insufficient to establish fit"),
    summary: allExcluded
      ? choose(
          `已核验 ${candidates.length} 个候选，均被硬条件排除。${reasons.join("；")}。已知规格仍可查看，但本次没有可推荐对象。`,
          `All ${candidates.length} evaluated candidates are excluded by hard constraints. ${reasons.join("; ")}. Recorded specifications remain available; this analysis has no eligible recommendation.`,
        )
      : (decision?.recommendation.summary ?? research.summary),
    action: allExcluded
      ? choose(
          "先核对最低上下文等硬条件。若要求必须保留，请更换候选；修改条件后需要重新分析。",
          "Review the hard constraints, including the context minimum. If they must stay, select different candidates. Reanalyze after changing conditions.",
        )
      : (decision?.plan?.canDecide ??
        choose(
          "已知事实支持比较；业务效果、时延和费用仍需对应证据或同口径实测。",
          "Known facts support comparison; task quality, latency and cost still require corresponding evidence or comparable tests.",
        )),
  };
}
