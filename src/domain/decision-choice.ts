import type { ResearchRequest, ResearchResult } from "@/services/user-api";
import { compactFindings } from "./decision-reading";

type Candidate = NonNullable<NonNullable<ResearchResult["decision"]>["candidates"]>[number];

/** One displayed statement may support several dimensions; never repeat it as extra evidence. */
function choiceFindings(items: NonNullable<Candidate["strengths"]>) {
  const groups = new Map<string, (typeof items)[number] & { dimensions: string[] }>();
  for (const item of items) {
    if (!item.finding?.trim()) continue;
    const summary = item.finding.split(/(?<=[。])\s*|(?<=\.)\s+(?=[A-Z])/)[0];
    const previous = groups.get(summary);
    groups.set(summary, {
      ...item,
      finding: summary,
      dimensions: [...new Set([...(previous?.dimensions ?? []), item.dimension])],
      claimIds: [...new Set([...(previous?.claimIds ?? []), ...(item.claimIds ?? [])])],
    });
  }
  return [...groups.values()];
}

/** Describe the evidence gap we actually received, never the availability of facts on the web. */
export function candidateEvidenceStatus(candidate: Candidate, lang: "zh" | "en") {
  const reasons = new Set(
    (candidate.gaps ?? [])
      .filter((gap) => !["task-quality", "speed"].includes(gap.dimension))
      .map((gap) => gap.reason),
  );
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  if (candidate.eligibility === "conflict" || reasons.has("conflicting"))
    return t("知识库资料有冲突", "Conflicting knowledge-base evidence");
  if (reasons.has("needs-input"))
    return t("需要你补充条件", "Your requirements need clarification");
  if (reasons.has("not-current"))
    return t("知识库依据需重新核验", "Knowledge-base evidence needs revalidation");
  if (reasons.has("not-recorded"))
    return t("知识库缺少相关依据", "Relevant evidence missing from knowledge base");
  if (reasons.has("not-structured"))
    return t("已有资料尚未整理为选型依据", "Existing material is not structured for selection");
  return t("当前依据不足以确认", "Current evidence does not establish eligibility");
}

export function decisionComparisonRows(research: ResearchResult, selected: string[]) {
  return (research.decision?.comparisons ?? [])
    .filter((row) =>
      row.cells.some((cell) => selected.includes(cell.entityId) && cell.facts.length),
    )
    .map((row) => ({
      id: row.id,
      dimension: row.dimension,
      cells: selected.map((entityId) => ({
        entityId,
        facts: compactFindings(row.cells.find((cell) => cell.entityId === entityId)?.facts ?? []),
        otherPriceBasis:
          row.id.startsWith("api-price") &&
          (research.decision?.comparisons ?? []).some(
            (other) =>
              other.id !== row.id &&
              other.id.startsWith("api-price") &&
              other.cells.some((cell) => cell.entityId === entityId && cell.facts.length),
          ),
      })),
    }));
}

/** A small reading shortlist, not a performance ranking or relaxed eligibility gate. */
export function decisionChoices(research: ResearchResult) {
  const decision = research.decision;
  const required = decision?.scenario?.requiredFeatures ?? [];
  const trial = new Set(
    decision?.plan?.state === "ready-to-validate"
      ? decision.plan.trialCandidateIds.filter((id) =>
          decision.candidates?.some((row) => row.entityId === id && row.eligibility === "eligible"),
        )
      : [],
  );
  const explicit = new Set(research.decisionContext?.candidateEntityIds ?? []);
  const rows = (decision?.candidates ?? []).filter((row) => row.eligibility !== "excluded");
  const complete = (row: (typeof rows)[number]) =>
    required.length > 0 &&
    required.every((key) => (row.strengths ?? []).some((finding) => finding.dimension === key));
  const buckets = [
    rows.filter((row) => trial.has(row.entityId)),
    rows.filter((row) => !trial.has(row.entityId) && explicit.has(row.entityId)),
    rows.filter((row) => !trial.has(row.entityId) && !explicit.has(row.entityId) && complete(row)),
    rows.filter((row) => !trial.has(row.entityId) && !explicit.has(row.entityId) && !complete(row)),
  ];
  const primary =
    decision?.recommendation?.basis === "comparable-cost"
      ? decision.recommendation.primaryEntityId
      : undefined;
  buckets[0].sort((a, b) => Number(b.entityId === primary) - Number(a.entityId === primary));
  return buckets.flat().map((row) => ({
    ...row,
    ready: trial.has(row.entityId),
    qualifications: (research.citations ?? [])
      .map((citation) => citation.claim)
      .filter(
        (claim) =>
          claim.entityId === row.entityId &&
          claim.predicate === "workflow-qualification" &&
          claim.confidence === "verified" &&
          (row.claimIds ?? []).includes(claim.id) &&
          (!research.citationStates?.[claim.id] || research.citationStates[claim.id] === "current"),
      ),
    estimatedCost: (row.strengths ?? []).find((finding) => finding.dimension === "api-price"),
    known: choiceFindings(
      (row.strengths ?? [])
        .filter((finding) => required.includes(finding.dimension))
        .sort((a, b) => {
          if (decision?.scenario?.id !== "knowledge-workspace") return 0;
          const priority = ["knowledge-ingestion", "source-citations", "workspace-permissions"];
          const rank = (dimension: string) => {
            const index = priority.indexOf(dimension);
            return index < 0 ? priority.length : index;
          };
          return rank(a.dimension) - rank(b.dimension);
        })
        .slice(0, 2),
    ),
    missing: [
      ...new Set(
        (row.gaps ?? [])
          .filter((gap) => !["task-quality", "speed", "evidence"].includes(gap.dimension))
          .map((gap) => gap.dimension),
      ),
    ].slice(0, 2),
  }));
}

/** Show qualified options first; keep explicitly requested unconfirmed options
 * visible, while unrelated incomplete options stay in the optional remainder. */
export function decisionVisibleChoices(research: ResearchResult) {
  const choices = decisionChoices(research);
  const named = new Set(research.decisionContext?.candidateEntityIds ?? []);
  const preferred = choices.filter((row) => row.ready || named.has(row.entityId));
  const shown = (preferred.length ? preferred : choices).slice(0, 3);
  const shownIds = new Set(shown.map((row) => row.entityId));
  return { shown, more: choices.filter((row) => !shownIds.has(row.entityId)) };
}

/** Unconfirmed candidates get qualification notes, never business pass records. */
export function candidateRecordMode(research: ResearchResult, selected: string[]) {
  if (!selected.length || selected.length > 3 || new Set(selected).size !== selected.length)
    return null;
  const rows = decisionChoices(research).filter((row) => selected.includes(row.entityId));
  if (rows.length !== selected.length) return null;
  if (rows.every((row) => row.ready)) return "business" as const;
  if (
    research.decision?.plan?.state === "needs-evidence" &&
    rows.every((row) => row.eligibility !== "conflict")
  )
    return "qualification" as const;
  return null;
}

export async function refreshDecision(
  research: ResearchResult,
  language: "zh" | "en",
  token: string,
  submit: (token: string, payload: ResearchRequest) => Promise<ResearchResult>,
) {
  if (!token)
    throw new Error(
      language === "zh" ? "请先登录，再更新这份分析。" : "Sign in to update this analysis.",
    );
  if (!research.decisionContext)
    throw new Error(
      language === "zh" ? "请先填写选型任务和条件。" : "Set the task and conditions first.",
    );
  return submit(token, {
    question: research.decisionContext.task,
    language,
    decisionContext: { ...structuredClone(research.decisionContext), workflowVersion: 2 },
  });
}
