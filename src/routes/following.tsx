import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Zap, ArrowRight, Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import type { FollowPreference } from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { Button } from "@/components/ui/button";

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
  const initialFollowing = snapshotQuery.data?.following;
  const [items, setItems] = useState<FollowPreference[]>(() => initialFollowing ?? []);
  const hydrated = useRef(Boolean(initialFollowing));

  useEffect(() => {
    if (hydrated.current || !snapshotQuery.data) return;
    setItems(snapshotQuery.data.following);
    hydrated.current = true;
  }, [snapshotQuery.data]);

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
            <DemoBadge />
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
            <h3 className="font-serif font-semibold mb-3">{t("兴趣画像", "Interest profile")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t(
                "系统根据你的关注、浏览与提问自动总结你的兴趣，也可以手动修正。",
                "Auto-derived from what you follow, browse and ask; you can override anything.",
              )}
            </p>
            <div className="space-y-3">
              {snapshotQuery.data.interestProfile.map((item) => (
                <div key={item.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-foreground">{pick(item.label, lang)}</span>
                    <span className="text-muted-foreground font-mono">{item.score}</span>
                  </div>
                  <div className="h-1.5 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-signal" style={{ width: `${item.score}%` }} />
                  </div>
                </div>
              ))}
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
