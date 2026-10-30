import { type FormEvent } from "react";

import { buildManualCandidate } from "@/domain/manual-candidate";

import {
  describeProbeFailure,
  formatRolloutSummary,
  selectRolloutSources,
  type RolloutOutcome,
} from "@/domain/source-rollout";

import {
  adminApi,
  type DocumentSnapshotView,
  type ReviewQueueItem,
  type SourceView,
} from "@/services/admin-api";

import type { ReviewState } from "./useReviewState";
export function createSourcesActions(state: ReviewState) {
  const {
    refresh,
    setBusy,
    setError,
    setOperationMessage,
    setRecentExtraction,
    setSourceSnapshots,
    setWorkspace,
    sourceSnapshots,
    token,
    workspace,
  } = state;
  const updateSource = async (
    source: SourceView,
    changes: Partial<Pick<SourceView, "active" | "fetchEnabled" | "fetchIntervalMinutes">>,
  ) => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      await adminApi.updateSource(token, source.id, changes);
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Source update failed.");
    } finally {
      setBusy(false);
    }
  };

  const retrySource = async (source: SourceView) => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      await adminApi.retrySource(token, source.id, source.consecutiveFailures);
      setOperationMessage(`${source.title} 已重新加入下一次采集队列。`);
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Source retry failed.");
    } finally {
      setBusy(false);
    }
  };

  const probeSource = async (source: SourceView) => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      const result = await adminApi.probeSource(token, source.id);
      setOperationMessage(
        `${source.title} 连接预检通过：${result.contentType}，读取到 ${result.readableCharacters.toLocaleString("zh-CN")} 个字符。现在可以安全地启用自动采集。`,
      );
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "信源连接预检失败。");
    } finally {
      setBusy(false);
    }
  };

  const collectSource = async (source: SourceView) => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      const result = await adminApi.collectSource(token, source.id);
      setOperationMessage(
        `${source.title} 采集完成：成功 ${result.succeeded}，未变化 ${result.unchanged}，失败 ${result.failed}。`,
      );
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "单信源采集失败。");
      await refresh(token);
    } finally {
      setBusy(false);
    }
  };

  const batchRolloutSources = async () => {
    if (!workspace?.integrations) return;
    const candidates = selectRolloutSources(
      workspace.sources,
      workspace.integrations.fetchAllowedHosts,
    );
    if (candidates.length === 0) {
      setOperationMessage("当前没有等待接入的白名单信源。");
      return;
    }

    setBusy(true);
    setError("");
    setOperationMessage("");
    const outcomes: RolloutOutcome[] = [];
    // 免费 staging 只有一个较小的 API 实例。逐个预检可以避免同时连接多个官网时
    // 耗尽连接池，也能降低被上游站点临时限流的概率。
    for (const [index, source] of candidates.entries()) {
      setOperationMessage(
        `正在安全接入第 ${index + 1}/${candidates.length} 个信源：${source.title}。请保持当前页面打开。`,
      );
      try {
        await adminApi.probeSource(token, source.id);
        await adminApi.updateSource(token, source.id, { fetchEnabled: true });
        try {
          const collection = await adminApi.collectSource(token, source.id);
          outcomes.push({
            source,
            enabled: true,
            firstCollection: collection.failed > 0 ? "scheduled" : "completed",
            reason:
              collection.failed > 0 ? "首次采集失败，系统已按退避策略安排自动重试。" : undefined,
          });
        } catch (failure) {
          const reason = failure instanceof Error ? failure.message : "首次采集未完成";
          outcomes.push({
            source,
            enabled: true,
            firstCollection: /already being collected|正在采集/i.test(reason)
              ? "running"
              : "scheduled",
            reason,
          });
        }
      } catch (failure) {
        outcomes.push({
          source,
          enabled: false,
          reason: describeProbeFailure(failure instanceof Error ? failure.message : "连接预检失败"),
        });
      }
    }
    setOperationMessage(formatRolloutSummary(outcomes));
    try {
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "批量接入后刷新失败。");
    } finally {
      setBusy(false);
    }
  };

  const toggleSnapshots = async (source: SourceView) => {
    if (sourceSnapshots[source.id]) {
      setSourceSnapshots((current) => {
        const next = { ...current };
        delete next[source.id];
        return next;
      });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const snapshots = await adminApi.sourceSnapshots(token, source.id);
      setSourceSnapshots((current) => ({ ...current, [source.id]: snapshots }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "读取信源快照失败。");
    } finally {
      setBusy(false);
    }
  };

  const extractSource = async (source: SourceView) => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      const created = await adminApi.extractSource(token, source.id);
      const candidateIds = created.map((item) => item.id);
      setRecentExtraction({ sourceTitle: source.title, candidateIds });
      setWorkspace((current) => {
        if (!current) return current;
        const createdIds = new Set(candidateIds);
        return {
          ...current,
          queue: [...created, ...current.queue.filter((item) => !createdIds.has(item.id))],
        };
      });
      setOperationMessage(
        `${source.title} 已生成 ${created.length} 条候选事实；本次候选已在下方置顶并用蓝色边框标出。`,
      );
      await refresh(token);
      window.requestAnimationFrame(() => {
        document.getElementById("review-queue")?.scrollIntoView({ behavior: "smooth" });
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Candidate extraction failed.");
    } finally {
      setBusy(false);
    }
  };

  const batchExtractCandidates = async () => {
    if (!workspace || workspace.extractionPlan.length === 0) {
      setOperationMessage("当前没有等待抽取的新快照。");
      return;
    }
    const plan = workspace.extractionPlan.slice(0, 10);
    setBusy(true);
    setError("");
    setOperationMessage("");
    const created: ReviewQueueItem[] = [];
    const failures: string[] = [];
    for (const [index, item] of plan.entries()) {
      setOperationMessage(
        `正在批量抽取 ${index + 1}/${plan.length}：${item.sourceTitle}。已生成 ${created.length} 条候选。`,
      );
      try {
        created.push(...(await adminApi.extractSource(token, item.sourceId, 5, item.snapshotId)));
      } catch (failure) {
        failures.push(
          `${item.sourceTitle}：${failure instanceof Error ? failure.message : "抽取失败"}`,
        );
      }
    }
    const candidateIds = created.map((item) => item.id);
    if (candidateIds.length > 0) {
      setRecentExtraction({
        sourceTitle: `批量抽取 ${plan.length} 个信源`,
        candidateIds,
      });
      setWorkspace((current) => {
        if (!current) return current;
        const createdIds = new Set(candidateIds);
        return {
          ...current,
          queue: [...created, ...current.queue.filter((item) => !createdIds.has(item.id))],
          extractionPlan: current.extractionPlan.filter(
            (item) => !plan.some((planned) => planned.snapshotId === item.snapshotId),
          ),
        };
      });
    }
    setOperationMessage(
      `批量抽取完成：处理 ${plan.length} 个新快照，生成 ${created.length} 条候选，失败 ${failures.length} 个。${
        failures.length > 0 ? ` 失败项：${failures.join("；")}` : ""
      }`,
    );
    try {
      await refresh(token);
      if (candidateIds.length > 0) {
        window.requestAnimationFrame(() => {
          document.getElementById("review-queue")?.scrollIntoView({ behavior: "smooth" });
        });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "批量抽取后刷新失败。");
    } finally {
      setBusy(false);
    }
  };

  const submitManualCandidate = async (
    event: FormEvent<HTMLFormElement>,
    source: SourceView,
    snapshot: DocumentSnapshotView,
  ) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      const candidate = buildManualCandidate(source, snapshot, {
        entityId: String(form.get("entityId") ?? ""),
        claimZh: String(form.get("claimZh") ?? ""),
        claimEn: String(form.get("claimEn") ?? ""),
      });
      const created = await adminApi.submitCandidate(token, candidate);
      setOperationMessage(
        `${source.title} 的人工候选已进入审核队列（${created.id}），审核通过前不会出现在公开数据中。`,
      );
      formElement.reset();
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "人工候选提交失败。");
    } finally {
      setBusy(false);
    }
  };

  const createSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      const created = await adminApi.createSource(token, {
        id: String(form.get("sourceId")).trim(),
        title: String(form.get("sourceTitle")).trim(),
        publisher: String(form.get("sourcePublisher")).trim(),
        url: String(form.get("sourceUrl")).trim(),
        fetchUrl: String(form.get("sourceFetchUrl") ?? "").trim() || undefined,
        fallbackUrls: String(form.get("sourceFallbackUrls") ?? "")
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setOperationMessage(`${created.title} 已登记；请核验域名后再启用自动采集。`);
      formElement.reset();
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Source creation failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveSourceEntrypoints = async (event: FormEvent<HTMLFormElement>, source: SourceView) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const fetchUrl = String(form.get("fetchUrl") ?? "").trim();
      const fallbackUrls = String(form.get("fallbackUrls") ?? "")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
      await adminApi.updateSource(token, source.id, {
        fetchUrl: fetchUrl || null,
        fallbackUrls,
      });
      setOperationMessage(`${source.title} 的抓取入口已更新；自动采集已暂停，请重新预检后启用。`);
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "抓取入口更新失败。");
    } finally {
      setBusy(false);
    }
  };
  return {
    updateSource,
    retrySource,
    probeSource,
    collectSource,
    batchRolloutSources,
    toggleSnapshots,
    extractSource,
    batchExtractCandidates,
    submitManualCandidate,
    createSource,
    saveSourceEntrypoints,
  };
}
