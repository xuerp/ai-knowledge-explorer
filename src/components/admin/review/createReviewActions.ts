import { toast } from "sonner";

import { lifecycleIdempotencyKey, type ClaimLifecycleMatch } from "@/domain/claim-lifecycle";
import {
  isAlreadyAppliedReviewDecision,
  partitionReviewBatchItems,
  resolveReviewReasonCategory,
  resolveReviewReason,
  selectBatchApprovableReviewItems,
  type ReviewAction,
  type ReviewReasonCategory,
} from "@/domain/review-decision";

import { classifyReviewLane } from "@/domain/review-lanes";

import { adminApi, type ReviewQueueItem } from "@/services/admin-api";

import type { ReviewState } from "./useReviewState";
export function createReviewActions(state: ReviewState) {
  const {
    publicationReasons,
    reasonCategories,
    reasons,
    recentExtraction,
    refresh,
    setBusy,
    setError,
    setOperationMessage,
    setPublicationReasons,
    setReasonCategories,
    setReasons,
    setRecentExtraction,
    setReviewErrors,
    setReviewingIds,
    setWorkspace,
    token,
    workspace,
  } = state;
  const changePublicationState = async (item: ReviewQueueItem) => {
    const reason = (publicationReasons[item.id] ?? "").trim();
    if (reason.length < 3) {
      setReviewErrors((current) => ({ ...current, [item.id]: "请填写至少 3 个字的处理原因。" }));
      return;
    }
    const action = item.lifecycleStatus === "retracted" ? "restore" : "retract";
    setBusy(true);
    setReviewErrors((current) => ({ ...current, [item.id]: "" }));
    try {
      const updated = await adminApi.changePublicationState(token, item, action, reason);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              queue: current.queue.map((row) => (row.id === updated.id ? updated : row)),
            }
          : current,
      );
      setPublicationReasons((current) => ({ ...current, [item.id]: "" }));
      const message =
        action === "retract" ? "事实已撤回，公开页面与检索已同步移除。" : "事实已恢复公开。";
      setOperationMessage(message);
      toast.success(message);
      await refresh(token);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "处理失败，请刷新后重试。";
      setReviewErrors((current) => ({ ...current, [item.id]: message }));
      toast.error("处理失败", { description: message });
    } finally {
      setBusy(false);
    }
  };

  const decide = async (item: ReviewQueueItem, action: ReviewAction) => {
    let reason: string | undefined;
    let reasonCategory: ReviewReasonCategory | undefined;
    try {
      reason = resolveReviewReason(action, reasons[item.id]);
      reasonCategory = resolveReviewReasonCategory(action, reasonCategories[item.id]);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "请填写审核理由。";
      setReviewErrors((current) => ({
        ...current,
        [item.id]: message,
      }));
      toast.error("无法提交审核", { description: message });
      return;
    }
    setReviewingIds((current) => new Set(current).add(item.id));
    setReviewErrors((current) => ({ ...current, [item.id]: "" }));
    setError("");
    try {
      const decided = await adminApi.decide(
        token,
        item.id,
        action,
        item.version,
        reason,
        reasonCategory,
      );
      setWorkspace((current) =>
        current
          ? {
              ...current,
              queue: current.queue.map((candidate) =>
                candidate.id === decided.id ? decided : candidate,
              ),
            }
          : current,
      );
      setReasons((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setReasonCategories((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setOperationMessage(
        action === "approve" ? "候选已批准并进入审核历史。" : "候选已拒绝并进入审核历史。",
      );
      toast.success(action === "approve" ? "批准成功" : "拒绝成功", {
        description: item.claim.text.zh,
        duration: 5_000,
      });
      try {
        await refresh(token);
      } catch {
        setOperationMessage(
          action === "approve"
            ? "候选已批准；统计信息将在下次刷新时更新。"
            : "候选已拒绝；统计信息将在下次刷新时更新。",
        );
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "审核操作失败。";
      if (isAlreadyAppliedReviewDecision(action, message)) {
        setWorkspace((current) =>
          current
            ? {
                ...current,
                queue: current.queue.map((candidate) =>
                  candidate.id === item.id
                    ? {
                        ...candidate,
                        status: action === "approve" ? "approved" : "rejected",
                        version: candidate.version + 1,
                      }
                    : candidate,
                ),
              }
            : current,
        );
        setOperationMessage(
          action === "approve"
            ? "该候选已经批准，无需重复操作。"
            : "该候选已经拒绝，无需重复操作。",
        );
        toast.success(action === "approve" ? "该候选已批准" : "该候选已拒绝", {
          description: "状态已同步，无需重复操作。",
          duration: 5_000,
        });
        void refresh(token).catch(() => undefined);
        return;
      }
      setReviewErrors((current) => ({
        ...current,
        [item.id]: message,
      }));
      toast.error("审核失败", { description: message, duration: 6_000 });
    } finally {
      setReviewingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const decideLifecycle = async (item: ReviewQueueItem, match: ClaimLifecycleMatch) => {
    const action = match.relationship === "duplicate" ? "merged-evidence" : "superseding";
    const reason =
      reasons[item.id]?.trim() ||
      (action === "merged-evidence"
        ? "确定性语义指纹一致，合并新的证据来源。"
        : "同一实体与谓词的数值、条件或有效期已修订，人工确认以新事实替代旧事实。");
    setReviewingIds((current) => new Set(current).add(item.id));
    setReviewErrors((current) => ({ ...current, [item.id]: "" }));
    try {
      const decided = await adminApi.decideLifecycle(
        token,
        item.id,
        action,
        match.target,
        item.version,
        lifecycleIdempotencyKey(item, match.target, action),
        reason,
      );
      setOperationMessage(
        action === "merged-evidence"
          ? "新证据已合并到已有事实，未新增公共事实卡片。"
          : "新事实已发布，旧事实已转入可追溯历史。",
      );
      toast.success(action === "merged-evidence" ? "证据合并成功" : "事实替代成功");
      await refresh(token);
      setReasons((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      return decided;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "事实生命周期操作失败。";
      setReviewErrors((current) => ({ ...current, [item.id]: message }));
      toast.error("无法提交生命周期操作", { description: message });
    } finally {
      setReviewingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const batchApproveCandidates = async (requestedCandidateIds: string[]) => {
    if (!workspace) return;
    const approvedHistory = workspace.queue.filter((item) => item.status === "approved");
    const freshSafeIds = new Set(
      workspace.queue
        .filter(
          (item) =>
            requestedCandidateIds.includes(item.id) &&
            classifyReviewLane(item, approvedHistory) === "fresh-safe",
        )
        .map((item) => item.id),
    );
    const candidates = selectBatchApprovableReviewItems(
      workspace.queue,
      requestedCandidateIds.filter((id) => freshSafeIds.has(id)),
    );
    if (candidates.length === 0) {
      setOperationMessage("本批没有同时属于新鲜安全通道、具备原文锚点且无冲突的候选。");
      return;
    }
    const candidateIds = new Set(candidates.map((item) => item.id));
    setBusy(true);
    setReviewingIds((current) => new Set([...current, ...candidateIds]));
    setError("");
    const decisions = new Map<string, ReviewQueueItem>();
    const failures = new Map<string, string>();
    const batches = partitionReviewBatchItems(candidates);
    for (const [index, batch] of batches.entries()) {
      setOperationMessage(
        `正在批准第 ${index + 1}/${batches.length} 批安全候选，已完成 ${decisions.size} 条。`,
      );
      try {
        const approved = await adminApi.batchApprove(
          token,
          batch.map((item) => ({
            id: item.id,
            expectedVersion: item.version,
            reason: resolveReviewReason("approve", reasons[item.id]),
          })),
        );
        for (const item of approved) decisions.set(item.id, item);
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : "批量审核失败";
        for (const item of batch) failures.set(item.id, message);
      }
    }
    setWorkspace((current) =>
      current
        ? {
            ...current,
            queue: current.queue.map((item) => decisions.get(item.id) ?? item),
          }
        : current,
    );
    setReviewErrors((current) => ({ ...current, ...Object.fromEntries(failures) }));
    setReasons((current) => {
      const next = { ...current };
      for (const id of decisions.keys()) delete next[id];
      return next;
    });
    if (recentExtraction) {
      const remainingIds = recentExtraction.candidateIds.filter((id) => !decisions.has(id));
      setRecentExtraction(
        remainingIds.length > 0 ? { ...recentExtraction, candidateIds: remainingIds } : null,
      );
    }
    const skipped = requestedCandidateIds.length - candidates.length;
    setOperationMessage(
      `本批审核完成：批准 ${decisions.size} 条，失败 ${failures.size} 条，保留人工判断 ${skipped} 条。`,
    );
    if (decisions.size > 0) {
      toast.success(`已批准 ${decisions.size} 条候选`, {
        description: "待审核数量和审核历史已同步更新。",
        duration: 5_000,
      });
    }
    if (failures.size > 0) {
      toast.error(`${failures.size} 条候选批准失败`, {
        description: "失败条目仍保留在待审核队列，可单独重试。",
        duration: 6_000,
      });
    }
    try {
      await refresh(token);
    } catch {
      // 已完成的决定保留在本地，延迟刷新不能将其降级回待审核。
    } finally {
      setReviewingIds((current) => {
        const next = new Set(current);
        for (const id of candidateIds) next.delete(id);
        return next;
      });
      setBusy(false);
    }
  };

  const batchApproveRecentCandidates = () =>
    batchApproveCandidates(recentExtraction?.candidateIds ?? []);

  const batchMergeDeterministicDuplicates = async () => {
    if (!window.confirm("确认把与已发布事实完全相同的候选合并为补充证据？原候选会保留在历史中。")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const merged = await adminApi.batchMergeDuplicates(token, 50);
      setOperationMessage(
        merged.length > 0
          ? `已合并 ${merged.length} 条确定性重复候选；证据已归并到当前事实。`
          : "没有找到可安全合并的确定性重复候选。",
      );
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "批量合并重复候选失败。");
    } finally {
      setBusy(false);
    }
  };

  const batchRejectDeterministicallyInvalid = async () => {
    if (!window.confirm("确认拒绝缺少实体、证据或原文锚点的候选？这些记录会保留在审核历史中。")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const rejected = await adminApi.batchRejectInvalid(token, 50);
      setOperationMessage(
        rejected.length > 0
          ? `已拒绝 ${rejected.length} 条确定性无效候选；记录仍保留在审核历史中。`
          : "没有找到可确定判为无效的候选，陈旧但证据完整的内容未被处理。",
      );
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "批量清理无效候选失败。");
    } finally {
      setBusy(false);
    }
  };

  const verifyAutomationApprovals = async () => {
    if (!workspace) return;
    const candidates = workspace.queue.filter(
      (item) =>
        item.status === "approved" &&
        item.reviewMethod === "automation" &&
        item.evidenceItems.length > 0,
    );
    if (candidates.length === 0) {
      setOperationMessage("当前没有需要补做人工核验的自动批准项。");
      return;
    }
    setBusy(true);
    setError("");
    const decisions = new Map<string, ReviewQueueItem>();
    const failures = new Map<string, string>();
    const batches = partitionReviewBatchItems(candidates);
    for (const [index, batch] of batches.entries()) {
      setOperationMessage(
        `正在人工确认第 ${index + 1}/${batches.length} 批自动批准记录，已完成 ${decisions.size} 条。`,
      );
      try {
        const verified = await adminApi.batchVerifyAutomation(
          token,
          batch.map((item) => ({
            id: item.id,
            expectedVersion: item.version,
            reason: "人工复核：已对照自动批准项的官方证据确认表述一致。",
          })),
        );
        for (const item of verified) decisions.set(item.id, item);
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : "人工核验失败";
        for (const item of batch) failures.set(item.id, message);
      }
    }
    setWorkspace((current) =>
      current
        ? {
            ...current,
            queue: current.queue.map((item) => decisions.get(item.id) ?? item),
          }
        : current,
    );
    setOperationMessage(`人工核验完成：成功 ${decisions.size} 条，失败 ${failures.size} 条。`);
    if (decisions.size > 0) {
      toast.success(`已人工确认 ${decisions.size} 条记录`, {
        description: "证据核验状态和正式数据质量指标已更新。",
        duration: 5_000,
      });
    }
    if (failures.size > 0) {
      toast.error(`${failures.size} 条自动批准记录核验失败`, {
        description: "失败批次仍保留为自动批准状态，可刷新后重试。",
        duration: 6_000,
      });
    }
    try {
      await refresh(token);
    } catch {
      setError("人工核验已完成，但最新工作区状态刷新失败；请稍后刷新页面。");
    } finally {
      setBusy(false);
    }
  };
  return {
    changePublicationState,
    decide,
    decideLifecycle,
    batchApproveCandidates,
    batchApproveRecentCandidates,
    batchMergeDeterministicDuplicates,
    batchRejectDeterministicallyInvalid,
    verifyAutomationApprovals,
  };
}
