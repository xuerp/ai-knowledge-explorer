import type { DecisionValidationItem } from "@/services/user-api";
import { validationTitle } from "./decision-presentation";

export type ValidationItemPatch = Omit<Partial<DecisionValidationItem>, "testConditions"> & {
  testConditions?: Partial<NonNullable<DecisionValidationItem["testConditions"]>>;
};

export function patchValidationItem(
  item: DecisionValidationItem,
  patch: ValidationItemPatch,
): DecisionValidationItem {
  const { testConditions, measurements, ...fields } = patch;
  return {
    ...item,
    ...fields,
    ...(measurements ? { measurements: { ...item.measurements, ...measurements } } : {}),
    ...(testConditions
      ? {
          testConditions: {
            modelVersion: "",
            configuration: "",
            testedAt: "",
            scope: "",
            ...item.testConditions,
            ...testConditions,
          },
        }
      : {}),
  };
}

export function groupValidationItems(items: DecisionValidationItem[]) {
  const groups = new Map<
    string | null,
    { candidateId: string | null; items: DecisionValidationItem[]; recorded: boolean }
  >();
  for (const item of items) {
    const key = item.candidateId ?? null;
    let group = groups.get(key);
    if (!group) {
      group = { candidateId: key, items: [], recorded: false };
      groups.set(key, group);
    }
    group.items.push(item);
    group.recorded ||=
      Object.values(item.measurements ?? {}).some((value) => value != null && value !== "") ||
      item.result.trim().length > 0 ||
      item.status !== "pending" ||
      Object.values(item.testConditions ?? {}).some((value) =>
        typeof value === "number" ? value > 0 : typeof value === "string" && !!value.trim(),
      );
  }
  return [...groups.values()];
}

export function validationDimension(id: string | undefined): string | null {
  return (
    ["quality", "latency", "cost", "terms"].find((key) => id === key || id?.endsWith(`-${key}`)) ??
    null
  );
}

/** Explicit reuse of user-entered settings; only empty fields within one candidate. */
export function fillCandidateConditions(items: DecisionValidationItem[], sourceId: string) {
  const source = items.find((item) => item.id === sourceId);
  if (!source?.testConditions) return items;
  return items.map((item) => {
    if (item.id === source.id || (item.candidateId ?? null) !== (source.candidateId ?? null))
      return item;
    const conditions = {
      modelVersion: "",
      configuration: "",
      sampleCount: null,
      testedAt: "",
      scope: "",
      ...item.testConditions,
    };
    for (const key of [
      "modelVersion",
      "configuration",
      "sampleCount",
      "testedAt",
      "scope",
    ] as const) {
      const entered = source.testConditions![key];
      if (
        (conditions[key] == null || conditions[key] === "") &&
        entered != null &&
        entered !== ""
      ) {
        if (key === "sampleCount")
          conditions.sampleCount = typeof entered === "number" ? entered : null;
        else conditions[key] = String(entered);
      }
    }
    return { ...item, testConditions: conditions };
  });
}

export function mergeValidationPlan(
  existing: DecisionValidationItem[],
  plan: DecisionValidationItem[],
): DecisionValidationItem[] {
  const merged = [...existing];
  for (const item of plan) {
    const dimension = validationDimension(item.id);
    if (
      merged.some(
        (old) =>
          (old.candidateId ?? null) === (item.candidateId ?? null) &&
          (dimension ? validationDimension(old.id) === dimension : old.id === item.id),
      )
    )
      continue;
    if (merged.some((old) => old.id === item.id))
      throw new Error(
        "条目编号存在冲突，请保留原记录并核对。 / Check conflicting item IDs; original notes retained.",
      );
    merged.push(item);
  }
  if (merged.length > 100)
    throw new Error(
      "清单超过100项，原记录已保留。 / Checklist exceeds 100 items; original notes retained.",
    );
  return merged;
}

export function validationItemHeading(item: DecisionValidationItem, lang: "zh" | "en") {
  const labels: Record<string, [string, string]> = {
    quality: ["任务效果", "Task quality"],
    latency: ["完成时间与人工参与", "Time and human involvement"],
    cost: ["实际费用", "Actual cost"],
    terms: ["使用入口与条款", "Interface and terms"],
  };
  return (
    labels[validationDimension(item.id) ?? ""]?.[lang === "zh" ? 0 : 1] ??
    validationTitle(item.title, lang)
  );
}

/** A save response must not overwrite edits made while that request was in flight. */
export function retainValidationDraft(
  current: DecisionValidationItem[],
  submitted: DecisionValidationItem[],
  persisted: DecisionValidationItem[],
) {
  return JSON.stringify(current) === JSON.stringify(submitted) ? persisted : current;
}
