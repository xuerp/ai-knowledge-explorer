import { Database, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { suggestedEntityId } from "@/domain/manual-candidate";

import {
  describeSourceAction,
  describeProbeFailure,
  isAllowlistedSource,
  isVettedRolloutSource,
} from "@/domain/source-rollout";

import { DataList } from "./shared";
import { isFuture, isRecentProbePassed } from "./review-status";
import { formatTime } from "@/lib/format";

import type { ReviewViewModel } from "./review-view-model";
export function SourcesPanel({ context }: { context: ReviewViewModel }) {
  const {
    allowlistedHosts,
    batchRolloutSources,
    busy,
    collectSource,
    createSource,
    extractSource,
    filteredSources,
    probeSource,
    retrySource,
    rolloutSources,
    saveSourceEntrypoints,
    setSourceFilter,
    setSourceSearch,
    sourceFilter,
    sourceSearch,
    sourceSnapshots,
    submitManualCandidate,
    toggleSnapshots,
    updateSource,
    workspace,
  } = context;
  return (
    <>
      <section className="grid items-start gap-5 lg:grid-cols-2">
        <section className="min-w-0 paper-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
                <Database className="h-4 w-4" />
                信源与采集策略
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                自动采集还需要在后端允许列表中配置对应域名；启用后会在下一次调度立即尝试采集。
              </p>
            </div>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
              {workspace.sources.filter((source) => source.fetchEnabled).length} 个自动采集
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-signal/20 bg-signal/5 p-3">
            <div>
              <div className="text-sm font-medium">批量安全接入</div>
              <p className="mt-1 text-xs text-muted-foreground">
                仅处理经过验证的官方机器入口；通过后自动启用并执行首次采集，失败会进入退避重试。
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || rolloutSources.length === 0}
              onClick={batchRolloutSources}
            >
              批量接入并首次采集（{rolloutSources.length}）
            </Button>
          </div>
          <details className="mt-4 rounded-lg border border-dashed border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">新增官方信源</summary>
            <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={createSource}>
              <Input
                name="sourceId"
                placeholder="唯一 ID，例如 s-openai-release"
                pattern="[a-z0-9][a-z0-9._-]+"
                minLength={3}
                required
              />
              <Input name="sourcePublisher" placeholder="发布机构" required minLength={2} />
              <Input name="sourceTitle" placeholder="信源标题" required minLength={3} />
              <Input name="sourceUrl" type="url" placeholder="https://..." required />
              <Input
                name="sourceFetchUrl"
                type="url"
                placeholder="可选：实际抓取 Markdown / JSON 地址"
              />
              <Textarea
                name="sourceFallbackUrls"
                placeholder="可选：备用官方入口，每行一个"
                rows={2}
              />
              <div className="sm:col-span-2 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  新信源默认仅登记，不会自动访问网络。
                </span>
                <Button size="sm" type="submit" disabled={busy}>
                  登记信源
                </Button>
              </div>
            </form>
          </details>
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              type="search"
              aria-label="搜索信源"
              placeholder="搜索标题、机构或网址，例如 MCP"
              value={sourceSearch}
              onChange={(event) => setSourceSearch(event.target.value)}
            />
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              aria-label="筛选信源"
              value={sourceFilter}
              onChange={(event) =>
                setSourceFilter(
                  event.target.value as
                    "all" | "needs-action" | "manual" | "allowlisted" | "automatic",
                )
              }
            >
              <option value="all">全部信源</option>
              <option value="needs-action">
                待处理熔断（
                {workspace.sources.filter((source) => source.healthState === "paused").length}）
              </option>
              <option value="manual">
                手动证据（
                {
                  workspace.sources.filter((source) => source.collectionStrategy === "manual")
                    .length
                }
                ）
              </option>
              <option value="allowlisted">可预检信源</option>
              <option value="automatic">自动采集信源</option>
            </select>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              显示 {filteredSources.length} / {workspace.sources.length} 个信源
            </span>
            <button
              type="button"
              className="text-signal hover:underline"
              onClick={() => {
                setSourceSearch("MCP");
                setSourceFilter("allowlisted");
              }}
            >
              定位建议首测信源：MCP
            </button>
            <button
              type="button"
              className="text-signal hover:underline"
              onClick={() => {
                setSourceSearch("LangChain");
                setSourceFilter("allowlisted");
              }}
            >
              定位建议第二信源：LangChain
            </button>
          </div>
          <div className="mt-4 max-h-[36rem] space-y-3 overflow-y-auto pr-1">
            {filteredSources.map((source) => (
              <article key={source.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{source.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {source.publisher} · {source.active ? "已启用" : "已停用"}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      source.healthState === "paused"
                        ? "bg-conflict/10 text-conflict"
                        : source.fetchEnabled
                          ? "bg-verified/10 text-verified"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {source.healthState === "paused"
                      ? "自动熔断"
                      : source.fetchEnabled
                        ? "自动采集"
                        : "手动采集"}
                  </span>
                  <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
                    {source.collectionStrategy === "automatic"
                      ? "自动入口已验证"
                      : source.collectionStrategy === "manual"
                        ? "仅人工采集"
                        : "入口待验证"}
                  </span>
                  {isVettedRolloutSource(source) &&
                    isAllowlistedSource(source, allowlistedHosts) && (
                      <span className="rounded-full bg-signal/10 px-2 py-1 text-xs text-signal">
                        可批量接入
                      </span>
                    )}
                </div>
                <a
                  className="mt-2 block truncate text-xs text-signal hover:underline"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.url}
                </a>
                {source.effectiveFetchUrl !== source.url && (
                  <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                    实际抓取：{source.effectiveFetchUrl}
                    {source.fallbackUrls.length > 0 &&
                      ` · ${source.fallbackUrls.length} 个备用入口`}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">{source.collectionReason}</p>
                <div className="mt-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
                  <span className="font-medium">建议处理：</span>
                  <span className="text-muted-foreground">{describeSourceAction(source)}</span>
                </div>
                {source.consecutiveFailures > 0 && (
                  <div className="mt-3 rounded-md border border-conflict/30 bg-conflict/5 p-3 text-xs">
                    <div className="font-medium text-conflict">
                      连续失败 {source.consecutiveFailures} 次
                      {source.autoPausedAt
                        ? "，永久性错误已触发自动熔断"
                        : "，系统正在按退避策略重试"}
                    </div>
                    {source.failureKind && (
                      <p className="mt-1 text-muted-foreground">失败分类：{source.failureKind}</p>
                    )}
                    {source.lastFetchError && (
                      <p className="mt-1 line-clamp-2 text-muted-foreground">
                        {source.lastFetchError}
                      </p>
                    )}
                  </div>
                )}
                {source.lastProbeStatus && (
                  <div
                    className={`mt-3 rounded-md border p-3 text-xs ${
                      source.lastProbeStatus === "passed"
                        ? "border-verified/30 bg-verified/5"
                        : "border-conflict/30 bg-conflict/5"
                    }`}
                  >
                    <div className="font-medium">
                      最近预检{source.lastProbeStatus === "passed" ? "通过" : "失败"} ·{" "}
                      {formatTime(source.lastProbeAt ?? "")}
                    </div>
                    {source.lastProbeStatus === "passed" ? (
                      <p className="mt-1 text-muted-foreground">
                        {source.lastProbeContentType} ·{" "}
                        {source.lastProbeReadableCharacters?.toLocaleString("zh-CN") ?? 0}{" "}
                        个可读字符
                      </p>
                    ) : (
                      <p className="mt-1 line-clamp-2 text-muted-foreground">
                        {describeProbeFailure(source.lastProbeError)}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    周期
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
                      aria-label={`${source.title} 采集周期`}
                      value={source.fetchIntervalMinutes}
                      disabled={busy || !source.active}
                      onChange={(event) =>
                        updateSource(source, {
                          fetchIntervalMinutes: Number(event.target.value),
                        })
                      }
                    >
                      <option value={120}>2 小时</option>
                      <option value={240}>4 小时</option>
                      <option value={360}>6 小时</option>
                      <option value={720}>12 小时</option>
                      <option value={1440}>24 小时</option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      !source.active ||
                      source.collectionStrategy === "manual" ||
                      (!source.fetchEnabled && !isRecentProbePassed(source))
                    }
                    title={
                      source.collectionStrategy === "manual"
                        ? source.collectionReason
                        : source.fetchEnabled || isRecentProbePassed(source)
                          ? undefined
                          : "请先完成连接预检；成功结果在 24 小时内有效"
                    }
                    onClick={() => updateSource(source, { fetchEnabled: !source.fetchEnabled })}
                  >
                    {source.fetchEnabled ? "暂停自动采集" : "启用自动采集"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !source.active || source.collectionStrategy === "manual"}
                    title={
                      source.collectionStrategy === "manual"
                        ? source.collectionReason
                        : "只检查网络策略、响应类型和可读内容，不保存快照"
                    }
                    onClick={() => probeSource(source)}
                  >
                    连接预检
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy ||
                      !source.active ||
                      !source.fetchEnabled ||
                      Boolean(source.autoPausedAt) ||
                      isFuture(source.fetchLeaseExpiresAt)
                    }
                    title="立即采集当前信源，不影响其他信源的调度"
                    onClick={() => collectSource(source)}
                  >
                    立即采集此信源
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !source.lastSeenAt}
                    onClick={() => toggleSnapshots(source)}
                  >
                    {sourceSnapshots[source.id] ? "收起快照" : "查看快照"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => updateSource(source, { active: !source.active })}
                  >
                    {source.active ? "停用信源" : "恢复信源"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy ||
                      source.consecutiveFailures === 0 ||
                      !source.fetchEnabled ||
                      isFuture(source.fetchLeaseExpiresAt)
                    }
                    title={
                      isFuture(source.fetchLeaseExpiresAt)
                        ? `当前采集租约到 ${formatTime(source.fetchLeaseExpiresAt ?? "")}`
                        : "将失败信源重新加入下一次采集队列"
                    }
                    onClick={() => retrySource(source)}
                  >
                    立即重新排队
                  </Button>
                  <details className="w-full rounded-md border border-dashed border-border p-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      更换实际抓取入口或备用入口
                    </summary>
                    <form
                      className="mt-2 grid gap-2"
                      onSubmit={(event) => saveSourceEntrypoints(event, source)}
                    >
                      <Input
                        name="fetchUrl"
                        type="url"
                        defaultValue={source.fetchUrl ?? ""}
                        placeholder="留空则抓取证据地址"
                      />
                      <Textarea
                        name="fallbackUrls"
                        defaultValue={source.fallbackUrls.join("\n")}
                        placeholder="备用官方入口，每行一个"
                        rows={2}
                      />
                      <Button type="submit" size="sm" variant="outline" disabled={busy}>
                        保存入口并重新预检
                      </Button>
                    </form>
                  </details>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy || !source.lastSeenAt || !workspace.integrations?.extractionConfigured
                    }
                    title={
                      !source.lastSeenAt
                        ? "先完成一次采集"
                        : workspace.integrations?.extractionConfigured
                          ? "使用已配置的 AI 从最近快照抽取候选事实"
                          : "AI 抽取供应商尚未配置；可在下方快照中创建人工候选"
                    }
                    onClick={() => extractSource(source)}
                  >
                    AI 抽取候选
                  </Button>
                </div>
                {sourceSnapshots[source.id] && (
                  <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                    {sourceSnapshots[source.id].length === 0 ? (
                      <p className="text-xs text-muted-foreground">尚无已保存快照。</p>
                    ) : (
                      sourceSnapshots[source.id].map((snapshot, index) => (
                        <details key={snapshot.id} open={index === 0}>
                          <summary className="cursor-pointer text-xs font-medium">
                            {index === 0 ? "最新快照" : `历史快照 ${index + 1}`} ·{" "}
                            {formatTime(snapshot.observedAt)} ·{" "}
                            {snapshot.readableCharacters.toLocaleString("zh-CN")} 字符
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-5 text-muted-foreground">
                            {snapshot.contentPreview}
                          </pre>
                          {index === 0 && (
                            <form
                              className="mt-3 space-y-3 rounded-md border border-border bg-background p-3"
                              onSubmit={(event) => submitManualCandidate(event, source, snapshot)}
                            >
                              <div>
                                <p className="text-sm font-medium">从此快照创建人工候选</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  对照上方原文填写一条可核验事实。提交后只进入审核队列，不会直接发布。
                                </p>
                              </div>
                              <Input
                                name="entityId"
                                defaultValue={suggestedEntityId(source.id)}
                                placeholder="关联实体 ID，例如 e-mcp"
                                aria-label="关联实体 ID"
                              />
                              <Textarea
                                name="claimZh"
                                required
                                minLength={8}
                                placeholder="中文事实（至少 8 个字符）"
                                aria-label="中文事实"
                              />
                              <Textarea
                                name="claimEn"
                                required
                                minLength={8}
                                placeholder="英文事实（至少 8 个字符）"
                                aria-label="英文事实"
                              />
                              <Button type="submit" size="sm" disabled={busy}>
                                提交到审核队列
                              </Button>
                            </form>
                          )}
                        </details>
                      ))
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
        <DataList
          title="最近审计"
          icon={<ShieldCheck className="h-4 w-4" />}
          rows={workspace.audit.slice(0, 12).map((entry) => ({
            key: String(entry.id),
            title: entry.action,
            detail: `${entry.actor} · ${entry.targetType}/${entry.targetId}`,
          }))}
        />
      </section>
    </>
  );
}
