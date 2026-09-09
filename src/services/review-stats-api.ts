import type { ReviewReasonCategory } from "@/domain/review-decision";
import { fetchWithNetworkRetry } from "@/services/fetch-with-retry";

export interface ReviewStats {
  generatedAt: string;
  openCount: number;
  reviewedCount: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number;
  rejectionRate: number;
  averageReviewSeconds?: number | null;
  reviewedWithDurationCount: number;
  lastReviewedAt?: string | null;
  rejectionReasons: Array<{
    category: ReviewReasonCategory | "uncategorized";
    count: number;
    ratio: number;
  }>;
}

const apiBaseUrl = (
  import.meta.env.SSR ? import.meta.env.VITE_API_UPSTREAM_URL : import.meta.env.VITE_API_BASE_URL
)
  ?.trim()
  .replace(/\/$/, "");

export async function getReviewStats(signal?: AbortSignal): Promise<ReviewStats> {
  if (!apiBaseUrl) throw new Error("审核统计 API 尚未配置。");
  const response = await fetchWithNetworkRetry(
    `${apiBaseUrl}/api/review/stats`,
    { headers: { Accept: "application/json" }, signal },
    { attempts: 3 },
  );
  if (!response.ok) throw new Error(`审核统计加载失败（HTTP ${response.status}）。`);
  return (await response.json()) as ReviewStats;
}
