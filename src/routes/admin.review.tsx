import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  Braces,
  Check,
  Database,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildManualCandidate, suggestedEntityId } from "@/domain/manual-candidate";
import type { Entity, GraphEdge, TimelineEntry } from "@/domain/types";
import {
  adminApi,
  type AdminUser,
  type AuditEntry,
  type DataQualityReport,
  type DocumentSnapshotView,
  type IngestionRun,
  type IntegrationStatus,
  type OperationsDiagnostics,
  type OutboxEntry,
  type ProductionReadiness,
  type ProductionReadinessCheck,
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
  integrations: IntegrationStatus | null;
  operations: OperationsDiagnostics | null;
  productionReadiness: ProductionReadiness | null;
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
  const [operationsError, setOperationsError] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "allowlisted" | "automatic">("all");
  const [sourceSnapshots, setSourceSnapshots] = useState<Record<string, DocumentSnapshotView[]>>(
    {},
  );

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

  const allowlistedHosts = workspace.integrations?.fetchAllowedHosts ?? [];
  const filteredSources = workspace.sources.filter((source) => {
    const search = sourceSearch.trim().toLocaleLowerCase("zh-CN");
    const matchesSearch =
      !search ||
      [source.title, source.publisher, source.url, source.id].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(search),
      );
    const allowlisted = isAllowlistedSource(source, allowlistedHosts);
    const matchesFilter =
      sourceFilter === "all" ||
      (sourceFilter === "allowlisted" && allowlisted) ||
      (sourceFilter === "automatic" && source.fetchEnabled);
    return matchesSearch && matchesFilter;
  });
  const pendingQueue = workspace.queue.filter(
    (item) => item.status === "pending" || item.status === "needs-more-evidence",
  );
  const reviewHistory = workspace.queue.filter(
    (item) => item.status === "approved" || item.status === "rejected",
  );

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
          <Metric label="待审核任务" value={pendingQueue.length} />
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
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <QualityMetric
                label="引用覆盖"
                value={workspace.quality.evidenceReferenceCoverage}
                threshold="目标 ≥ 98%"
              />
              <QualityMetric
                label="官方来源"
                value={workspace.quality.officialEvidenceRatio}
                threshold="目标 ≥ 60%"
              />
              <QualityMetric
                label="人工核验"
                value={workspace.quality.reviewedEvidenceRatio}
                threshold="目标 ≥ 90%"
              />
              <QualityMetric
                label="180 天新鲜度"
                value={workspace.quality.freshEvidenceRatio}
                threshold="目标 ≥ 80%"
              />
              <QualityMetric
                label="已核验内容"
                value={workspace.quality.verifiedContentRatio}
                threshold="目标 ≥ 80%"
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              当前覆盖 {workspace.quality.evidenceDomainCount} 个来源域名，
              {workspace.quality.conflictContentCount} 条未解决冲突；正式验收要求至少 8
              个来源域名且冲突为 0。
            </p>
          </section>
        )}

        {workspace.productionReadiness && (
          <ProductionReadinessPanel readiness={workspace.productionReadiness} />
        )}

        {workspace.integrations && (
          <section className="paper-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-2xl font-semibold">外部集成状态</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  这里只显示是否已配置和非敏感标识，不会返回任何密钥或密码。
                </p>
              </div>
              <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                生产环境检查
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <IntegrationCard
                title="AI 候选抽取"
                ready={workspace.integrations.extractionConfigured}
                detail={
                  workspace.integrations.extractionConfigured
                    ? `${workspace.integrations.extractionModel} · ${workspace.integrations.extractionEndpointHost}`
                    : "未配置 API 地址、密钥或模型"
                }
              />
              <IntegrationCard
                title="每日摘要与邮件"
                ready={workspace.integrations.smtpConfigured}
                detail={
                  workspace.integrations.smtpConfigured
                    ? `按 ${workspace.integrations.digestTimezone} 调度 · ${workspace.integrations.smtpFrom} · ${workspace.integrations.smtpHost}`
                    : `按 ${workspace.integrations.digestTimezone} 自动进入 Outbox · 配置 SMTP 后自动投递`
                }
              />
              <IntegrationCard
                title="自动采集"
                ready={workspace.integrations.fetchAllowedHosts.length > 0}
                detail={
                  workspace.integrations.fetchAllowedHosts.length > 0
                    ? `${workspace.integrations.automaticSources} 个信源启用 · ${workspace.integrations.fetchAllowedHosts.length} 个白名单域名`
                    : `${workspace.integrations.registeredSources} 个信源已登记 · 域名白名单为空`
                }
              />
            </div>
          </section>
        )}

        {user.role === "admin" && (
          <OperationsPanel
            operations={workspace.operations}
            refreshError={operationsError}
            outbox={workspace.outbox}
            busy={busy}
            onRetryOutbox={retryOutbox}
          />
        )}

        <section className="space-y-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold">待审核队列</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              这里只显示需要处理的候选；已批准和已拒绝记录保留在下方历史中。
            </p>
          </div>
          {pendingQueue.length === 0 && (
            <div className="paper-card p-5 text-sm text-muted-foreground">当前没有待审核候选。</div>
          )}
          {pendingQueue.map((item) => (
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
            </article>
          ))}
        </section>

        {reviewHistory.length > 0 && (
          <details className="paper-card p-5">
            <summary className="cursor-pointer font-serif text-xl font-semibold">
              已处理审核历史（{reviewHistory.length}）
            </summary>
            <div className="mt-4 divide-y divide-border">
              {reviewHistory.map((item) => (
                <article key={item.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
                      <p className="mt-2 text-sm font-medium">{item.claim.text.zh}</p>
                      {item.reviewReason && (
                        <p className="mt-1 text-xs text-muted-foreground">{item.reviewReason}</p>
                      )}
                    </div>
                    <span className="rounded-full border border-border px-2.5 py-1 text-xs">
                      {item.status === "approved" ? "已批准" : "已拒绝"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </details>
        )}

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
                  setSourceFilter(event.target.value as "all" | "allowlisted" | "automatic")
                }
              >
                <option value="all">全部信源</option>
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
                        source.fetchEnabled
                          ? "bg-verified/10 text-verified"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {source.fetchEnabled ? "自动采集" : "手动采集"}
                    </span>
                    {isAllowlistedSource(source, allowlistedHosts) && (
                      <span className="rounded-full bg-signal/10 px-2 py-1 text-xs text-signal">
                        可预检
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
                  {source.consecutiveFailures > 0 && (
                    <div className="mt-3 rounded-md border border-conflict/30 bg-conflict/5 p-3 text-xs">
                      <div className="font-medium text-conflict">
                        连续失败 {source.consecutiveFailures} 次，系统正在按退避策略重试
                      </div>
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
                          {source.lastProbeError}
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
                        (!source.fetchEnabled && !isRecentProbePassed(source))
                      }
                      title={
                        source.fetchEnabled || isRecentProbePassed(source)
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
                      disabled={busy || !source.active}
                      title="只检查网络策略、响应类型和可读内容，不保存快照"
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

function OperationsPanel({
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

function DiagnosticCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function QueueMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: "idle" | "running" | "succeeded" | "partial" | "failed";
}) {
  const className =
    status === "succeeded"
      ? "bg-verified/10 text-verified"
      : status === "running"
        ? "bg-inferred/10 text-inferred"
        : status === "partial"
          ? "bg-unverified/10 text-unverified"
          : status === "failed"
            ? "bg-conflict/10 text-conflict"
            : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-xs ${className}`}>{label}</span>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(record: Record<string, unknown> | null, key: string): number {
  const value = record?.[key];
  return typeof value === "number" ? value : 0;
}

function statusLabel(status: "running" | "succeeded" | "partial" | "failed"): string {
  return status === "running"
    ? "运行中"
    : status === "succeeded"
      ? "成功"
      : status === "partial"
        ? "部分失败"
        : "失败";
}

function workerStateLabel(state: "starting" | "running" | "idle" | "failed" | "stopped"): string {
  return state === "starting"
    ? "启动中"
    : state === "running"
      ? "运行中"
      : state === "idle"
        ? "空闲"
        : state === "failed"
          ? "失败"
          : "已停止";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value?: number): string {
  if (value === undefined) return "进行中";
  return value < 1000 ? `${value} 毫秒` : `${(value / 1000).toFixed(1)} 秒`;
}

function isFuture(value?: string): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

function isRecentProbePassed(source: SourceView): boolean {
  if (source.lastProbeStatus !== "passed" || !source.lastProbeAt) return false;
  const probedAt = new Date(source.lastProbeAt).getTime();
  return Number.isFinite(probedAt) && probedAt >= Date.now() - 24 * 60 * 60 * 1000;
}

function isAllowlistedSource(source: SourceView, allowedHosts: string[]): boolean {
  try {
    const host = new URL(source.url).hostname.toLocaleLowerCase("en-US");
    return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="paper-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 font-serif text-3xl font-semibold">{value}</div>
    </div>
  );
}

function QualityMetric({
  label,
  value,
  threshold,
}: {
  label: string;
  value: number;
  threshold: string;
}) {
  return (
    <div className="rounded-lg border border-amber-400/30 bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{Math.round(value * 100)}%</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{threshold}</div>
    </div>
  );
}

function IntegrationCard({
  title,
  ready,
  detail,
}: {
  title: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            ready ? "bg-verified/10 text-verified" : "bg-unverified/10 text-unverified"
          }`}
        >
          {ready ? "已配置" : "待配置"}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function ProductionReadinessPanel({ readiness }: { readiness: ProductionReadiness }) {
  return (
    <section className="paper-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold">生产上线预检</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            自动检查运行环境、数据质量和外部集成；人工项目必须在正式环境逐项留痕确认。
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${
            readiness.automatedReady
              ? "bg-verified/10 text-verified"
              : "bg-conflict/10 text-conflict"
          }`}
        >
          {readiness.automatedReady
            ? `自动检查通过 · ${readiness.warningCount} 项警告`
            : `${readiness.blockingCount} 项阻塞 · ${readiness.warningCount} 项警告`}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {readiness.checks.map((check) => (
          <ReadinessCard key={check.code} check={check} />
        ))}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-medium">正式发布前人工确认</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          这些项目依赖域名、云平台或供应商外部状态，系统不会自动宣称已经完成。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {readiness.manualChecks.map((check) => (
            <ReadinessCard key={check.code} check={check} />
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        生成时间：{formatTime(readiness.generatedAt)}
      </p>
    </section>
  );
}

function ReadinessCard({ check }: { check: ProductionReadinessCheck }) {
  const label =
    check.status === "ready"
      ? "通过"
      : check.status === "blocked"
        ? "阻塞"
        : check.status === "warning"
          ? "警告"
          : "人工确认";
  const tone =
    check.status === "ready"
      ? "bg-verified/10 text-verified"
      : check.status === "blocked"
        ? "bg-conflict/10 text-conflict"
        : "bg-unverified/10 text-unverified";
  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium">{check.title}</h3>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${tone}`}>{label}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{check.detail}</p>
      {check.action && <p className="mt-2 text-xs leading-5">下一步：{check.action}</p>}
    </article>
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
