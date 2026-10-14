import type { Claim, Evidence } from "./types";
import type { ResearchResult } from "@/services/user-api";

/** API citations are authoritative; snapshot lookup is only for showcase answers. */
export function selectResearchEvidence(
  research: Pick<ResearchResult, "claimIds" | "citations" | "citationStates"> | null,
  snapshotClaims: Claim[],
  snapshotEvidence: Evidence[],
): { claims: Claim[]; evidence: Evidence[] } {
  if (!research) return { claims: [], evidence: [] };
  const apiCitations = research.citations;
  const claims: Claim[] = [];
  const evidence = new Map<string, Evidence>();
  for (const id of new Set(research.claimIds)) {
    if (research.citationStates?.[id] === "unavailable") continue;
    const citation = apiCitations?.find((item) => item.claim.id === id);
    const claim =
      apiCitations !== undefined ? citation?.claim : snapshotClaims.find((item) => item.id === id);
    if (!claim) continue;
    claims.push(claim);
    const available = apiCitations !== undefined ? (citation?.evidence ?? []) : snapshotEvidence;
    for (const sourceId of claim.sourceIds) {
      const source = available.find((item) => item.id === sourceId);
      if (source && !evidence.has(sourceId)) evidence.set(sourceId, source);
    }
  }
  return { claims, evidence: [...evidence.values()] };
}
