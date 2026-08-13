export type ReviewAction = "approve" | "reject";

export const defaultApprovalReason = "已人工核对事实、来源和证据。";

export function resolveReviewReason(action: ReviewAction, input: string | undefined): string {
  const reason = input?.trim() ?? "";
  if (reason.length >= 3) return reason;
  if (action === "approve") return defaultApprovalReason;
  throw new Error("拒绝前请填写至少 3 个字符的具体理由。");
}
