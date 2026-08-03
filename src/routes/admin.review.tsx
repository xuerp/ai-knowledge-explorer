import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Braces, Check, Database, LogOut, Mail, RefreshCw, ShieldCheck, X } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Entity, GraphEdge, TimelineEntry } from "@/domain/types";
import {
  adminApi,
  type AdminUser,
  type AuditEntry,
  type DataQualityReport,
  type IngestionRun,
  type OutboxEntry,
  type ReviewQueueItem,
  type SourceView,
} from "@/services/admin-api";
import { clearAuthToken, readAuthToken, writeAuthToken } from "@/services/auth-session";

export const Route = createFileRoute("/admin/review")({
  head: () => ({
    meta: [
      { title: "Review workspace · AI Radar" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminReviewPage,
});

type Workspace = {
  queue: ReviewQueueItem[];
  sources: SourceView[];
  runs: IngestionRun[];
  audit: AuditEntry[];
  outbox: OutboxEntry[];
  quality: DataQualityReport | null;
};

type CatalogRecordKind = "entity" | "relation" | "timeline";

const catalogExamples: Record<CatalogRecordKind, string> = {
  entity: JSON.stringify(
    {
      id: "e-model-version",
      type: "model",
      slug: "model-version",
      name: { zh: "模型具体版本", en: "Concrete model version" },
      summary: { zh: "填写经过核验的版本摘要。", en: "Verified release summary." },
      vendor: "Vendor",
      origin: { zh: "海外", en: "Overseas" },
      status: "active",
      tags: ["大模型", "具体版本"],
      firstReleasedAt: "2026-07-29",
      lastUpdatedAt: "2026-07-29",
      familyId: "e-model-family",
      specs: {
        contextWindow: "128K tokens",
        inputPrice: "待核验",
        outputPrice: "待核验",
        modalities: "文本",
        toolUse: "待核验",
        availability: "API",
      },
      knowledge: {
        introduction: [
          {
            zh: "用两到三段说明它是什么、解决什么问题，以及它在生态中的位置。",
            en: "Explain what it is, what problem it solves, and where it sits in the ecosystem.",
          },
        ],
        significance: {
          zh: "说明为什么值得收录与关注。",
          en: "Explain why this entity matters.",
        },
        keyPoints: [
          {
            title: { zh: "关键事实", en: "Key fact" },
            description: { zh: "填写可核验事实。", en: "Add a verifiable fact." },
            sourceIds: ["replace-with-existing-evidence-id"],
          },
        ],
        useCases: [
          {
            title: { zh: "典型用途", en: "Use case" },
            description: { zh: "说明如何实际使用或理解。", en: "Explain practical use." },
          },
        ],
        limitations: [
          {
            zh: "说明使用边界、局限或易误解之处。",
            en: "Describe limitations or common misinterpretations.",
          },
        ],
        officialUrl: "https://example.com/",
      },
    },
    null,
    2,
  ),
  relation: JSON.stringify(
    {
      id: "edge-version-family",
      fromId: "e-model-version",
      toId: "e-model-family",
      kind: "part-of",
      label: { zh: "属于系列", en: "Part of family" },
      confidence: "verified",
      sourceIds: ["replace-with-existing-evidence-id"],
      validFrom: "2026-07-29",
    },
    null,
    2,
  ),
  timeline: JSON.stringify(
    {
      id: "timeline-model-version-release",
      date: "2026-07-29",
      title: { zh: "具体版本发布", en: "Concrete version released" },
      summary: {
        zh: "填写功能、价格与可用性变化。",
        en: "Describe capability and pricing changes.",
      },
      kind: "release",
      sourceIds: ["replace-with-existing-evidence-id"],
      confidence: "verified",
    },
    null,
    2,
  ),
};

function AdminReviewPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [catalogKind, setCatalogKind] = useState<CatalogRecordKind>("entity");
  const [catalogJson, setCatalogJson] = useState(catalogExamples.entity);
  const [timelineEntityId, setTimelineEntityId] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [operationMessage, setOperationMessage] = useState("");

  const refresh = useCallback(async (activeToken: string) => {
    const currentUser = await adminApi.me(activeToken);
    const data = await adminApi.workspace(activeToken, currentUser.role);
    setUser(currentUser);
    setWorkspace(data);
  }, []);

  useEffect(() => {
    const stored = readAuthToken();
    if (!stored) return;
    setToken(stored);
    refresh(stored).catch((reason: unknown) => {
      clearAuthToken();
      setToken("");
      setError(reason instanceof Error ? reason.message : "Session validation failed.");
    });
  }, [refresh]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await adminApi.login(
        String(form.get("email")),
        String(form.get("password")),
      );
      if (response.user.role === "viewer") {
        throw new Error("This account does not have reviewer access.");
      }
      writeAuthToken(response.accessToken);
      setToken(response.accessToken);
      await refresh(response.accessToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (item: ReviewQueueItem, action: "approve" | "reject") => {
    const reason = reasons[item.id]?.trim();
    if (!reason || reason.length < 3) {
      setError("请先填写至少 3 个字符的审核理由。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminApi.decide(token, item.id, action, item.version, reason);
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Review action failed.");
    } finally {
      setBusy(false);
    }
  };

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

  const extractSource = async (source: SourceView) => {
    setBusy(true);
    setError("");
    setOperationMessage("");
    try {
      const created = await adminApi.extractSource(token, source.id);
      setOperationMessage(
        `${source.title} 已生成 ${created.length} 条候选事实，请在“候选队列”中进行人工审核。`,
      );
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Candidate extraction failed.");
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

  const switchCatalogKind = (kind: CatalogRecordKind) => {
    setCatalogKind(kind);
    setCatalogJson(catalogExamples[kind]);
    setCatalogMessage("");
  };

  const saveCatalogRecord = async () => {
    setBusy(true);
    setError("");
    setCatalogMessage("");
    try {
      const payload = JSON.parse(catalogJson) as unknown;
      if (catalogKind === "entity") {
        const saved = await adminApi.upsertEntity(token, payload as Entity);
        setCatalogMessage(`已保存实体 ${saved.id}；公开目录会立即读取该记录。`);
      } else if (catalogKind === "relation") {
        const saved = await adminApi.upsertRelation(token, payload as GraphEdge);
        setCatalogMessage(`已保存关系 ${saved.id}。`);
      } else {
        if (!timelineEntityId.trim()) throw new Error("请填写时间线所属的实体 ID。");
        const saved = await adminApi.upsertTimeline(
          token,
          timelineEntityId.trim(),
          payload as TimelineEntry,
        );
        setCatalogMessage(`已保存时间线事件 ${saved.id}。`);
      }
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Catalog update failed.");
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearAuthToken();
    setToken("");
    setUser(null);
    setWorkspace(null);
  };

  if (!adminApi.configured) {
    return (
      <AppShell>
        <Notice
          title="真实管理后台尚未连接 API"
          detail="在前端环境设置 VITE_API_BASE_URL（例如 http://127.0.0.1:8000），重新启动后即可登录。只读演示页仍可使用。"
        />
      </AppShell>
    );
  }

  if (!user || !workspace) {
    return (
      <AppShell>
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md items-center px-4">
          <form className="paper-card w-full space-y-5 p-6" onSubmit={login}>
            <div>
              <div className="flex items-center gap-2 text-signal">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-xs font-medium uppercase tracking-widest">
                  Protected workspace
                </span>
              </div>
              <h1 className="mt-2 font-serif text-3xl font-semibold">审核后台登录</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                使用 reviewer 或 admin 账户。令牌仅保存在当前浏览器标签的 sessionStorage。
              </p>
            </div>
            <Input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="admin@example.com"
              required
            />
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="密码"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy}>
              {busy ? "正在登录…" : "登录"}
            </Button>
          </form>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl space-y-7 px-4 py-8 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-signal">
              Live API
            </div>
            <h1 className="mt-1 font-serif text-3xl font-semibold">真实审核工作台</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {user.email} · {user.role}
            </p>
          </div>
          <div className="flex gap-2">
            {user.role === "admin" && (
              <>
                <Button variant="outline" onClick={() => run("ingestion")} disabled={busy}>
                  <RefreshCw />
                  运行采集
                </Button>
                <Button variant="outline" onClick={() => run("digest")} disabled={busy}>
                  <Mail />
                  生成摘要
                </Button>
                <Button variant="outline" onClick={() => run("delivery")} disabled={busy}>
                  <Mail />
                  投递 Outbox
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={logout}>
              <LogOut />
              退出
            </Button>
          </div>
        </header>
        {error && <Notice title="操作未完成" detail={error} destructive />}
        {operationMessage && <Notice title="操作已完成" detail={operationMessage} />}

        <section className="grid gap-3 sm:grid-cols-5">
          <Metric label="审核任务" value={workspace.queue.length} />
          <Metric label="已登记信源" value={workspace.sources.length} />
          <Metric label="采集运行" value={workspace.runs.length} />
          <Metric label="邮件 Outbox" value={workspace.outbox.length} />
          <Metric label="正式数据门槛" value={workspace.quality?.liveReady ? "通过" : "未通过"} />
        </section>

        {workspace.quality && !workspace.quality.liveReady && (
          <section className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-5">
            <h2 className="font-medium">正式数据验收尚未通过</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              当前 {workspace.quality.entityCount} 个实体、{workspace.quality.claimCount} 条 Claim、
              {workspace.quality.relationCount}{" "}
              条关系。演示和工程闭环可用，但不能据此宣称正式数据完备。
            </p>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {workspace.quality.issues.map((issue) => (
                <li key={issue}>· {issue}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold">候选队列</h2>
          {workspace.queue.map((item) => (
            <article key={item.id} className="paper-card p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
                  <h3 className="mt-2 font-medium">{item.claim.text.zh}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.claim.text.en}</p>
                </div>
                <span className="h-fit rounded-full border border-border px-2.5 py-1 text-xs">
                  {item.status}
                </span>
              </div>
              {(item.conflictClaimIds.length > 0 || item.reviewReason) && (
                <div className="mt-3 rounded-md border border-conflict/30 bg-conflict/10 p-3 text-sm">
                  {item.reviewReason}
                  {item.conflictClaimIds.length > 0 && (
                    <div className="mt-1 font-mono text-xs">{item.conflictClaimIds.join(", ")}</div>
                  )}
                </div>
              )}
              {(item.status === "pending" || item.status === "needs-more-evidence") && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Input
                    aria-label="审核理由"
                    placeholder="填写可审计的审核理由"
                    value={reasons[item.id] ?? ""}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                  <Button onClick={() => decide(item, "approve")} disabled={busy}>
                    <Check />
                    批准
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => decide(item, "reject")}
                    disabled={busy}
                  >
                    <X />
                    拒绝
                  </Button>
                </div>
              )}
            </article>
          ))}
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-2">
          <section className="paper-card p-5">
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
            <div className="mt-4 max-h-[36rem] space-y-3 overflow-y-auto pr-1">
              {workspace.sources.map((source) => (
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
                        source.fetchEnabled
                          ? "bg-verified/10 text-verified"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {source.fetchEnabled ? "自动采集" : "手动采集"}
                    </span>
                  </div>
                  <a
                    className="mt-2 block truncate text-xs text-signal hover:underline"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.url}
                  </a>
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
                      disabled={busy || !source.active}
                      onClick={() => updateSource(source, { fetchEnabled: !source.fetchEnabled })}
                    >
                      {source.fetchEnabled ? "暂停自动采集" : "启用自动采集"}
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
                      disabled={busy || !source.lastSeenAt}
                      title={source.lastSeenAt ? "从最近快照抽取候选事实" : "先完成一次采集"}
                      onClick={() => extractSource(source)}
                    >
                      抽取候选
                    </Button>
                  </div>
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

        {user.role === "admin" && (
          <section className="paper-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
                  <Braces className="h-5 w-5 text-signal" />
                  扩展模型目录
                </h2>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  用经过核验的数据新增或更新模型系列、具体版本、时间线和关系。具体版本填写 familyId
                  后，知识库、详情、图谱与版本对比会自动读取。
                </p>
              </div>
              <div className="flex rounded-md border border-border p-1">
                {(["entity", "relation", "timeline"] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={catalogKind === kind ? "default" : "ghost"}
                    onClick={() => switchCatalogKind(kind)}
                  >
                    {kind === "entity" ? "实体 / 版本" : kind === "relation" ? "关系" : "时间线"}
                  </Button>
                ))}
              </div>
            </div>
            {catalogKind === "timeline" && (
              <Input
                className="mt-4 max-w-md"
                aria-label="时间线所属实体 ID"
                placeholder="时间线所属实体 ID，例如 e-gpt"
                value={timelineEntityId}
                onChange={(event) => setTimelineEntityId(event.target.value)}
              />
            )}
            <Textarea
              className="mt-4 min-h-72 font-mono text-xs leading-relaxed"
              aria-label="目录 JSON"
              spellCheck={false}
              value={catalogJson}
              onChange={(event) => setCatalogJson(event.target.value)}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={saveCatalogRecord} disabled={busy}>
                <Check />
                校验并保存
              </Button>
              <span className="text-xs text-muted-foreground">
                相同 ID 会更新原记录；服务端会校验系列归属、端点和字段结构。
              </span>
            </div>
            {catalogMessage && <p className="mt-3 text-sm text-verified">{catalogMessage}</p>}
          </section>
        )}
      </main>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="paper-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 font-serif text-3xl font-semibold">{value}</div>
    </div>
  );
}

function Notice({
  title,
  detail,
  destructive = false,
}: {
  title: string;
  detail: string;
  destructive?: boolean;
}) {
  return (
    <div
      className={`mx-auto my-8 max-w-3xl rounded-lg border p-5 ${destructive ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}
    >
      <h2 className="font-medium">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function DataList({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: ReactNode;
  rows: { key: string; title: string; detail: string }[];
}) {
  return (
    <section className="paper-card p-5">
      <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
        {icon}
        {title}
      </h2>
      <div className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <div key={row.key} className="py-3">
            <div className="text-sm font-medium">{row.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{row.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
