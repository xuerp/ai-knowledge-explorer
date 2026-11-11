import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, Pencil, RefreshCw, Search, UserPlus } from "lucide-react";
import { registrationPasswordMinLength } from "@/components/account/PasswordField";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/lib/app-state";
import { adminApi } from "@/services/admin-api";
import { userApi, type SessionUser } from "@/services/user-api";
import { accountErrorMessage, AuthSessionExpiredError } from "@/services/auth-errors";
import { authSessionExpiredEvent, clearAuthToken, readAuthToken } from "@/services/auth-session";
import type { AccountRole, ManagedUser, UserPage } from "@/domain/admin-users";

type Action = { kind: "edit" | "reset" | "status"; user: ManagedUser } | { kind: "create" };

export function UsersWorkspace() {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const [authRevision, setAuthRevision] = useState(0);
  const [auth, setAuth] = useState<{ token: string; user: SessionUser } | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState<UserPage | null>(null);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [selectedRole, setSelectedRole] = useState<AccountRole>("viewer");
  const focusReturn = useRef<HTMLElement | null>(null);
  const roleName = (value: AccountRole) =>
    value === "admin"
      ? t("管理员", "Administrator")
      : value === "reviewer"
        ? t("审核员", "Reviewer")
        : t("普通用户", "User");

  useEffect(() => {
    let active = true;
    const token = readAuthToken();
    if (!token) {
      void navigate({ to: "/account", search: { returnTo: "/admin/users" }, replace: true });
      return;
    }
    setChecking(true);
    setAuthError("");
    userApi
      .me(token)
      .then((user) => {
        if (!active || readAuthToken() !== token) return;
        if (user.role !== "admin") {
          void navigate({ to: "/account", replace: true });
          return;
        }
        setAuth({ token, user });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof AuthSessionExpiredError) {
          void navigate({ to: "/account", search: { returnTo: "/admin/users" }, replace: true });
        } else {
          setAuthError(accountErrorMessage(reason, t));
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [t, navigate, authRevision]);

  useEffect(() => {
    const expired = () => {
      setAuth(null);
      setPage(null);
      setAction(null);
      void navigate({ to: "/account", search: { returnTo: "/admin/users" }, replace: true });
    };
    window.addEventListener(authSessionExpiredEvent, expired);
    return () => window.removeEventListener(authSessionExpiredEvent, expired);
  }, [navigate]);

  useEffect(() => {
    if (!auth || auth.user.role !== "admin") return;
    let active = true;
    setLoading(true);
    setError("");
    setPage(null);
    adminApi
      .users(auth.token, { q, role, status, offset })
      .then((result) => {
        if (!active) return;
        if (offset > 0 && result.items.length === 0 && result.total > 0) {
          setOffset(Math.floor((result.total - 1) / 20) * 20);
        } else {
          setPage(result);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(accountErrorMessage(reason, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth, q, role, status, offset, revision, t]);

  function openAction(next: Action) {
    focusReturn.current = document.activeElement as HTMLElement;
    setSelectedRole(next.kind === "edit" ? next.user.role : "viewer");
    setFormError("");
    setNotice("");
    setAction(next);
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !action || busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (
      (action.kind === "create" || action.kind === "reset") &&
      password !== form.get("confirmPassword")
    ) {
      setFormError(t("两次输入的密码不一致。", "The passwords do not match."));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      if (action.kind === "create") {
        await adminApi.createUser(auth.token, {
          email: String(form.get("email")).trim(),
          password,
          role: selectedRole,
        });
      } else if (action.kind === "edit") {
        await adminApi.updateUser(auth.token, action.user.id, {
          expectedVersion: action.user.version,
          email: String(form.get("email")).trim(),
          role: selectedRole,
        });
      } else if (action.kind === "status") {
        await adminApi.updateUser(auth.token, action.user.id, {
          expectedVersion: action.user.version,
          active: !action.user.active,
        });
      } else {
        await adminApi.resetUserPassword(auth.token, action.user.id, {
          expectedVersion: action.user.version,
          password,
        });
      }
      const ownCredentialsChanged =
        action.kind !== "create" &&
        action.user.id === auth.user.id &&
        (action.kind === "reset" ||
          (action.kind === "edit" &&
            String(form.get("email")).trim().toLowerCase() !== auth.user.email));
      if (ownCredentialsChanged) {
        clearAuthToken();
        setAuth(null);
        setPage(null);
        void navigate({ to: "/account", search: { returnTo: "/admin/users" }, replace: true });
        setAuthError(
          t(
            "账户已更新，请使用新资料重新登录。",
            "Account updated. Sign in with your new credentials.",
          ),
        );
      }
      setAction(null);
      setNotice(
        action.kind === "create"
          ? t("账户已创建。", "Account created.")
          : action.kind === "reset"
            ? t(
                "密码已重置，该账户需要重新登录。",
                "Password reset. This account must sign in again.",
              )
            : t("账户已更新。", "Account updated."),
      );
      setRevision((value) => value + 1);
    } catch (reason) {
      setFormError(accountErrorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  }

  const title =
    action?.kind === "create"
      ? t("创建账户", "Create account")
      : action?.kind === "edit"
        ? t("编辑账户", "Edit account")
        : action?.kind === "reset"
          ? t("重置密码", "Reset password")
          : action?.kind === "status" && action.user.active
            ? t("停用账户", "Disable account")
            : t("恢复账户", "Restore account");
  const passwordMinLength = action?.kind === "create" ? registrationPasswordMinLength : 12;

  if (checking || !auth || auth.user.role !== "admin") {
    return (
      <AppShell>
        <section className="mx-auto max-w-7xl space-y-4 px-4 py-10 md:px-6">
          {authError ? (
            <>
              <p role="alert" className="text-sm text-destructive">
                {authError}
              </p>
              <Button variant="outline" onClick={() => setAuthRevision((v) => v + 1)}>
                {t("重试连接", "Retry connection")}
              </Button>
            </>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t("正在进入账户…", "Opening your account…")}
            </p>
          )}
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto min-h-[60vh] max-w-7xl space-y-6 px-4 py-8 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">{t("用户管理", "User management")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("管理账户资料、访问状态与角色权限。", "Manage accounts, access and roles.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/admin/review">{t("审核工作台", "Review workspace")}</Link>
            </Button>
            {auth?.user.role === "admin" && (
              <Button onClick={() => openAction({ kind: "create" })}>
                <UserPlus />
                {t("创建账户", "Create account")}
              </Button>
            )}
          </div>
        </header>
        {
          <>
            {notice && (
              <p role="status" className="text-sm text-signal">
                {notice}
              </p>
            )}
            <form
              aria-label={t("账户筛选", "Account filters")}
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setQ(query.trim());
                setOffset(0);
                setRevision((v) => v + 1);
              }}
            >
              <label className="flex min-w-0 grow basis-64 flex-col gap-2">
                <span className="text-sm">{t("搜索邮箱", "Search email")}</span>
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={320}
                  placeholder={t("输入完整邮箱或关键词", "Email address or keyword")}
                />
              </label>
              <div className="flex min-w-0 grow basis-32 flex-col gap-2 sm:w-36 sm:grow-0 sm:basis-auto">
                <label htmlFor="users-role" className="text-sm">
                  {t("角色", "Role")}
                </label>
                <Select
                  value={role}
                  onValueChange={(v) => {
                    setRole(v);
                    setOffset(0);
                  }}
                >
                  <SelectTrigger id="users-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("全部角色", "All roles")}</SelectItem>
                    {(["viewer", "reviewer", "admin"] as const).map((value) => (
                      <SelectItem value={value} key={value}>
                        {roleName(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-0 grow basis-32 flex-col gap-2 sm:w-36 sm:grow-0 sm:basis-auto">
                <label htmlFor="users-status" className="text-sm">
                  {t("账户状态", "Account status")}
                </label>
                <Select
                  value={status}
                  onValueChange={(v) => {
                    setStatus(v);
                    setOffset(0);
                  }}
                >
                  <SelectTrigger id="users-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("全部状态", "All statuses")}</SelectItem>
                    <SelectItem value="active">{t("已启用", "Active")}</SelectItem>
                    <SelectItem value="disabled">{t("已停用", "Disabled")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" variant="outline">
                  <Search />
                  {t("搜索", "Search")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => setRevision((v) => v + 1)}
                >
                  <RefreshCw className={loading ? "animate-spin" : ""} />
                  {t("刷新", "Refresh")}
                </Button>
              </div>
            </form>
            {error && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 text-sm text-destructive"
              >
                <p>{error}</p>
                <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
                  {t("重试", "Retry")}
                </Button>
              </div>
            )}
            <section aria-label={t("用户列表", "Accounts")} aria-busy={loading}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <p>
                  {page
                    ? t(`共 ${page.total} 个账户`, `${page.total} accounts`)
                    : t("账户列表", "Accounts")}
                </p>
                <span className="text-muted-foreground">
                  {t(
                    "停用账户会保留其研究和关注记录。",
                    "Disabling an account preserves its research and follows.",
                  )}
                </span>
              </div>
              <div
                className="hidden grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_16rem] gap-4 border-y border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground lg:grid"
                aria-hidden="true"
              >
                <span>{t("邮箱", "Email")}</span>
                <span>{t("角色", "Role")}</span>
                <span>{t("状态", "Status")}</span>
                <span>{t("创建日期", "Created")}</span>
                <span>{t("操作", "Actions")}</span>
              </div>
              {loading ? (
                <div role="status" className="space-y-4 py-6">
                  <p className="text-sm text-muted-foreground">
                    {t("正在加载账户…", "Loading accounts…")}
                  </p>
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="h-12 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              ) : page?.items.length === 0 ? (
                <div className="space-y-3 border-y border-border py-10 text-center">
                  <h2 className="font-medium">{t("没有匹配的账户", "No matching accounts")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "试试其他邮箱关键词，或清除角色与状态筛选。",
                      "Try another email or clear the role and status filters.",
                    )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setQ("");
                      setRole("all");
                      setStatus("all");
                      setOffset(0);
                    }}
                  >
                    {t("清除筛选", "Clear filters")}
                  </Button>
                </div>
              ) : (
                <ul>
                  {page?.items.map((row) => (
                    <li
                      key={row.id}
                      className="grid min-w-0 items-center gap-3 border-b border-border px-1 py-5 sm:px-4 lg:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_16rem] lg:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium [overflow-wrap:anywhere]">
                          {row.email}
                        </p>
                        {row.id === auth.user.id && (
                          <span className="text-xs text-muted-foreground">
                            {t("当前账户", "Your account")}
                          </span>
                        )}
                      </div>
                      <span className="text-sm">{roleName(row.role)}</span>
                      <span
                        className={`w-fit rounded px-2 py-1 text-xs ${row.active ? "bg-signal/10 text-signal" : "bg-muted text-muted-foreground"}`}
                      >
                        {row.active ? t("已启用", "Active") : t("已停用", "Disabled")}
                      </span>
                      <time dateTime={row.createdAt} className="text-sm text-muted-foreground">
                        {new Date(row.createdAt).toLocaleDateString(
                          lang === "zh" ? "zh-CN" : "en-GB",
                        )}
                      </time>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t(`编辑 ${row.email}`, `Edit ${row.email}`)}
                          onClick={() => openAction({ kind: "edit", user: row })}
                        >
                          <Pencil />
                          {t("编辑", "Edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t(
                            `重置 ${row.email} 的密码`,
                            `Reset password for ${row.email}`,
                          )}
                          onClick={() => openAction({ kind: "reset", user: row })}
                        >
                          <KeyRound />
                          {t("密码", "Password")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={row.id === auth.user.id}
                          aria-label={
                            row.active
                              ? t(`停用 ${row.email}`, `Disable ${row.email}`)
                              : t(`恢复 ${row.email}`, `Restore ${row.email}`)
                          }
                          onClick={() => openAction({ kind: "status", user: row })}
                        >
                          {row.active ? t("停用", "Disable") : t("恢复", "Restore")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {page && page.total > page.limit && (
                <nav
                  aria-label={t("账户分页", "Account pages")}
                  className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"
                >
                  <span>
                    {t(
                      `第 ${offset + 1}–${offset + page.items.length} 个，共 ${page.total} 个`,
                      `${offset + 1}–${offset + page.items.length} of ${page.total}`,
                    )}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={offset === 0 || loading}
                      onClick={() => setOffset(Math.max(0, offset - 20))}
                    >
                      {t("上一页", "Previous")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={offset + page.limit >= page.total || loading}
                      onClick={() => setOffset(offset + 20)}
                    >
                      {t("下一页", "Next")}
                    </Button>
                  </div>
                </nav>
              )}
            </section>
          </>
        }
        <Dialog
          open={Boolean(action)}
          onOpenChange={(open) => {
            if (!open && !busy) setAction(null);
          }}
        >
          <DialogContent
            className="max-h-[90dvh] w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-lg sm:max-w-lg"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              focusReturn.current?.focus();
            }}
          >
            <DialogHeader className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="break-words [overflow-wrap:anywhere]">
                {action?.kind === "create"
                  ? t("填写邮箱并设置初始密码。", "Enter an email and initial password.")
                  : action && action.kind === "status"
                    ? action.user.active
                      ? t(
                          `停用 ${action.user.email} 后，该账户将无法登录，已有内容会保留。`,
                          `Disable ${action.user.email}? The account will lose access; existing content will be retained.`,
                        )
                      : t(
                          `恢复 ${action.user.email} 后，该账户可重新登录。`,
                          `Restore ${action.user.email}? The account can sign in again.`,
                        )
                    : action
                      ? action.user.email
                      : ""}
              </DialogDescription>
            </DialogHeader>
            {action && (
              <form
                key={action.kind + (action.kind === "create" ? "" : action.user.id)}
                onSubmit={(event) => void submitAction(event)}
                className="min-w-0 space-y-4"
              >
                {(action.kind === "create" || action.kind === "edit") && (
                  <>
                    <label className="block space-y-2 text-sm">
                      <span>{t("邮箱", "Email")}</span>
                      <Input
                        name="email"
                        type="email"
                        required
                        maxLength={320}
                        autoComplete="off"
                        defaultValue={action.kind === "edit" ? action.user.email : ""}
                        disabled={busy}
                      />
                    </label>
                    <div className="space-y-2">
                      <label htmlFor="account-role" className="text-sm">
                        {t("角色", "Role")}
                      </label>
                      <Select
                        value={selectedRole}
                        onValueChange={(value) => setSelectedRole(value as AccountRole)}
                        disabled={
                          busy || (action.kind === "edit" && action.user.id === auth?.user.id)
                        }
                      >
                        <SelectTrigger id="account-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["viewer", "reviewer", "admin"] as const).map((value) => (
                            <SelectItem value={value} key={value}>
                              {roleName(value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-muted-foreground">
                        {selectedRole === "admin"
                          ? t(
                              "可管理用户、信源和审核操作。",
                              "Can manage users, sources and reviews.",
                            )
                          : selectedRole === "reviewer"
                            ? t(
                                "可审核资料，不能管理其他账户。",
                                "Can review content; cannot manage accounts.",
                              )
                            : t(
                                "可浏览资料并保存个人研究。",
                                "Can browse content and save personal research.",
                              )}
                      </p>
                    </div>
                  </>
                )}
                {(action.kind === "create" || action.kind === "reset") && (
                  <>
                    <label className="block space-y-2 text-sm">
                      <span>{t("新密码", "New password")}</span>
                      <Input
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        minLength={passwordMinLength}
                        maxLength={256}
                        required
                        disabled={busy}
                        aria-describedby="admin-password-hint"
                      />
                    </label>
                    <p id="admin-password-hint" className="text-sm text-muted-foreground">
                      {t(
                        `至少 ${passwordMinLength} 个字符，支持粘贴或浏览器生成的密码。`,
                        `At least ${passwordMinLength} characters. Pasting and generated passwords are supported.`,
                      )}
                    </p>
                    <label className="block space-y-2 text-sm">
                      <span>{t("确认密码", "Confirm password")}</span>
                      <Input
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        minLength={passwordMinLength}
                        maxLength={256}
                        required
                        disabled={busy}
                      />
                    </label>
                  </>
                )}
                {(action.kind === "edit" || action.kind === "reset") && (
                  <p className="text-sm text-muted-foreground">
                    {action.kind === "edit" && action.user.id === auth?.user.id
                      ? t(
                          "修改自己的邮箱后需要重新登录。",
                          "Changing your own email requires a new sign-in.",
                        )
                      : t(
                          "保存变更后，该账户需要重新登录。",
                          "After this change, the account must sign in again.",
                        )}
                  </p>
                )}
                {formError && (
                  <div role="alert" className="space-y-2 text-sm text-destructive">
                    <p className="break-words">{formError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAction(null);
                        setRevision((v) => v + 1);
                      }}
                    >
                      {t("刷新账户列表", "Refresh accounts")}
                    </Button>
                  </div>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setAction(null)}
                  >
                    {t("取消", "Cancel")}
                  </Button>
                  <Button
                    disabled={busy}
                    variant={
                      action.kind === "status" && action.user.active ? "destructive" : "default"
                    }
                  >
                    {busy
                      ? t("正在保存…", "Saving…")
                      : title === t("编辑账户", "Edit account")
                        ? t("保存变更", "Save changes")
                        : title}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </AppShell>
  );
}
