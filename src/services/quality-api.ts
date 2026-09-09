import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";

export interface QualityMetrics {
  generatedAt: string;
  dataMode: "demo" | "live";
  business: {
    updatedAt: string;
    entityCount: number;
    claimCount: number;
    evidenceCount: number;
    relationCount: number;
    timelineEntryCount: number;
    evidenceReferenceCoverage: number;
    officialEvidenceRatio: number;
    reviewedEvidenceRatio: number;
    freshEvidenceRatio: number;
    verifiedContentRatio: number;
    coreRelationDeficit: number;
  };
  evaluation: {
    updatedAt: string;
    cadence: "daily-or-on-retrieval-change";
    artifactPath: string;
    goldenSetVersion: string;
    sampleCount: number;
    snapshotSha256: string;
    retrievalMode: "lexical" | "hybrid";
    embeddingModel?: string | null;
    topK: number;
    evaluationCommit: string;
    recallAt8: number;
    precisionAt8: number;
    entityRecallAt8: number;
    passRatio: number;
  };
}

const apiBaseUrl = (
  import.meta.env.SSR ? import.meta.env.VITE_API_UPSTREAM_URL : import.meta.env.VITE_API_BASE_URL
)
  ?.trim()
  .replace(/\/$/, "");

export async function getQualityMetrics(signal?: AbortSignal): Promise<QualityMetrics> {
  if (!apiBaseUrl) throw new Error("质量指标 API 尚未配置。");
  const response = await fetchWithNetworkRetry(
    `${apiBaseUrl}/api/quality/metrics`,
    { headers: { Accept: "application/json" }, signal },
    { attempts: 3 },
  );
  if (!response.ok) throw new Error(`质量指标加载失败（HTTP ${response.status}）。`);
  return (await response.json()) as QualityMetrics;
}
