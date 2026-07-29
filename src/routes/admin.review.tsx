import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Database, LogOut, Mail, RefreshCw, ShieldCheck, X } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminApi,
  type AdminUser,
  type AuditEntry,
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
};

function AdminReviewPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});

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
    try {
      if (kind === "ingestion") await adminApi.runIngestion(token);
      else if (kind === "digest") await adminApi.runDigest(token);
      else await adminApi.sendOutbox(token);
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Operation failed.");
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

        <section className="grid gap-3 sm:grid-cols-4">
          <Metric label="审核任务" value={workspace.queue.length} />
          <Metric label="已登记信源" value={workspace.sources.length} />
          <Metric label="采集运行" value={workspace.runs.length} />
          <Metric label="邮件 Outbox" value={workspace.outbox.length} />
        </section>

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

        <section className="grid gap-5 lg:grid-cols-2">
          <DataList
            title="信源"
            icon={<Database className="h-4 w-4" />}
            rows={workspace.sources.map((source) => ({
              key: source.id,
              title: source.title,
              detail: `${source.publisher} · ${source.fetchEnabled ? "自动采集" : "手动采集"}`,
            }))}
          />
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
      </main>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
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
