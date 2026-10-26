import catalog from "../../backend/data/decision_scenarios.v1.json";
import workflows from "../../backend/data/decision_workflows.v1.json";
import type { DecisionContext } from "@/services/user-api";

export function positiveTaskText(text: string) {
  return text
    .split(
      new RegExp(
        `${catalog.interpretation.clauseSeparator}|${catalog.interpretation.contrastSeparator}`,
        "i",
      ),
    )
    .flatMap((clause) =>
      new RegExp(catalog.interpretation.negativeClause, "i").test(clause.trim())
        ? [clause]
        : clause.split(new RegExp(catalog.interpretation.scopeBoundary, "i")),
    )
    .map((clause) => clause.trim())
    .filter((clause) => !new RegExp(catalog.interpretation.negativeClause, "i").test(clause))
    .join(" ");
}

const contains = (text: string, term: string) =>
  /[\u3400-\u9fff]/.test(term)
    ? text.toLowerCase().includes(term.toLowerCase())
    : new RegExp(`(?<![\\w])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(
        text,
      );

/** A bounded shared taxonomy, not a claim of unrestricted language understanding. */
export function scenarioDefinition(context: Pick<DecisionContext, "task" | "taskType">) {
  const text = positiveTaskText(context.task);
  const methods = workflows.workflows.filter(
    (row) =>
      row.match.length > 0 &&
      row.match.every((pattern) => new RegExp(pattern, "i").test(text)) &&
      !(row.id === "classification" && /提取|抽取|字段|JSON|extract|fields/i.test(text)),
  );
  if (methods.length === 1) return catalog.scenarios.find((row) => row.id === methods[0].scenario);
  const semanticMatches = new Set(
    catalog.semanticRules
      .filter((rule) => rule.all.every((pattern) => new RegExp(pattern, "i").test(text)))
      .map((rule) => rule.scenario),
  );
  const scope =
    context.taskType && context.taskType !== "unspecified"
      ? context.taskType
      : new RegExp(catalog.interpretation.modelScope, "i").test(text)
        ? "model-api"
        : undefined;
  // An action such as drafting an article outranks a topic mention such as RAG.
  const ranked = catalog.scenarios
    .map((row) => ({
      row,
      strength: semanticMatches.has(row.id)
        ? 3
        : row.intentPatterns.some((pattern) => new RegExp(pattern, "i").test(text))
          ? 2
          : row.patterns.some((pattern) => contains(text, pattern))
            ? 1
            : 0,
    }))
    .filter((item) => item.strength)
    .sort((a, b) => b.strength - a.strength);
  for (const { row } of ranked) {
    if (!scope || row.taskType === scope) return row;
    const alternatives = "scopeAlternatives" in row ? row.scopeAlternatives : undefined;
    const alternative = alternatives?.[scope as keyof typeof alternatives];
    if (alternative) return catalog.scenarios.find((item) => item.id === alternative);
  }
  const fallback = (
    {
      "coding-product": "coding-workspace",
      "knowledge-product": "knowledge-workspace",
      "agent-development": "agent-orchestration",
    } as Record<string, string>
  )[scope ?? ""];
  return catalog.scenarios.find((row) => row.id === fallback);
}

export function textOnlyInput(task: string) {
  return new RegExp(catalog.interpretation.textOnly, "i").test(positiveTaskText(task));
}

export function nativeRetrievalRequested(task: string) {
  return new RegExp(catalog.interpretation.nativeRetrieval, "i").test(positiveTaskText(task));
}

/** Request paraphrases do not expand the vocabulary used to prove vendor facts. */
export function requestedFeatureIds(task: string) {
  const text = positiveTaskText(task);
  return Object.entries(catalog.features)
    .filter(
      ([, feature]) =>
        feature.patterns.some((pattern) => contains(text, pattern)) ||
        ("requestPatterns" in feature &&
          feature.requestPatterns.some((pattern) => new RegExp(pattern, "i").test(text))),
    )
    .map(([key]) => key);
}

export function imageInputRequested(task: string) {
  return new RegExp(catalog.interpretation.imageInput, "i").test(positiveTaskText(task));
}
