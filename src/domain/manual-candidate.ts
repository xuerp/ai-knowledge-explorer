import type { DocumentSnapshotView, SourceView } from "@/services/admin-api";

export interface ManualCandidateInput {
  entityId?: string;
  claimZh: string;
  claimEn: string;
}

export interface CandidateCreateRequest {
  id: string;
  entityId?: string;
  claim: {
    id: string;
    text: { zh: string; en: string };
    confidence: "verified";
    sourceIds: string[];
    updatedAt: string;
    observedAt: string;
  };
  evidence: Array<{
    id: string;
    title: { zh: string; en: string };
    url: string;
    publisher: string;
    publishedAt: string;
    collectedAt: string;
    verifiedAt: string;
    originalLanguage: "en";
    type: "official";
    supportsClaimIds: string[];
  }>;
}

const entityBySourceId: Record<string, string> = {
  "s-mcp-architecture": "e-mcp",
};

function calendarDate(value: string) {
  return value.slice(0, 10);
}

export function suggestedEntityId(sourceId: string) {
  return entityBySourceId[sourceId] ?? "";
}

export function buildManualCandidate(
  source: SourceView,
  snapshot: DocumentSnapshotView,
  input: ManualCandidateInput,
  now = new Date(),
): CandidateCreateRequest {
  const claimZh = input.claimZh.trim();
  const claimEn = input.claimEn.trim();
  if (!claimZh || !claimEn) {
    throw new Error("请同时填写中文事实和英文事实。");
  }

  const entityId = input.entityId?.trim() || undefined;
  const snapshotSuffix = snapshot.id
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
  const suffix = `${snapshotSuffix}-${now.getTime().toString(36)}`;
  const claimId = `claim-${source.id}-${suffix}`;
  const observedAt = calendarDate(snapshot.observedAt);
  const publishedAt = calendarDate(snapshot.publishedAt ?? snapshot.observedAt);

  return {
    id: `manual-${source.id}-${suffix}`,
    ...(entityId ? { entityId } : {}),
    claim: {
      id: claimId,
      text: { zh: claimZh, en: claimEn },
      confidence: "verified",
      sourceIds: [`evidence-${suffix}`],
      updatedAt: observedAt,
      observedAt,
    },
    evidence: [
      {
        id: `evidence-${suffix}`,
        title: { zh: source.title, en: source.title },
        url: source.url,
        publisher: source.publisher,
        publishedAt,
        collectedAt: observedAt,
        verifiedAt: observedAt,
        originalLanguage: "en",
        type: "official",
        supportsClaimIds: [claimId],
      },
    ],
  };
}
