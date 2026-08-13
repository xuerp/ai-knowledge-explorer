export type ReviewAction = "approve" | "reject";

type ReviewQueueState = {
  id: string;
  status: "pending" | "approved" | "rejected" | "needs-more-evidence";
  version: number;
};

type BatchReviewState = ReviewQueueState & {
  conflictClaimIds: readonly string[];
  evidenceItems: readonly unknown[];
};

const terminalReviewStatuses = new Set<ReviewQueueState["status"]>(["approved", "rejected"]);

export const defaultApprovalReason = "已人工核对事实、来源和证据。";

export function resolveReviewReason(action: ReviewAction, input: string | undefined): string {
  const reason = input?.trim() ?? "";
  if (reason.length >= 3) return reason;
  if (action === "approve") return defaultApprovalReason;
  throw new Error("拒绝前请填写至少 3 个字符的具体理由。");
}

export function isAlreadyAppliedReviewDecision(action: ReviewAction, message: string): boolean {
  const expectedStatus = action === "approve" ? "approved" : "rejected";
  return message.toLocaleLowerCase().includes(`already ${expectedStatus}`);
}

export function mergeReviewQueue<T extends ReviewQueueState>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const incomingIds = new Set(incoming.map((item) => item.id));
  const merged = incoming.map((item) => {
    const local = currentById.get(item.id);
    if (
      local &&
      terminalReviewStatuses.has(local.status) &&
      !terminalReviewStatuses.has(item.status) &&
      local.version >= item.version
    ) {
      return local;
    }
    return item;
  });

  for (const item of current) {
    if (!incomingIds.has(item.id)) merged.push(item);
  }
  return merged;
}

export function selectBatchApprovableReviewItems<T extends BatchReviewState>(
  queue: readonly T[],
  candidateIds: readonly string[],
): T[] {
  const selectedIds = new Set(candidateIds);
  return queue.filter(
    (item) =>
      selectedIds.has(item.id) &&
      item.status === "pending" &&
      item.conflictClaimIds.length === 0 &&
      item.evidenceItems.length > 0,
  );
}
