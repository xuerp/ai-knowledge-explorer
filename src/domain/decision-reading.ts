import type { DecisionResult } from "@/services/user-api";

type CitedFinding = { finding: string; claimIds: string[] };
const sentences = (text: string) =>
  text
    .split(/(?<=[。！？])\s*|(?<=[.!?])\s+(?=[A-Z])/)
    .map((line) => line.trim())
    .filter(Boolean);

/** Merge overlapping citations, retaining all distinct statements and qualifications. */
export function compactFindings(items: CitedFinding[]): CitedFinding[] {
  const groups: CitedFinding[] = [];
  for (const item of items) {
    const related = groups.filter((group) =>
      group.claimIds.some((id) => item.claimIds.includes(id)),
    );
    const members = [...related, item];
    const merged = {
      finding: [...new Set(members.flatMap((member) => sentences(member.finding)))].join(" "),
      claimIds: [...new Set(members.flatMap((member) => member.claimIds))],
    };
    const first = related.length ? groups.indexOf(related[0]) : groups.length;
    for (const group of related) groups.splice(groups.indexOf(group), 1);
    groups.splice(first, 0, merged);
  }
  return groups;
}

/** Reading projection only: retain every qualification; consolidate repeated prose. */
export function decisionReading(decision: DecisionResult, entityName = (id: string) => id) {
  const candidates = decision.candidates ?? [];
  const comparisons = [...(decision.comparisons ?? [])].sort(
    (a, b) =>
      Number(b.id?.startsWith("feature-") ?? false) - Number(a.id?.startsWith("feature-") ?? false),
  );
  const reasons = new Map<string, string[]>();
  for (const candidate of candidates)
    for (const reason of new Set(candidate.reasons))
      reasons.set(reason, [...(reasons.get(reason) ?? []), candidate.entityId]);
  const commonReasons = [...reasons].filter(([, ids]) => ids.length > 1);
  const commonReasonSet = new Set(commonReasons.map(([reason]) => reason));
  const individualReasons = (id: string) =>
    candidates
      .find((candidate) => candidate.entityId === id)
      ?.reasons?.filter((reason) => !commonReasonSet.has(reason)) ?? [];
  const gapKey = (gap: NonNullable<(typeof candidates)[number]["gaps"]>[number]) =>
    JSON.stringify([gap.dimension, gap.reason, gap.detail, [...gap.claimIds].sort()]);
  const gapGroups = new Map<
    string,
    { gap: NonNullable<(typeof candidates)[number]["gaps"]>[number]; ids: string[] }
  >();
  for (const candidate of candidates)
    for (const gap of candidate.gaps ?? []) {
      const key = gapKey(gap);
      const group = gapGroups.get(key) ?? { gap, ids: [] };
      if (!group.ids.includes(candidate.entityId)) group.ids.push(candidate.entityId);
      gapGroups.set(key, group);
    }
  const commonGaps = [...gapGroups.values()].filter((group) => group.ids.length > 1);
  const commonGapKeys = new Set(commonGaps.map(({ gap }) => gapKey(gap)));
  const individualGaps = (id: string) =>
    candidates
      .find((candidate) => candidate.entityId === id)
      ?.gaps?.filter((gap) => !commonGapKeys.has(gapKey(gap))) ?? [];
  const coverage = (id: string) => {
    const candidate = candidates.find((item) => item.entityId === id);
    const features = decision.scenario?.requiredFeatures ?? [];
    const described = new Set(candidate?.strengths?.map((item) => item.dimension));
    const hard = (candidate?.requiredDimensions ?? []).filter(
      (key) => !["task-quality", "speed", "latency"].includes(key),
    );
    return {
      features: features.length,
      described: features.filter((key) => described.has(key)).length,
      hard: hard.length,
      verified: hard.filter((key) => candidate?.coveredDimensions.includes(key)).length,
    };
  };
  const factKey = (fact: { finding: string; claimIds: string[] }) => {
    const prefix = candidates
      .map((item) => entityName(item.entityId) + ": ")
      .find((value) => fact.finding.startsWith(value));
    return `${fact.finding.slice(prefix?.length ?? 0).trim()}|${[...fact.claimIds].sort().join()}`;
  };
  const renderedFacts = new Set(
    [
      ...comparisons.flatMap((row) => row.cells.flatMap((cell) => cell.facts)),
      ...candidates.flatMap((candidate) => candidate.strengths ?? []),
    ].map(factKey),
  );
  const visibleFacts = [
    ...comparisons.flatMap((row) => row.cells.flatMap((cell) => cell.facts)),
    ...candidates.flatMap((candidate) => candidate.strengths ?? []),
  ];
  const extraEvidence = (decision.tradeoffs ?? []).filter((fact) => {
    if (renderedFacts.has(factKey(fact))) return false;
    const prefix = candidates
      .map((item) => entityName(item.entityId) + ": ")
      .find((value) => fact.finding.startsWith(value));
    const known = new Set(
      visibleFacts
        .filter((item) => item.claimIds.some((id) => fact.claimIds.includes(id)))
        .flatMap((item) => sentences(item.finding)),
    );
    return !sentences(fact.finding.slice(prefix?.length ?? 0)).every((line) => known.has(line));
  });
  const nextChecks = (decision.nextChecks ?? []).filter(
    (line) =>
      !candidates.some(
        (candidate) =>
          line === entityName(candidate.entityId) + ": " + (candidate.reasons ?? []).join("；"),
      ),
  );
  return {
    knownComparisons: comparisons.filter((row) => row.cells.some((cell) => cell.facts.length)),
    missingDimensions: comparisons
      .filter((row) => !row.cells.some((cell) => cell.facts.length))
      .map((row) => row.dimension),
    commonReasons,
    individualReasons,
    commonGaps,
    individualGaps,
    coverage,
    extraEvidence,
    nextChecks: [...new Set(nextChecks)],
  };
}
