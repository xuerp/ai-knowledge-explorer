import { toast } from "sonner";

import { adminApi, type OutboxEntry } from "@/services/admin-api";

import type { ReviewState } from "./useReviewState";
export function createOperationsActions(state: ReviewState) {
  const {
    goldenQuestionsBusy,
    refresh,
    setBusy,
    setError,
    setGoldenQuestionReport,
    setGoldenQuestionsBusy,
    setOperationMessage,
    token,
  } = state;
  const run = async (kind: "ingestion" | "digest" | "delivery") => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      if (kind === "ingestion") {
        const result = await adminApi.runIngestion(token);
        setOperationMessage(
          `采集完成：到期 ${result.due}，成功 ${result.succeeded}，未变化 ${result.unchanged}，失败 ${result.failed}。`,
        );
      } else if (kind === "digest") {
        const result = await adminApi.runDigest(token);
        setOperationMessage(
          `摘要生成完成：${result.recipients} 位收件人，${result.messagesQueued} 封邮件进入 Outbox。`,
        );
      } else {
        const result = await adminApi.sendOutbox(token);
        setOperationMessage(
          `投递完成：尝试 ${result.attempted}，成功 ${result.sent}，失败 ${result.failed}。`,
        );
      }
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const probeExtraction = async () => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      const result = await adminApi.probeExtraction(token);
      const target = [result.model, result.endpointHost].filter(Boolean).join(" · ");
      if (result.passed) {
        setOperationMessage(
          `AI 抽取预检通过：${target}，耗时 ${result.latencyMs} 毫秒。现在可以从已采集快照生成候选。`,
        );
      } else {
        setError(
          `AI 抽取连接验证未通过（${result.errorCode ?? "unknown"}）${target ? ` · ${target}` : ""}：${result.detail}`,
        );
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "AI 抽取连接预检失败。");
    } finally {
      setBusy(false);
    }
  };

  const retryOutbox = async (entry: OutboxEntry) => {
    if (!window.confirm(`确认重新排队邮件“${entry.subject}”？系统不会重发已成功的邮件。`)) {
      return;
    }
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      await adminApi.retryOutbox(token, entry.id, entry.attemptCount);
      setOperationMessage(`邮件“${entry.subject}”已重新排队，将由 worker 按退避策略投递。`);
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Outbox retry failed.");
    } finally {
      setBusy(false);
    }
  };

  const runGoldenQuestions = async () => {
    if (!token || goldenQuestionsBusy) return;
    setGoldenQuestionsBusy(true);
    try {
      const report = await adminApi.goldenQuestions(token);
      setGoldenQuestionReport(report);
      toast.success("完整 RAG Golden 评测已完成", {
        description: `${report.passed}/${report.total} 个问题证据可回答，检索通过率 ${Math.round((report.retrievalPassRatio ?? 0) * 100)}%。`,
      });
    } catch (failure) {
      toast.error("完整 RAG Golden 评测失败", {
        description: failure instanceof Error ? failure.message : "请稍后重试。",
        duration: 8_000,
      });
    } finally {
      setGoldenQuestionsBusy(false);
    }
  };
  return { run, probeExtraction, retryOutbox, runGoldenQuestions };
}
