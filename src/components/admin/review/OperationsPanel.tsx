import { Activity } from "lucide-react";

import { Button } from "@/components/ui/button";

import { type OperationsDiagnostics, type OutboxEntry } from "@/services/admin-api";

import { DiagnosticCard, QueueMetric, StatusBadge } from "./shared";
import { statusLabel, workerStateLabel } from "./review-status";
import { asRecord, numberValue, stringValue, formatTime, formatDuration } from "@/lib/format";

export function OperationsPanel({
  operations,
  refreshError,
  outbox,
  busy,
  onRetryOutbox,
}: {
  operations: OperationsDiagnostics | null;
  refreshError: string;
  outbox: OutboxEntry[];
  busy: boolean;
  onRetryOutbox: (entry: OutboxEntry) => void;
}) {
  if (!operations) {
    return (
      <section className="paper-card border-unverified/30 p-5">
        <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
          <Activity className="h-5 w-5 text-unverified" />
          自动任务诊断
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          运行状态暂时无法读取。不会因此退出登录；请稍后刷新，或确认数据库迁移已经完成。
        </p>
      </section>
    );
  }

  const worker = operations.worker;
  const latest = operations.recentRuns[0];
  const ingestion = asRecord(latest?.result?.ingestion);
  const extraction = asRecord(latest?.result?.extraction);
  const extractionPipelineVersion =
    typeof extraction?.pipelineVersion === "string"
      ? extraction.pipelineVersion
      : "旧版或未记录管线";
  const extractionErrors = Array.isArray(extraction?.errors)
    ? extraction.errors
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value !== null)
    : [];
  const digests = asRecord(latest?.result?.digests);
  const delivery = asRecord(latest?.result?.emailDelivery);
  const pendingOutbox = outbox
    .filter(
      (entry) =>
        entry.status === "failed" || entry.status === "retrying" || entry.status === "sending",
    )
    .slice(0, 6);
  const heartbeatLabel =
    operations.heartbeatStatus === "healthy"
      ? worker?.state === "failed"
        ? "Worker 失败（心跳正常）"
        : "心跳正常"
      : operations.heartbeatStatus === "stale"
        ? "心跳延迟"
        : "尚未收到心跳";

  return (
    <section className="paper-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
            <Activity className="h-5 w-5 text-signal" />
            自动任务诊断
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            心跳、最近周期和重试队列均来自持久化运行记录；错误信息已在服务端截断。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            状态生成于 {formatTime(operations.generatedAt)}，页面每 60 秒自动刷新。
          </p>
          {refreshError && (
            <p className="mt-2 text-xs text-unverified">
              最近一次刷新失败，当前保留上次结果：{refreshError}
            </p>
          )}
        </div>
        <StatusBadge
          label={heartbeatLabel}
          status={
            operations.heartbeatStatus === "healthy"
              ? worker?.state === "failed"
                ? "failed"
                : worker?.state === "running"
                  ? "running"
                  : "succeeded"
              : operations.heartbeatStatus === "stale"
                ? "partial"
                : "idle"
          }
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <DiagnosticCard title="Worker">
          {worker ? (
            <>
              <div className="text-sm font-medium">
                {worker.workerId} · {workerStateLabel(worker.state)}
              </div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                最近心跳：{formatTime(worker.heartbeatAt)}（{worker.heartbeatAgeSeconds} 秒前）
                <br />
                下次周期：{worker.nextCycleAt ? formatTime(worker.nextCycleAt) : "正在运行或未计划"}
              </div>
              {worker.lastError && (
                <p className="mt-2 line-clamp-3 text-xs text-conflict">{worker.lastError}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">worker 尚未写入首个心跳。</p>
          )}
        </DiagnosticCard>

        <DiagnosticCard title="重试与积压">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <QueueMetric label="自动信源" value={operations.queues.automaticSources} />
            <QueueMetric label="当前到期" value={operations.queues.sourcesDue} />
            <QueueMetric label="采集重试" value={operations.queues.sourcesRetrying} />
            <QueueMetric label="采集熔断" value={operations.queues.sourcesPaused} />
            <QueueMetric label="待抽取" value={operations.queues.extractionReady} />
            <QueueMetric label="抽取冷却" value={operations.queues.extractionRetrying} />
            <QueueMetric label="邮件待发" value={operations.queues.emailQueued} />
            <QueueMetric label="邮件重试" value={operations.queues.emailRetrying} />
            <QueueMetric label="邮件发送中" value={operations.queues.emailSending} />
            <QueueMetric label="邮件终态失败" value={operations.queues.emailFailed} />
          </div>
        </DiagnosticCard>

        <DiagnosticCard title="最近运行周期">
          {latest ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <StatusBadge label={statusLabel(latest.status)} status={latest.status} />
                <span className="text-xs text-muted-foreground">
                  {formatDuration(latest.durationMs)}
                </span>
              </div>
              {latest.result ? (
                <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
                  <div>
                    采集：到期 {numberValue(ingestion, "due")} · 成功{" "}
                    {numberValue(ingestion, "succeeded")} · 失败 {numberValue(ingestion, "failed")}
                  </div>
                  <div>
                    抽取：{extractionPipelineVersion} · 计划 {numberValue(extraction, "planned")} ·
                    完成 {numberValue(extraction, "processed")} · 候选{" "}
                    {numberValue(extraction, "candidatesCreated")} · 合并/跳过重复{" "}
                    {numberValue(extraction, "duplicatesSkipped")} · 自动批准{" "}
                    {numberValue(extraction, "relationsAutoApproved")} · 失败{" "}
                    {numberValue(extraction, "failed")}
                  </div>
                  {extractionErrors.map((failure, index) => (
                    <div key={`${String(failure.sourceId)}-${index}`} className="text-conflict">
                      抽取失败：{stringValue(failure, "sourceId", "未知信源")} ·{" "}
                      {stringValue(failure, "error", "未记录原因")}
                    </div>
                  ))}
                  <div>
                    摘要：收件人 {numberValue(digests, "recipients")} · 新增邮件{" "}
                    {numberValue(digests, "messagesQueued")}
                  </div>
                  <div>
                    投递：尝试 {numberValue(delivery, "attempted")} · 成功{" "}
                    {numberValue(delivery, "sent")} · 失败 {numberValue(delivery, "failed")}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {latest.status === "running"
                    ? "周期正在运行，暂无汇总。"
                    : "本周期没有可用汇总。"}
                </p>
              )}
              {latest.error && (
                <p className="mt-2 line-clamp-3 text-xs text-conflict">{latest.error}</p>
              )}
              <div className="mt-2 text-xs text-muted-foreground">
                {formatTime(latest.startedAt)}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">尚无自动周期记录。</p>
          )}
        </DiagnosticCard>
      </div>

      {operations.recentRuns.length > 0 && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium">最近周期</h3>
          <div className="mt-2 divide-y divide-border">
            {operations.recentRuns.slice(0, 5).map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-mono text-xs">{run.id}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatTime(run.startedAt)} · {run.trigger === "scheduled" ? "自动" : "手动"} ·{" "}
                    {formatDuration(run.durationMs)}
                  </div>
                </div>
                <StatusBadge label={statusLabel(run.status)} status={run.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingOutbox.length > 0 && (
        <div className="mt-4 rounded-lg border border-conflict/20 p-4">
          <h3 className="text-sm font-medium">邮件重试明细</h3>
          <div className="mt-2 divide-y divide-border">
            {pendingOutbox.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{entry.subject}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {entry.status === "retrying"
                      ? `第 ${entry.attemptCount} 次失败 · 下次 ${entry.nextAttemptAt ? formatTime(entry.nextAttemptAt) : "待调度"}`
                      : entry.status === "sending"
                        ? `第 ${entry.attemptCount} 次投递进行中 · 租约至 ${entry.deliveryLeaseExpiresAt ? formatTime(entry.deliveryLeaseExpiresAt) : "待恢复"}`
                        : `已达到自动重试上限 · 共尝试 ${entry.attemptCount} 次`}
                  </div>
                  {entry.error && (
                    <p className="mt-1 line-clamp-2 text-xs text-conflict">{entry.error}</p>
                  )}
                </div>
                {entry.status === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRetryOutbox(entry)}
                  >
                    重新排队
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
