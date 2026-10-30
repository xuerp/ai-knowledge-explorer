import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { mergeReviewQueue } from "@/domain/review-decision";

import { type ReviewLane } from "@/domain/review-lanes";

import {
  adminApi,
  type AdminUser,
  type ClaimEntityRepairReport,
  type DocumentSnapshotView,
  type GoldenQuestionReport,
  type RelationClaimRepairReport,
  type ReviewQueueItem,
} from "@/services/admin-api";
import { authSessionExpiredEvent, clearAuthToken, readAuthToken } from "@/services/auth-session";

import { catalogExamples } from "./catalog-examples";
import type { Workspace, CatalogRecordKind } from "./types";

export function useReviewState() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reasonCategories, setReasonCategories] = useState<Record<string, string>>({});
  const [reviewingIds, setReviewingIds] = useState<Set<string>>(() => new Set());
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  const [publicationReasons, setPublicationReasons] = useState<Record<string, string>>({});
  const [entityRepairReport, setEntityRepairReport] = useState<ClaimEntityRepairReport | null>(
    null,
  );
  const [relationRepairReport, setRelationRepairReport] =
    useState<RelationClaimRepairReport | null>(null);
  const [manualEntitySelections, setManualEntitySelections] = useState<Record<string, string>>({});
  const [manualEntityReasons, setManualEntityReasons] = useState<Record<string, string>>({});
  const [resolvingClaimIds, setResolvingClaimIds] = useState<Set<string>>(() => new Set());
  const [catalogKind, setCatalogKind] = useState<CatalogRecordKind>("entity");
  const [catalogJson, setCatalogJson] = useState(catalogExamples.entity);
  const [timelineEntityId, setTimelineEntityId] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [operationMessage, setOperationMessage] = useState("");
  const [recentExtraction, setRecentExtraction] = useState<{
    sourceTitle: string;
    candidateIds: string[];
  } | null>(null);
  const [operationsError, setOperationsError] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "needs-action" | "manual" | "allowlisted" | "automatic"
  >("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewLane>("all");
  const [sourceSnapshots, setSourceSnapshots] = useState<Record<string, DocumentSnapshotView[]>>(
    {},
  );
  const [goldenQuestionReport, setGoldenQuestionReport] = useState<GoldenQuestionReport | null>(
    null,
  );
  const [goldenQuestionsBusy, setGoldenQuestionsBusy] = useState(false);

  const refresh = useCallback(async (activeToken: string) => {
    const currentUser = await adminApi.me(activeToken);
    setUser(currentUser);
    const data = await adminApi.workspace(activeToken, currentUser.role);
    setWorkspace((current) =>
      current
        ? {
            ...data,
            queue: mergeReviewQueue(current.queue, data.queue),
            productionReadiness: data.productionReadiness ?? current.productionReadiness,
          }
        : data,
    );
  }, []);

  const addRevision = (created: ReviewQueueItem) => {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            queue: mergeReviewQueue(current.queue, [created]),
          }
        : current,
    );
    setReviewFilter("all");
    toast.success("修订已进入待审队列");
  };

  useEffect(() => {
    const stored = readAuthToken();
    if (!stored) {
      setSessionChecking(false);
      return;
    }
    setToken(stored);
    refresh(stored)
      .catch((reason: unknown) => {
        clearAuthToken();
        setToken("");
        setUser(null);
        setWorkspace(null);
        setError(reason instanceof Error ? reason.message : "Session validation failed.");
      })
      .finally(() => setSessionChecking(false));
  }, [refresh]);

  useEffect(() => {
    const handleExpiredSession = () => {
      setToken("");
      setUser(null);
      setWorkspace(null);
      setOperationMessage("");
      setError("登录已过期，请重新登录。");
    };
    window.addEventListener(authSessionExpiredEvent, handleExpiredSession);
    return () => window.removeEventListener(authSessionExpiredEvent, handleExpiredSession);
  }, []);

  useEffect(() => {
    if (!token || user?.role !== "admin") return;
    const refreshOperations = async () => {
      const [operationsResult, readinessResult] = await Promise.allSettled([
        adminApi.operations(token),
        adminApi.productionReadiness(token),
      ]);
      setWorkspace((current) => {
        if (!current) return current;
        return {
          ...current,
          operations:
            operationsResult.status === "fulfilled" ? operationsResult.value : current.operations,
          productionReadiness:
            readinessResult.status === "fulfilled"
              ? readinessResult.value
              : current.productionReadiness,
        };
      });
      const failure = [operationsResult, readinessResult].find(
        (result) => result.status === "rejected",
      );
      setOperationsError(
        failure?.status === "rejected"
          ? failure.reason instanceof Error
            ? failure.reason.message
            : "运行状态刷新失败。"
          : "",
      );
    };
    const timer = window.setInterval(refreshOperations, 60_000);
    return () => window.clearInterval(timer);
  }, [token, user?.role]);

  return {
    token,
    setToken,
    user,
    setUser,
    workspace,
    setWorkspace,
    sessionChecking,
    setSessionChecking,
    error,
    setError,
    busy,
    setBusy,
    reasons,
    setReasons,
    reasonCategories,
    setReasonCategories,
    reviewingIds,
    setReviewingIds,
    reviewErrors,
    setReviewErrors,
    publicationReasons,
    setPublicationReasons,
    entityRepairReport,
    setEntityRepairReport,
    relationRepairReport,
    setRelationRepairReport,
    manualEntitySelections,
    setManualEntitySelections,
    manualEntityReasons,
    setManualEntityReasons,
    resolvingClaimIds,
    setResolvingClaimIds,
    catalogKind,
    setCatalogKind,
    catalogJson,
    setCatalogJson,
    timelineEntityId,
    setTimelineEntityId,
    catalogMessage,
    setCatalogMessage,
    operationMessage,
    setOperationMessage,
    recentExtraction,
    setRecentExtraction,
    operationsError,
    setOperationsError,
    sourceSearch,
    setSourceSearch,
    sourceFilter,
    setSourceFilter,
    reviewFilter,
    setReviewFilter,
    sourceSnapshots,
    setSourceSnapshots,
    goldenQuestionReport,
    setGoldenQuestionReport,
    goldenQuestionsBusy,
    setGoldenQuestionsBusy,
    refresh,
    addRevision,
  };
}
export type ReviewState = ReturnType<typeof useReviewState>;
