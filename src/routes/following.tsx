import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Zap,
  ArrowRight,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
  X,
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
  readFollowing,
  readPersonalization,
  writeFollowing,
  writePersonalization,
  type PersonalizationPreferences,
} from "@/lib/personalization";

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
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const [items, setItems] = useState<FollowPreference[]>([]);
  const [personalization, setPersonalization] = useState<PersonalizationPreferences | null>(null);
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

  return (
    <AppShell>
      <PageHeader
        title={t("我的关注", "Following")}
        subtitle={t(
          "定义你希望在首页看到什么。每个对象都可以选择静默、摘要或即时三种提醒强度。",
          "Define what shows up on your home. Each item supports silent, digest or instant alerts.",
        )}
      />
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
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
                <div key={it.entityId} className="p-5 flex flex-wrap items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        to="/knowledge/model/$slug"
                        params={{ slug: e.slug }}
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

                  <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-muted/40">
                    {(["silent", "digest", "instant"] as const).map((k) => {
                      const Icon = INTENSITY_META[k].icon;
                      const active = it.intensity === k;
                      return (
                        <button
                          key={k}
                          onClick={() => setIntensity(it.entityId, k)}
                          className={
                            "inline-flex items-center gap-1 px-2 h-8 rounded text-xs " +
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

        <aside className="space-y-6">
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
        </aside>
      </div>
    </AppShell>
  );
}
