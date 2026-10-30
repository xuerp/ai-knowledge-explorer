import { toast } from "sonner";

import { adminApi, type ClaimEntityAuditReport } from "@/services/admin-api";

import type { ReviewState } from "./useReviewState";
export function createAuditActions(state: ReviewState) {
  const {
    entityRepairReport,
    manualEntityReasons,
    manualEntitySelections,
    refresh,
    relationRepairReport,
    setBusy,
    setEntityRepairReport,
    setError,
    setManualEntityReasons,
    setManualEntitySelections,
    setOperationMessage,
    setRelationRepairReport,
    setResolvingClaimIds,
    token,
    user,
  } = state;
  const runEntityRepair = async (mode: "dry-run" | "apply") => {
    if (user?.role !== "admin") return;
    const claimIds =
      mode === "apply"
        ? (entityRepairReport?.items
            .filter((item) => item.status === "repairable")
            .map((item) => item.claimId) ?? [])
        : [];
    if (mode === "apply" && claimIds.length === 0) {
      setError("没有可以确定性回填的 Claim。");
      return;
    }
    if (
      mode === "apply" &&
      !window.confirm(
        "确认回填 " + claimIds.length + " 条确定性实体关联？操作会写入审计与发布历史。",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const report = await adminApi.claimEntityRepair(token, mode, claimIds);
      setEntityRepairReport(report);
      setOperationMessage(
        mode === "dry-run"
          ? "实体关联 Dry Run 完成：" + report.repairableCount + " 条可确定性回填。"
          : "已回填 " + report.repairedCount + " 条实体关联，并记录审计与发布历史。",
      );
      if (mode === "apply") await refresh(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "实体关联处理失败。");
    } finally {
      setBusy(false);
    }
  };

  const runRelationRepair = async (mode: "dry-run" | "apply") => {
    if (user?.role !== "admin") return;
    const claimIds =
      mode === "apply"
        ? (relationRepairReport?.items
            .filter((item) => item.status === "repairable")
            .map((item) => item.claimId) ?? [])
        : [];
    if (mode === "apply" && claimIds.length === 0) {
      setError("没有可以确定性补建或合并 Evidence 的历史关系 Claim。");
      return;
    }
    if (
      mode === "apply" &&
      !window.confirm(
        "确认根据 " +
          claimIds.length +
          " 条历史已审核 Claim 修复图谱关系？操作会写入关系表和审计日志。",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const report = await adminApi.relationClaimRepair(token, mode, claimIds);
      setRelationRepairReport(report);
      setOperationMessage(
        mode === "dry-run"
          ? "历史关系 Dry Run 完成：" + report.repairableCount + " 条可确定性修复。"
          : "已修复 " + report.repairedCount + " 条历史关系，并记录审计日志。",
      );
      if (mode === "apply") await refresh(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "历史关系处理失败。");
    } finally {
      setBusy(false);
    }
  };

  const resolveUnlinkedClaim = async (
    item: ClaimEntityAuditReport["items"][number],
    action: "assign" | "retract",
  ) => {
    if (user?.role !== "admin") return;
    if (!item.reviewJobId || item.version === null || item.version === undefined) {
      setError("这条历史事实没有可写审核记录，需先通过数据迁移修正种子目录。");
      return;
    }
    const entityId = (
      manualEntitySelections[item.claimId] ??
      item.recommendedEntityId ??
      ""
    ).trim();
    const reason = (manualEntityReasons[item.claimId] ?? item.recommendationReason ?? "").trim();
    if (action === "assign" && !entityId) {
      setError("请先为这条事实选择目标实体。");
      return;
    }
    if (reason.length < 8) {
      setError("请填写至少 8 个字符的处理理由，便于后续审计。");
      return;
    }
    if (
      action === "retract" &&
      !window.confirm("确认将这条未关联事实判定为抽取噪声并从公开数据撤回？")
    ) {
      return;
    }
    setResolvingClaimIds((current) => new Set(current).add(item.claimId));
    setError("");
    try {
      const result = await adminApi.claimEntityResolution(token, {
        claimId: item.claimId,
        action,
        ...(action === "assign" ? { entityId } : {}),
        expectedVersion: item.version,
        reason,
      });
      setOperationMessage(
        action === "assign"
          ? `已将 ${result.claimId} 关联到 ${result.entityId}，并记录发布历史。`
          : `已撤回抽取噪声 ${result.claimId}，公开知识库将不再展示。`,
      );
      toast.success(action === "assign" ? "实体关联已保存" : "抽取噪声已撤回");
      setManualEntitySelections((current) => {
        const next = { ...current };
        delete next[item.claimId];
        return next;
      });
      setManualEntityReasons((current) => {
        const next = { ...current };
        delete next[item.claimId];
        return next;
      });
      await refresh(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "历史事实处理失败。");
    } finally {
      setResolvingClaimIds((current) => {
        const next = new Set(current);
        next.delete(item.claimId);
        return next;
      });
    }
  };
  return { runEntityRepair, runRelationRepair, resolveUnlinkedClaim };
}
