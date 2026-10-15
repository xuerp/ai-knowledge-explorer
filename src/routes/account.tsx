import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bell, BookOpen, Check, LogOut, ShieldCheck, UserPlus, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/account/PasswordField";
import { useApp } from "@/lib/app-state";
import {
  authSessionExpiredEvent,
  clearAuthToken,
  readAuthToken,
  writeAuthToken,
} from "@/services/auth-session";
import { AuthSessionExpiredError, accountErrorMessage } from "@/services/auth-errors";
import {
  userApi,
  type FollowItem,
  type ResearchResult,
  type SessionUser,
  type UserNotification,
} from "@/services/user-api";

export const Route = createFileRoute("/account")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  head: () => ({ meta: [{ title: "Account · AI Radar" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { t } = useApp();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [following, setFollowing] = useState<FollowItem[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authReady, setAuthReady] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  useEffect(() => setAuthReady(true), []);

  const refresh = useCallback(
    async (activeToken: string) => {
      const nextUser = await userApi.me(activeToken);
      if (readAuthToken() !== activeToken) return;
      setUser(nextUser);
      const [nextFollowing, nextNotifications] = await Promise.allSettled([
        userApi.following(activeToken),
        userApi.notifications(activeToken),
      ]);
      if (readAuthToken() !== activeToken) return;
      if (nextFollowing.status === "fulfilled") setFollowing(nextFollowing.value);
      if (nextNotifications.status === "fulfilled") setNotifications(nextNotifications.value);
      if (nextFollowing.status === "rejected" || nextNotifications.status === "rejected") {
        setError(
          t(
            "部分账户资料加载失败，请刷新重试。",
            "Some account data could not load. Refresh to retry.",
          ),
        );
      }
    },
    [t],
  );

  useEffect(() => {
    const stored = readAuthToken();
    if (!stored) return;
    setToken(stored);
    refresh(stored).catch((reason: unknown) => {
      if (readAuthToken() && readAuthToken() !== stored) return;
      if (reason instanceof AuthSessionExpiredError) {
        clearAuthToken();
        setToken("");
      }
      setError(accountErrorMessage(reason, t));
    });
  }, [refresh, t]);

  useEffect(() => {
    const expired = () => {
      setToken("");
      setUser(null);
      setFollowing([]);
      setNotifications([]);
      setResearch(null);
    };
    window.addEventListener(authSessionExpiredEvent, expired);
    return () => window.removeEventListener(authSessionExpiredEvent, expired);
  }, []);

  const execute = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(accountErrorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  };

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void execute(async () => {
      const response = await userApi.login(
        String(form.get("email")),
        String(form.get("password")),
        rememberMe,
      );
      writeAuthToken(response.accessToken, rememberMe, response.expiresIn);
      setFollowing([]);
      setNotifications([]);
      setResearch(null);
      setToken(response.accessToken);
      await refresh(response.accessToken);
      const returnTo = safeReturnTo(
        new URLSearchParams(window.location.search).get("returnTo"),
        window.location.origin,
      );
      if (returnTo) window.location.assign(returnTo);
    });
  };

  const register = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirmPassword"))) {
      setError(t("两次输入的密码不一致。", "The passwords do not match."));
      event.currentTarget.querySelector<HTMLInputElement>('input[name="confirmPassword"]')?.focus();
      return;
    }
    void execute(async () => {
      const response = await userApi.register(String(form.get("email")), password);
      writeAuthToken(response.accessToken);
      setFollowing([]);
      setNotifications([]);
      setResearch(null);
      setToken(response.accessToken);
      await refresh(response.accessToken);
      const returnTo = safeReturnTo(
        new URLSearchParams(window.location.search).get("returnTo"),
        window.location.origin,
      );
      if (returnTo) window.location.assign(returnTo);
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
    const isRegistering = authMode === "register";
    return (
      <AppShell>
        <div className="account-auth">
          <form
            method="post"
            className="account-auth__card"
            onSubmit={isRegistering ? register : login}
          >
            <div className="account-auth__icon" aria-hidden="true">
              {isRegistering ? <UserPlus /> : <UserRound />}
            </div>
            <header className="account-auth__header">
              <h1>
                {isRegistering
                  ? t("创建账户", "Create an account")
                  : t("登录 AI Radar", "Sign in to AI Radar")}
              </h1>
              <p>
                {isRegistering
                  ? t(
                      "创建普通用户账户，用于跨设备保存关注、通知和私密研究。",
                      "Create a personal account to sync follows, notifications, and private research.",
                    )
                  : t(
                      "登录后，关注、通知和研究记录将在不同设备间同步。",
                      "Sign in to sync follows, notifications, and research across devices.",
                    )}
              </p>
            </header>

            {token && error && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void execute(() => refresh(token))}
              >
                {t("重新加载账户", "Reload account")}
              </Button>
            )}

            <div className="account-auth__fields">
              <label>
                <span>{t("邮箱", "Email")}</span>
                <Input
                  name="email"
                  type="email"
                  id="account-email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="email"
                  disabled={busy}
                  placeholder="you@example.com"
                  required
                />
              </label>
              <PasswordField
                key={authMode}
                id="account-password"
                name="password"
                label={t("密码", "Password")}
                creating={isRegistering}
                disabled={busy}
              />
              {isRegistering && (
                <PasswordField
                  id="account-confirm-password"
                  name="confirmPassword"
                  showHint={false}
                  label={t("确认密码", "Confirm password")}
                  creating
                  disabled={busy}
                />
              )}
            </div>

            {!isRegistering && (
              <div className="account-auth__options">
                <label className="account-auth__remember">
                  <input
                    type="checkbox"
                    name="rememberMe"
                    checked={rememberMe}
                    disabled={busy}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    aria-describedby="account-remember-hint"
                  />
                  <span>{t("保持登录，最长 7 天", "Keep me signed in for up to 7 days")}</span>
                </label>
                <p id="account-remember-hint">
                  {t(
                    "仅在个人设备上勾选。记住密码可使用浏览器的保存密码功能。",
                    "Use on your own device. Your browser can save and autofill your password.",
                  )}
                </p>
              </div>
            )}

            {error && (
              <p className="account-auth__error" role="alert">
                {error}
              </p>
            )}
            <Button className="account-auth__submit" disabled={busy || !authReady}>
              {busy
                ? isRegistering
                  ? t("正在创建…", "Creating account…")
                  : t("正在登录…", "Signing in…")
                : isRegistering
                  ? t("创建账户", "Create account")
                  : t("登录", "Sign in")}
            </Button>

            <p className="account-auth__switch">
              {isRegistering
                ? t("已有账户？", "Already have an account?")
                : t("还没有账户？", "New to AI Radar?")}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAuthMode(isRegistering ? "login" : "register");
                  setError("");
                }}
              >
                {isRegistering ? t("返回登录", "Sign in") : t("注册", "Create one")}
              </button>
            </p>
          </form>
        </div>
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
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  try {
                    await userApi.logout(token);
                  } finally {
                    clearAuthToken();
                    setUser(null);
                    setToken("");
                    setFollowing([]);
                    setNotifications([]);
                    setResearch(null);
                  }
                })
              }
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
              setResearch(
                await userApi.research(token, {
                  question: String(form.get("question")),
                  language: "zh",
                }),
              );
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

function safeReturnTo(value: string | null, origin: string) {
  if (!value) return "";
  try {
    const destination = new URL(value, origin);
    const allowedPath =
      destination.pathname === "/ask" || /^\/research\/[^/]+$/.test(destination.pathname);
    if (destination.origin !== origin || !allowedPath) return "";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "";
  }
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
