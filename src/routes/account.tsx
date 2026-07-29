import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bell, BookOpen, Check, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearAuthToken, readAuthToken, writeAuthToken } from "@/services/auth-session";
import {
  userApi,
  type FollowItem,
  type ResearchResult,
  type SessionUser,
  type UserNotification,
} from "@/services/user-api";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account · AI Radar" }] }),
  component: AccountPage,
});

function AccountPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [following, setFollowing] = useState<FollowItem[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (activeToken: string) => {
    const [nextUser, nextFollowing, nextNotifications] = await Promise.all([
      userApi.me(activeToken),
      userApi.following(activeToken),
      userApi.notifications(activeToken),
    ]);
    setUser(nextUser);
    setFollowing(nextFollowing);
    setNotifications(nextNotifications);
  }, []);

  useEffect(() => {
    const stored = readAuthToken();
    if (!stored) return;
    setToken(stored);
    refresh(stored).catch((reason: unknown) => {
      clearAuthToken();
      setToken("");
      setError(reason instanceof Error ? reason.message : "Session expired.");
    });
  }, [refresh]);

  const execute = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void execute(async () => {
      const response = await userApi.login(String(form.get("email")), String(form.get("password")));
      writeAuthToken(response.accessToken);
      setToken(response.accessToken);
      await refresh(response.accessToken);
    });
  };

  if (!userApi.configured) {
    return (
      <AppShell>
        <Notice text="当前是明确标记的演示模式。设置 VITE_API_BASE_URL 后可启用真实登录、跨设备关注、通知和私密研究。" />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md items-center px-4">
          <form className="paper-card w-full space-y-5 p-6" onSubmit={login}>
            <UserRound className="h-6 w-6 text-signal" />
            <div>
              <h1 className="font-serif text-3xl font-semibold">登录 AI Radar</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                登录后关注、通知和研究记录由后端持久化。访问令牌仅保存在当前标签页。
              </p>
            </div>
            <Input name="email" type="email" placeholder="you@example.com" required />
            <Input name="password" type="password" placeholder="密码" required />
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
      <main className="mx-auto max-w-5xl space-y-7 px-4 py-8 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-signal">Authenticated</div>
            <h1 className="mt-1 font-serif text-3xl font-semibold">我的账户</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {user.email} · {user.role}
            </p>
          </div>
          <div className="flex gap-2">
            {(user.role === "reviewer" || user.role === "admin") && (
              <Button asChild variant="outline">
                <Link to="/admin/review">
                  <ShieldCheck />
                  审核工作台
                </Link>
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                clearAuthToken();
                setUser(null);
                setToken("");
              }}
            >
              <LogOut />
              退出
            </Button>
          </div>
        </header>
        {error && <Notice text={error} destructive />}

        <section className="grid gap-5 lg:grid-cols-2">
          <form
            className="paper-card space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void execute(async () => {
                await userApi.follow(
                  token,
                  String(form.get("entityId")),
                  String(form.get("intensity")) as FollowItem["intensity"],
                );
                await refresh(token);
              });
            }}
          >
            <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
              <Bell className="h-5 w-5 text-signal" />
              真实关注
            </h2>
            <Input name="entityId" placeholder="实体 ID，例如 e-gpt" required />
            <select
              name="intensity"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="digest"
            >
              <option value="silent">静默</option>
              <option value="digest">摘要</option>
              <option value="instant">重要变化即时通知</option>
            </select>
            <Button disabled={busy}>保存关注</Button>
            <div className="space-y-2 text-sm">
              {following.map((item) => (
                <div key={item.id} className="rounded-md border border-border p-3">
                  {item.entityId} · {item.intensity}
                </div>
              ))}
            </div>
          </form>

          <form
            className="paper-card space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void execute(async () => {
                setUser(
                  await userApi.preferences(
                    token,
                    form.get("enabled") === "on",
                    String(form.get("hour")),
                  ),
                );
              });
            }}
          >
            <h2 className="font-serif text-xl font-semibold">每日邮件摘要</h2>
            <label className="flex items-center gap-2 text-sm">
              <input name="enabled" type="checkbox" defaultChecked={user.dailyDigestEnabled} />
              启用摘要
            </label>
            <Input name="hour" type="time" defaultValue={user.digestHour} required />
            <Button disabled={busy}>保存偏好</Button>
          </form>
        </section>

        <form
          className="paper-card space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void execute(async () => {
              setResearch(await userApi.research(token, String(form.get("question")), "zh"));
            });
          }}
        >
          <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
            <BookOpen className="h-5 w-5 text-signal" />
            基于已审核 Claim 的私密研究
          </h2>
          <Input name="question" placeholder="例如：GPT 最近有什么已核验变化？" required />
          <Button disabled={busy}>开始研究</Button>
          {research && (
            <div className="rounded-md border border-border p-4">
              <div className="text-xs uppercase text-muted-foreground">{research.status}</div>
              <div className="mt-3 whitespace-pre-wrap text-sm">{research.summary}</div>
              <div className="mt-3 font-mono text-xs">{research.claimIds.join(", ")}</div>
              {!research.publishedSlug && (
                <Button
                  className="mt-4"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    void execute(async () => {
                      setResearch(await userApi.publishResearch(token, research.id));
                    })
                  }
                >
                  主动公开
                </Button>
              )}
              {research.publishedSlug && (
                <Button className="mt-4" variant="outline" asChild>
                  <Link to="/share/$id" params={{ id: research.publishedSlug }}>
                    查看公开页面
                  </Link>
                </Button>
              )}
            </div>
          )}
        </form>

        <section className="paper-card p-5">
          <h2 className="font-serif text-xl font-semibold">站内通知</h2>
          <div className="mt-4 divide-y divide-border">
            {notifications.map((notification) => (
              <div key={notification.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-medium">{notification.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {notification.entityId} · {notification.priority}
                  </div>
                </div>
                {!notification.readAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void execute(async () => {
                        await userApi.markRead(token, notification.id);
                        await refresh(token);
                      })
                    }
                  >
                    <Check />
                    已读
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function Notice({ text, destructive = false }: { text: string; destructive?: boolean }) {
  return (
    <div
      className={`mx-auto my-8 max-w-3xl rounded-lg border p-5 text-sm ${
        destructive ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"
      }`}
    >
      {text}
    </div>
  );
}
