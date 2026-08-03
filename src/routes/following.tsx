import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Zap,
  ArrowRight,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
  X,
  Mail,
  CheckCheck,
  Inbox,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import type { FollowPreference } from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  readNotificationPreferences,
  readFollowing,
  readPersonalization,
  writeNotificationPreferences,
  writeFollowing,
  writePersonalization,
  type NotificationPreferences,
  type PersonalizationPreferences,
} from "@/lib/personalization";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readAuthToken } from "@/services/auth-session";
import {
  userApi,
  type FollowItem as RemoteFollowItem,
  type SessionUser,
  type UserNotification,
} from "@/services/user-api";

export const Route = createFileRoute("/following")({
  head: () => ({
    meta: [
      { title: "关注 · AI Radar" },
      { name: "description", content: "管理你关注的 AI 实体、提醒强度与兴趣画像。" },
      { property: "og:title", content: "AI Radar · 关注" },
      { property: "og:description", content: "关注对象、提醒强度、兴趣画像。" },
    ],
  }),
  component: FollowingPage,
});

const INTENSITY_META = {
  silent: {
    icon: BellOff,
    zh: "静默",
    en: "Silent",
    desc: { zh: "只在实体页手动查看，不进入信息流。", en: "View manually only." },
  },
  digest: {
    icon: Bell,
    zh: "摘要",
    en: "Digest",
    desc: { zh: "每周汇总，重要更新才提醒。", en: "Weekly digest of important updates." },
  },
  instant: {
    icon: Zap,
    zh: "即时",
    en: "Instant",
    desc: {
      zh: "重大变化与传闻立即出现在首页。",
      en: "Major changes show up on the home immediately.",
    },
  },
} as const;

function FollowingPage() {
  const token = readAuthToken();
  return token && userApi.configured ? (
    <AuthenticatedFollowingPage token={token} />
  ) : (
    <DemoFollowingPage />
  );
}

