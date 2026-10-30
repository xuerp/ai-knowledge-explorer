import { EntryRequestsPanel } from "@/components/knowledge/EntryRequestsPanel";

import { LogOut, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { adminApi } from "@/services/admin-api";

import { Metric, Notice } from "./shared";

import { useReviewController } from "./useReviewController";
import { buildReviewViewModel } from "./review-view-model";
import { OperationsPanel } from "./OperationsPanel";
import { ProductionReadinessPanel } from "./ProductionReadinessPanel";
import { ClaimEntityAuditPanel } from "./ClaimEntityAuditPanel";
import { RelationAuditPanel } from "./RelationAuditPanel";
import { QualityPanel } from "./QualityPanel";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { ReviewRiskPanel } from "./ReviewRiskPanel";
import { ReviewQueuePanel } from "./ReviewQueuePanel";
import { SourcesPanel } from "./SourcesPanel";
import { CatalogPanel } from "./CatalogPanel";
export function ReviewWorkspace() {
  const controller = useReviewController();
  const {
    token,
    user,
    workspace,
    sessionChecking,
    error,
    busy,
    operationMessage,
    operationsError,
    login,
    logout,
    retryWorkspace,
    run,
    retryOutbox,
  } = controller;
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

  if (sessionChecking && !user) {
    return (
      <AppShell>
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md items-center px-4">
          <section className="paper-card w-full space-y-4 p-6 text-center">
            <RefreshCw className="mx-auto h-6 w-6 animate-spin text-signal" />
            <div>
              <h1 className="font-serif text-2xl font-semibold">正在恢复登录状态</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                只有令牌确实失效时才会返回登录页面。
              </p>
            </div>
          </section>
        </main>
      </AppShell>
    );
  }

  if (!user) {
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

  if (!workspace) {
    return (
      <AppShell>
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md items-center px-4">
          <section className="paper-card w-full space-y-4 p-6 text-center">
            <RefreshCw className={`mx-auto h-6 w-6 text-signal ${busy ? "animate-spin" : ""}`} />
            <div>
              <h1 className="font-serif text-2xl font-semibold">
                {busy ? "登录成功，正在加载审核工作区" : "已登录，但工作区尚未加载完成"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                单个诊断接口超时不会再阻塞整个后台，加载完成后会显示对应警告。
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!busy && (
              <div className="flex justify-center gap-3">
                <Button onClick={() => void retryWorkspace()}>
                  <RefreshCw />
                  重试加载
                </Button>
                <Button variant="outline" onClick={logout}>
                  <LogOut />
                  退出登录
                </Button>
              </div>
            )}
          </section>
        </main>
      </AppShell>
    );
  }

  const context = buildReviewViewModel(controller, workspace, user);
  const { pendingQueue } = context;

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
            {workspace.build && (
              <p className="mt-1 text-xs text-muted-foreground">
                发布 {workspace.build.release} · 构建{" "}
                <span className="font-mono">{workspace.build.buildCommit.slice(0, 12)}</span> · 迁移{" "}
                <span className="font-mono">{workspace.build.schemaRevision}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
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
        {workspace.loadWarnings.length > 0 && (
          <section className="rounded-lg border border-conflict/30 bg-conflict/5 p-4 text-sm">
            <div className="font-medium text-conflict">部分后台模块暂时不可用</div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {workspace.loadWarnings.map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              其他已加载模块仍可使用；刷新页面会重新尝试失败模块。
            </p>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-5">
          <Metric label="待审核任务" value={pendingQueue.length} />
          <Metric label="已登记信源" value={workspace.sources.length} />
          <Metric label="采集运行" value={workspace.runs.length} />
          <Metric label="邮件 Outbox" value={workspace.outbox.length} />
          <Metric label="正式数据门槛" value={workspace.quality?.liveReady ? "通过" : "未通过"} />
        </section>

        <ClaimEntityAuditPanel context={context} />

        <RelationAuditPanel context={context} />

        <QualityPanel context={context} />

        {workspace.productionReadiness && (
          <ProductionReadinessPanel readiness={workspace.productionReadiness} />
        )}

        <IntegrationsPanel context={context} />

        {user.role === "admin" && (
          <OperationsPanel
            operations={workspace.operations}
            refreshError={operationsError}
            outbox={workspace.outbox}
            busy={busy}
            onRetryOutbox={retryOutbox}
          />
        )}

        <ReviewRiskPanel context={context} />

        <ReviewQueuePanel context={context} />

        <SourcesPanel context={context} />

        <EntryRequestsPanel token={token} />
        <CatalogPanel context={context} />
      </main>
    </AppShell>
  );
}
