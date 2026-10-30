import { selectBatchApprovableReviewItems } from "@/domain/review-decision";
import { orderReviewItems } from "@/domain/review-priority";
import { classifyReviewLane, reviewLaneCounts } from "@/domain/review-lanes";
import { isAllowlistedSource, selectRolloutSources } from "@/domain/source-rollout";

import { type AdminUser } from "@/services/admin-api";

import type { Workspace } from "./types";
import type { ReviewController } from "./useReviewController";
export function buildReviewViewModel(
  controller: ReviewController,
  workspace: Workspace,
  user: AdminUser,
) {
  const { goldenQuestionReport, recentExtraction, reviewFilter, sourceFilter, sourceSearch } =
    controller;
  const allowlistedHosts = workspace.integrations?.fetchAllowedHosts ?? [];
  const activeGoldenQuestionReport = goldenQuestionReport ?? workspace.quality?.goldenQuestions;
  const filteredSources = workspace.sources.filter((source) => {
    const search = sourceSearch.trim().toLocaleLowerCase("zh-CN");
    const matchesSearch =
      !search ||
      [source.title, source.publisher, source.url, source.id].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(search),
      );
    const allowlisted = isAllowlistedSource(source, allowlistedHosts);
    const matchesFilter =
      sourceFilter === "all" ||
      (sourceFilter === "needs-action" && source.healthState === "paused") ||
      (sourceFilter === "manual" && source.collectionStrategy === "manual") ||
      (sourceFilter === "allowlisted" && allowlisted && source.collectionStrategy !== "manual") ||
      (sourceFilter === "automatic" && source.fetchEnabled);
    return matchesSearch && matchesFilter;
  });
  const rolloutSources = selectRolloutSources(workspace.sources, allowlistedHosts);
  const pendingQueue = workspace.queue.filter(
    (item) => item.status === "pending" || item.status === "needs-more-evidence",
  );
  const reviewHistory = workspace.queue.filter(
    (item) => item.status === "approved" || item.status === "rejected",
  );
  const automationApprovals = reviewHistory.filter(
    (item) =>
      item.status === "approved" &&
      item.reviewMethod === "automation" &&
      item.evidenceItems.length > 0,
  );
  const recentCandidateIds = new Set(recentExtraction?.candidateIds ?? []);
  const freshSafeCandidateIds = new Set(
    pendingQueue
      .filter((item) => classifyReviewLane(item, reviewHistory) === "fresh-safe")
      .map((item) => item.id),
  );
  const recentBatchApprovable = selectBatchApprovableReviewItems(
    workspace.queue,
    (recentExtraction?.candidateIds ?? []).filter((id) => freshSafeCandidateIds.has(id)),
  );
  const allBatchApprovable = selectBatchApprovableReviewItems(
    workspace.queue,
    pendingQueue.map((item) => item.id).filter((id) => freshSafeCandidateIds.has(id)),
  );
  const laneCounts = reviewLaneCounts(pendingQueue, reviewHistory);
  const filteredPendingQueue = pendingQueue.filter((item) => {
    return reviewFilter === "all" || classifyReviewLane(item, reviewHistory) === reviewFilter;
  });
  const orderedPendingQueue = orderReviewItems(filteredPendingQueue).sort(
    (left, right) =>
      Number(recentCandidateIds.has(right.id)) - Number(recentCandidateIds.has(left.id)),
  );
  return {
    ...controller,
    workspace,
    user,
    allowlistedHosts,
    activeGoldenQuestionReport,
    filteredSources,
    rolloutSources,
    pendingQueue,
    reviewHistory,
    automationApprovals,
    recentCandidateIds,
    freshSafeCandidateIds,
    recentBatchApprovable,
    allBatchApprovable,
    laneCounts,
    filteredPendingQueue,
    orderedPendingQueue,
  };
}
export type ReviewViewModel = ReturnType<typeof buildReviewViewModel>;