function AuthenticatedFollowingPage({ token }: { token: string }) {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [follows, setFollows] = useState<RemoteFollowItem[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [error, setError] = useState("");
  const [busyEntityId, setBusyEntityId] = useState("");

  const refresh = useCallback(async () => {
    const [nextUser, nextFollows, nextNotifications] = await Promise.all([
      userApi.me(token),
      userApi.following(token),
      userApi.notifications(token),
    ]);
    setUser(nextUser);
    setFollows(nextFollows);
    setNotifications(nextNotifications);
  }, [token]);

  useEffect(() => {
    void refresh().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Unable to load account data."),
    );
  }, [refresh]);

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t("关注列表加载失败", "Following failed to load")}
          description={t("请稍后重试。", "Please retry shortly.")}
          onRetry={() => void snapshotQuery.refetch()}
        />
      </AppShell>
    );
  }

  const entities = snapshotQuery.data.entities;
  const findEntity = (id: string) => entities.find((entity) => entity.id === id);
  const followedEntityIds = new Set(follows.map((item) => item.entityId));
  const suggestions = entities
    .filter((entity) => !followedEntityIds.has(entity.id) && entity.type !== "company")
    .slice(0, 6);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  const updateFollow = async (entityId: string, intensity: RemoteFollowItem["intensity"]) => {
    setBusyEntityId(entityId);
    setError("");
    try {
      await userApi.follow(token, entityId, intensity);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save follow.");
    } finally {
      setBusyEntityId("");
    }
  };

  const removeFollow = async (follow: RemoteFollowItem) => {
    setBusyEntityId(follow.entityId);
    setError("");
    try {
      await userApi.unfollow(token, follow.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove follow.");
    } finally {
      setBusyEntityId("");
    }
  };

  const markAllRead = async () => {
    setError("");
    try {
      await Promise.all(
        notifications
          .filter((notification) => !notification.readAt)
          .map((notification) => userApi.markRead(token, notification.id)),
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update notifications.");
    }
  };

  return (
    <AppShell>
      <PageHeader
        title={t("关注与通知", "Following & notifications")}
        subtitle={t(
          "这些关注和通知已保存到你的账户，可跨设备访问。",
          "These follows and notifications are saved to your account and available across devices.",
        )}
      />
      <div className="page-container grid min-w-0 gap-8 pb-12 pt-3 lg:grid-cols-3">
        <div className="min-w-0 space-y-7 lg:col-span-2">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <section className="space-y-3" aria-labelledby="notification-inbox-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Inbox className="h-4 w-4 text-signal" />
                <h2 id="notification-inbox-title" className="font-serif text-xl font-semibold">
                  {t("站内通知", "In-app notifications")}
                </h2>
                <span className="rounded-full bg-signal/10 px-2 py-0.5 text-xs font-medium text-signal">
                  {t(`${unreadCount} 条未读`, `${unreadCount} unread`)}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!unreadCount}
                onClick={() => void markAllRead()}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t("全部标为已读", "Mark all read")}
              </Button>
            </div>
            <div className="paper-card divide-y divide-border">
              {notifications.map((notification) => {
                const entity = findEntity(notification.entityId);
                if (!entity) return null;
                return (
                  <Link
                    key={notification.id}
                    to="/knowledge/$type/$slug"
                    params={{ type: entity.type, slug: entity.slug }}
                    onClick={() => {
                      if (!notification.readAt)
                        void userApi.markRead(token, notification.id).then(refresh);
                    }}
                    className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-accent/50"
                  >
                    <span
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.readAt ? "bg-border" : "bg-signal"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          {pick(entity.name, lang)}
                        </span>
                        {notification.priority === "important" && (
                          <span className="chip">{t("重要", "Important")}</span>
                        )}
                        <time className="ml-auto text-xs text-muted-foreground">
                          {notification.createdAt.slice(0, 10)}
                        </time>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {notification.title}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                  </Link>
                );
              })}
              {!notifications.length && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {t("当前没有站内通知。", "No in-app notifications yet.")}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold">
                {t("关注对象", "You follow")}{" "}
                <span className="ml-2 font-sans text-base font-normal text-muted-foreground">
                  {follows.length}
                </span>
              </h2>
              <Link
                to="/onboarding"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-accent"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> {t("编辑兴趣", "Edit interests")}
              </Link>
            </div>
            <div className="paper-card divide-y divide-border">
              {follows.map((follow) => {
                const entity = findEntity(follow.entityId);
                if (!entity) return null;
                return (
                  <div key={follow.id} className="flex min-w-0 flex-wrap items-center gap-4 p-5">
                    <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                      <Link
                        to="/knowledge/$type/$slug"
                        params={{ type: entity.type, slug: entity.slug }}
                        className="font-serif text-lg font-semibold text-foreground hover:text-signal"
                      >
                        {pick(entity.name, lang)}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {pick(ENTITY_TYPE_LABELS[entity.type], lang)} ·{" "}
                        {t("关注已同步到你的账户", "Saved to your account")}
                      </p>
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-3 items-center gap-1 rounded-md border border-border bg-muted/40 p-1 sm:flex sm:flex-none">
                      {(["silent", "digest", "instant"] as const).map((kind) => {
                        const Icon = INTENSITY_META[kind].icon;
                        const active = follow.intensity === kind;
                        return (
                          <button
                            key={kind}
                            type="button"
                            disabled={busyEntityId === follow.entityId}
                            onClick={() => void updateFollow(follow.entityId, kind)}
                            className={`inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded px-1 text-xs sm:px-2 ${active ? "bg-signal text-signal-foreground" : "text-ink-soft hover:text-foreground"}`}
                            title={pick(INTENSITY_META[kind].desc, lang)}
                          >
                            <Icon className="h-3.5 w-3.5" />{" "}
                            {lang === "zh" ? INTENSITY_META[kind].zh : INTENSITY_META[kind].en}
                          </button>
                        );
                      })}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("取消关注", "Unfollow")}
                      disabled={busyEntityId === follow.entityId}
                      onClick={() => void removeFollow(follow)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                );
              })}
              {!follows.length && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {t("你还没有关注任何对象。", "You do not follow anything yet.")}
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-serif text-xl font-semibold">
              {t("你可能感兴趣", "You might like")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {suggestions.map((entity) => (
                <div key={entity.id} className="paper-card flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {pick(entity.name, lang)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pick(ENTITY_TYPE_LABELS[entity.type], lang)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyEntityId === entity.id}
                    onClick={() => void updateFollow(entity.id, "digest")}
                  >
                    + {t("关注", "Follow")}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="paper-card p-5">
            <h3 className="font-serif font-semibold">
              {t("账户通知设置", "Account notification settings")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t(
                "每日摘要偏好已保存在账户中；邮件服务配置完成前，内容会安全停留在发件队列。",
                "Daily digest preferences are stored in your account; messages remain safely queued until email delivery is configured.",
              )}
            </p>
            {user && (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={user.dailyDigestEnabled}
                  onChange={(event) =>
                    void userApi
                      .preferences(token, event.target.checked, user.digestHour)
                      .then(setUser)
                      .catch((reason: unknown) =>
                        setError(
                          reason instanceof Error ? reason.message : "Unable to save preferences.",
                        ),
                      )
                  }
                />{" "}
                {t("启用每日摘要", "Enable daily digest")}
              </label>
            )}
            {user && (
              <Input
                className="mt-3"
                type="time"
                value={user.digestHour}
                onChange={(event) =>
                  void userApi
                    .preferences(token, user.dailyDigestEnabled, event.target.value)
                    .then(setUser)
                    .catch((reason: unknown) =>
                      setError(
                        reason instanceof Error ? reason.message : "Unable to save preferences.",
                      ),
                    )
                }
              />
            )}
          </div>
          <div className="paper-card bg-accent/40 p-5">
            <h3 className="font-serif font-semibold">{t("下一步", "Next")}</h3>
            <Link
              to="/"
              className="mt-2 inline-flex items-center gap-1 text-sm text-signal hover:underline"
            >
              {t("回到首页看今日更新", "Back to today's updates")}{" "}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function DemoFollowingPage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const [items, setItems] = useState<FollowPreference[]>([]);
  const [personalization, setPersonalization] = useState<PersonalizationPreferences | null>(null);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current || !snapshotQuery.data) return;
    const storedPersonalization = readPersonalization(snapshotQuery.data.interestProfile);
    const storedFollowing = readFollowing(snapshotQuery.data.following);
    const selectedFromOnboarding = storedPersonalization.selectedEntityIds
      .filter((id) => !storedFollowing.some((item) => item.entityId === id))
      .map<FollowPreference>((entityId) => ({
        entityId,
        intensity: "digest",
        addedAt: new Date().toISOString().slice(0, 10),
        reason: { zh: "兴趣初始化中选择", en: "Selected during onboarding" },
      }));
    setItems([...storedFollowing, ...selectedFromOnboarding]);
    setPersonalization(storedPersonalization);
    setNotificationPreferences(readNotificationPreferences());
    hydrated.current = true;
    setStorageReady(true);
  }, [snapshotQuery.data]);

  useEffect(() => {
    if (!storageReady) return;
    writeFollowing(items);
  }, [items, storageReady]);

  useEffect(() => {
    if (!storageReady || !personalization) return;
    writePersonalization(personalization);
  }, [personalization, storageReady]);

  useEffect(() => {
    if (!storageReady || !notificationPreferences) return;
    writeNotificationPreferences(notificationPreferences);
  }, [notificationPreferences, storageReady]);

  const setIntensity = (id: string, intensity: FollowPreference["intensity"]) => {
    setItems((prev) => prev.map((it) => (it.entityId === id ? { ...it, intensity } : it)));
  };
  const remove = (id: string) => setItems((prev) => prev.filter((it) => it.entityId !== id));

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "关注列表加载失败" : "正在加载关注列表",
            snapshotQuery.error ? "Following failed to load" : "Loading following",
          )}
          description={t("请稍后重试。", "Please retry shortly.")}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }

  const entities = snapshotQuery.data.entities;
  const findEntity = (id: string) => entities.find((entity) => entity.id === id);
  const suggestions = entities
    .filter((e) => !items.some((it) => it.entityId === e.id) && e.type !== "company")
    .slice(0, 6);
  const notifications = snapshotQuery.data.notifications;
  const readNotificationIds = notificationPreferences?.readNotificationIds ?? [];
  const unreadCount = notifications.filter(
    (notification) => !notification.readAt && !readNotificationIds.includes(notification.id),
  ).length;
  const markNotificationRead = (notificationId: string) =>
    setNotificationPreferences((current) =>
      current && !current.readNotificationIds.includes(notificationId)
        ? {
            ...current,
            readNotificationIds: [...current.readNotificationIds, notificationId],
          }
        : current,
    );
  const markAllNotificationsRead = () =>
    setNotificationPreferences((current) =>
      current
        ? {
            ...current,
            readNotificationIds: Array.from(
              new Set([
                ...current.readNotificationIds,
                ...notifications.map((notification) => notification.id),
              ]),
            ),
          }
        : current,
    );

  return (
    <AppShell>
      <PageHeader
        title={t("关注与通知", "Following & notifications")}
        subtitle={t(
          "定义你希望在首页看到什么。每个对象都可以选择静默、摘要或即时三种提醒强度。",
          "Define what shows up on your home. Each item supports silent, digest or instant alerts.",
        )}
      />
      <div className="page-container grid min-w-0 gap-8 pb-12 pt-3 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <section className="space-y-3" aria-labelledby="notification-inbox-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Inbox className="h-4 w-4 text-signal" />
                <h2 id="notification-inbox-title" className="font-serif text-xl font-semibold">
                  {t("站内通知", "In-app notifications")}
                </h2>
                <span className="rounded-full bg-signal/10 px-2 py-0.5 text-xs font-medium text-signal">
                  {t(`${unreadCount} 条未读`, `${unreadCount} unread`)}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!unreadCount}
                onClick={markAllNotificationsRead}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t("全部标为已读", "Mark all read")}
              </Button>
            </div>
            <div className="paper-card divide-y divide-border">
              {notifications.map((notification) => {
                const entity = findEntity(notification.entityId);
                const change = snapshotQuery.data!.changes.find(
                  (item) => item.id === notification.changeId,
                );
                if (!entity || !change) return null;
                const isRead =
                  Boolean(notification.readAt) || readNotificationIds.includes(notification.id);
                return (
                  <Link
                    key={notification.id}
                    to="/knowledge/$type/$slug"
                    params={{ type: entity.type, slug: entity.slug }}
                    onClick={() => markNotificationRead(notification.id)}
                    className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-accent/50"
                  >
                    <span
                      className={
                        "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
                        (isRead ? "bg-border" : "bg-signal")
                      }
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          {pick(entity.name, lang)}
                        </span>
                        {notification.priority === "important" && (
                          <span className="chip">{t("重要", "Important")}</span>
                        )}
                        <time className="ml-auto text-xs text-muted-foreground">
                          {notification.createdAt.slice(0, 10)}
                        </time>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {pick(change.summary, lang)}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                  </Link>
                );
              })}
              {!notifications.length && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {t("当前没有站内通知。", "No in-app notifications yet.")}
                </div>
              )}
            </div>
          </section>

          <div className="pt-4 flex items-center justify-between">
            <h2 className="font-serif text-xl font-semibold">
              {t("关注对象", "You follow")}{" "}
              <span className="text-muted-foreground text-base font-sans font-normal ml-2">
                {items.length}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <DemoBadge />
              <Link
                to="/onboarding"
                className="hidden h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-accent sm:inline-flex"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t("重新设置兴趣", "Edit interests")}
              </Link>
            </div>
          </div>

          <div className="paper-card divide-y divide-border">
            {items.map((it) => {
              const e = findEntity(it.entityId);
              if (!e) return null;
              return (
                <div key={it.entityId} className="flex min-w-0 flex-wrap items-center gap-4 p-5">
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        to="/knowledge/$type/$slug"
                        params={{ type: e.type, slug: e.slug }}
                        className="font-serif text-lg font-semibold text-foreground hover:text-signal"
                      >
                        {pick(e.name, lang)}
                      </Link>
                      <span className="chip">{pick(ENTITY_TYPE_LABELS[e.type], lang)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("关注理由", "Reason")}: {pick(it.reason, lang)} · {t("加入于", "Since")}{" "}
                      {it.addedAt}
                    </p>
                  </div>

                  <div className="grid min-w-0 flex-1 grid-cols-3 items-center gap-1 rounded-md border border-border bg-muted/40 p-1 sm:flex sm:flex-none">
                    {(["silent", "digest", "instant"] as const).map((k) => {
                      const Icon = INTENSITY_META[k].icon;
                      const active = it.intensity === k;
                      return (
                        <button
                          key={k}
                          onClick={() => setIntensity(it.entityId, k)}
                          className={
                            "inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded px-1 text-xs sm:px-2 " +
                            (active
                              ? "bg-signal text-signal-foreground"
                              : "text-ink-soft hover:text-foreground")
                          }
                          title={pick(INTENSITY_META[k].desc, lang)}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {lang === "zh" ? INTENSITY_META[k].zh : INTENSITY_META[k].en}
                        </button>
                      );
                    })}
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Unfollow"
                    onClick={() => remove(it.entityId)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              );
            })}
            {!items.length && (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {t(
                    "你还没有关注任何对象。可以从下方推荐中添加，或重新设置兴趣。",
                    "You do not follow anything yet. Add a suggestion or edit your interests.",
                  )}
                </p>
                <Link
                  to="/onboarding"
                  className="mt-3 inline-flex text-sm font-medium text-signal hover:underline"
                >
                  {t("开始兴趣初始化", "Start onboarding")} →
                </Link>
              </div>
            )}
          </div>

          <section className="mt-8">
            <h2 className="font-serif text-xl font-semibold mb-3">
              {t("你可能感兴趣", "You might like")}
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {suggestions.map((e) => (
                <div key={e.id} className="paper-card p-4 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground truncate">{pick(e.name, lang)}</div>
                    <div className="text-xs text-muted-foreground">
                      {pick(ENTITY_TYPE_LABELS[e.type], lang)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setItems((p) => [
                        ...p,
                        {
                          entityId: e.id,
                          intensity: "digest",
                          addedAt: new Date().toISOString().slice(0, 10),
                          reason: { zh: "手动添加", en: "Manually added" },
                        },
                      ])
                    }
                  >
                    + {t("关注", "Follow")}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="paper-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-serif font-semibold">{t("兴趣画像", "Interest profile")}</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {personalization?.updatedAt
                    ? t(
                        `本机更新于 ${personalization.updatedAt.slice(0, 10)}`,
                        `Updated on this device ${personalization.updatedAt.slice(0, 10)}`,
                      )
                    : t("来自演示快照", "From demo snapshot")}
                </p>
              </div>
              <Link
                to="/onboarding"
                className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("编辑兴趣", "Edit interests")}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Link>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t(
                "系统根据你的关注、浏览与提问自动总结你的兴趣，也可以手动修正。",
                "Auto-derived from what you follow, browse and ask; you can override anything.",
              )}
            </p>
            <div className="space-y-3">
              {(personalization?.interests ?? snapshotQuery.data.interestProfile).map((item) => (
                <div key={item.id}>
                  <div className="flex items-center justify-between gap-2 text-xs mb-1">
                    <span className="text-foreground">{pick(item.label, lang)}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground font-mono">{item.score}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPersonalization((current) =>
                            current
                              ? {
                                  ...current,
                                  interests: current.interests.filter(
                                    (interest) => interest.id !== item.id,
                                  ),
                                }
                              : current,
                          )
                        }
                        className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={t(
                          `移除兴趣 ${pick(item.label, lang)}`,
                          `Remove interest ${pick(item.label, lang)}`,
                        )}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-signal" style={{ width: `${item.score}%` }} />
                  </div>
                </div>
              ))}
              {!(personalization?.interests ?? snapshotQuery.data.interestProfile).length && (
                <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  {t(
                    "兴趣画像已清空，首页仍会保留全行业重要事件。",
                    "Your profile is empty; major industry events remain visible.",
                  )}
                </p>
              )}
            </div>
            <div className="mt-5 flex items-start justify-between gap-3 border-t border-border pt-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t("行为学习", "Behavior learning")}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t(
                    "暂停后不再根据浏览行为调整画像。",
                    "Pause to stop adapting from browsing behavior.",
                  )}
                </p>
              </div>
              <Switch
                checked={personalization?.behaviorLearning ?? false}
                onCheckedChange={(behaviorLearning) =>
                  setPersonalization((current) =>
                    current ? { ...current, behaviorLearning } : current,
                  )
                }
                aria-label={t("行为学习", "Behavior learning")}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setPersonalization((current) =>
                    current ? { ...current, interests: [] } : current,
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("清空画像", "Clear profile")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setPersonalization(readPersonalization(snapshotQuery.data!.interestProfile))
                }
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("重新读取本机设置", "Reload device settings")}
              </Button>
            </div>
          </div>

          <div className="paper-card p-5 bg-accent/40">
            <h3 className="font-serif font-semibold mb-2">{t("下一步", "Next")}</h3>
            <Link
              to="/"
              className="text-sm text-signal hover:underline inline-flex items-center gap-1"
            >
              {t("回到首页看今日更新", "Back to today's updates")}{" "}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="paper-card p-5">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-signal" />
              <h3 className="font-serif font-semibold">
                {t("每日邮件摘要", "Daily email digest")}
              </h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t(
                "保存希望接收摘要的邮箱与时间。当前仅保存本机偏好，邮件投递服务尚未接入。",
                "Save the address and time you prefer. This demo stores settings locally; delivery is not connected.",
              )}
            </p>
            <div className="mt-4 flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="daily-email-enabled">{t("启用每日摘要", "Enable digest")}</Label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("仅用于前端交互验收", "For frontend interaction validation only")}
                </p>
              </div>
              <Switch
                id="daily-email-enabled"
                checked={notificationPreferences?.dailyEmailEnabled ?? false}
                onCheckedChange={(dailyEmailEnabled) =>
                  setNotificationPreferences((current) =>
                    current ? { ...current, dailyEmailEnabled } : current,
                  )
                }
              />
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <Label htmlFor="digest-email">{t("接收邮箱", "Email address")}</Label>
                <Input
                  id="digest-email"
                  type="email"
                  className="mt-1.5"
                  value={notificationPreferences?.email ?? ""}
                  placeholder="you@example.com"
                  disabled={!notificationPreferences?.dailyEmailEnabled}
                  onChange={(event) =>
                    setNotificationPreferences((current) =>
                      current ? { ...current, email: event.target.value } : current,
                    )
                  }
                />
              </div>
              <div>
                <Label htmlFor="digest-hour">{t("发送时间", "Delivery time")}</Label>
                <Input
                  id="digest-hour"
                  type="time"
                  className="mt-1.5"
                  value={notificationPreferences?.digestHour ?? "08:00"}
                  disabled={!notificationPreferences?.dailyEmailEnabled}
                  onChange={(event) =>
                    setNotificationPreferences((current) =>
                      current ? { ...current, digestHour: event.target.value } : current,
                    )
                  }
                />
              </div>
            </div>
            <p className="mt-3 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              {notificationPreferences?.dailyEmailEnabled && notificationPreferences.email.trim()
                ? t(
                    `已在本机保存：每天 ${notificationPreferences.digestHour} 发送至 ${notificationPreferences.email.trim()}。尚未产生真实邮件。`,
                    `Saved on this device: ${notificationPreferences.digestHour} to ${notificationPreferences.email.trim()}. No real email is sent yet.`,
                  )
                : t(
                    "启用后填写邮箱即可预览完整设置状态。",
                    "Enable the digest and enter an address to preview the configured state.",
                  )}
            </p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
