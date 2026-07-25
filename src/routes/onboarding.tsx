import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DataStatePanel } from "@/components/data-state";
import { DemoBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useApp, pick } from "@/lib/app-state";
import {
  readPersonalization,
  writePersonalization,
  type PersonalizationPreferences,
} from "@/lib/personalization";
import type { Entity, InterestProfileItem, KnowledgeSnapshot } from "@/domain/types";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "兴趣初始化 · AI Radar" },
      {
        name: "description",
        content: "通过关注对象、方向标签和自然语言描述建立可控的 AI Radar 兴趣画像。",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: OnboardingPage,
});

const TOPICS = [
  { id: "multimodal", zh: "多模态", en: "Multimodal" },
  { id: "agents", zh: "Agent", en: "Agents" },
  { id: "coding", zh: "编程", en: "Coding" },
  { id: "reasoning", zh: "推理", en: "Reasoning" },
  { id: "open-source", zh: "开源生态", en: "Open source" },
  { id: "video", zh: "视频生成", en: "Video generation" },
  { id: "evaluation", zh: "评测", en: "Evaluation" },
  { id: "product", zh: "产品机会", en: "Product opportunities" },
] as const;

function OnboardingPage() {
  const { t } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "初始化数据加载失败" : "正在准备兴趣初始化",
            snapshotQuery.error ? "Onboarding data failed to load" : "Preparing onboarding",
          )}
          description={t(
            "兴趣设置只会在本机保存。",
            "Interest settings are stored on this device only.",
          )}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }
  return <OnboardingWizard snapshot={snapshotQuery.data} />;
}

function OnboardingWizard({ snapshot }: { snapshot: KnowledgeSnapshot }) {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [preferences, setPreferences] = useState<PersonalizationPreferences>(() =>
    readPersonalization(snapshot.interestProfile),
  );
  const candidates = snapshot.entities.filter((entity) =>
    ["model", "agent", "framework"].includes(entity.type),
  );

  const toggleEntity = (id: string) =>
    setPreferences((current) => ({
      ...current,
      selectedEntityIds: current.selectedEntityIds.includes(id)
        ? current.selectedEntityIds.filter((value) => value !== id)
        : [...current.selectedEntityIds, id],
    }));
  const toggleTopic = (id: string) =>
    setPreferences((current) => ({
      ...current,
      topics: current.topics.includes(id)
        ? current.topics.filter((value) => value !== id)
        : [...current.topics, id],
    }));

  const generatedInterests = useMemo(
    () => createInterestProfile(preferences, snapshot.interestProfile),
    [preferences, snapshot.interestProfile],
  );

  const complete = () => {
    writePersonalization({
      ...preferences,
      completed: true,
      interests: generatedInterests,
    });
    void navigate({ to: "/following" });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  return (
    <AppShell>
      <main className="min-h-[calc(100vh-3.5rem)] bg-background">
        <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
          <header className="mb-8">
            <div className="flex flex-wrap items-center gap-2">
              <DemoBadge />
              <span className="chip">{t("仅保存在当前设备", "Stored on this device only")}</span>
            </div>
            <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
              {t("建立你的 AI Radar", "Build your AI Radar")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              {t(
                "选择你关心的对象和方向，系统会优先展示相关变化；全行业重要事件仍会保留，避免形成过滤气泡。",
                "Choose entities and topics to prioritize relevant changes. Major industry events remain visible to avoid a filter bubble.",
              )}
            </p>
            <ol
              className="mt-6 grid grid-cols-3 gap-2"
              aria-label={t("初始化进度", "Onboarding progress")}
            >
              {[
                t("关注对象", "Entities"),
                t("兴趣方向", "Topics"),
                t("控制与确认", "Controls"),
              ].map((label, index) => {
                const number = index + 1;
                return (
                  <li
                    key={label}
                    className={`rounded-lg border p-3 ${
                      step === number
                        ? "border-signal bg-signal/5"
                        : number < step
                          ? "border-verified/30 bg-verified/5"
                          : "border-border"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-full ${
                          number < step
                            ? "bg-verified text-white"
                            : step === number
                              ? "bg-signal text-signal-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {number < step ? <Check className="h-3.5 w-3.5" /> : number}
                      </span>
                      <span className="hidden text-foreground sm:inline">{label}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </header>

          <section className="paper-card p-5 md:p-7">
            {step === 1 && (
              <EntityStep
                entities={candidates}
                selected={preferences.selectedEntityIds}
                onToggle={toggleEntity}
              />
            )}
            {step === 2 && (
              <TopicStep
                selected={preferences.topics}
                description={preferences.description}
                onToggle={toggleTopic}
                onDescriptionChange={(description) =>
                  setPreferences((current) => ({ ...current, description }))
                }
              />
            )}
            {step === 3 && (
              <ControlStep
                preferences={preferences}
                interests={generatedInterests}
                onLearningChange={(behaviorLearning) =>
                  setPreferences((current) => ({ ...current, behaviorLearning }))
                }
              />
            )}

            <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
              <Button
                type="button"
                variant="ghost"
                disabled={step === 1}
                onClick={() => setStep((current) => Math.max(1, current - 1))}
              >
                <ArrowLeft className="h-4 w-4" />
                {t("上一步", "Back")}
              </Button>
              {step < 3 ? (
                <Button type="button" onClick={() => setStep((current) => current + 1)}>
                  {t("继续", "Continue")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" onClick={complete}>
                  <Check className="h-4 w-4" />
                  {t("保存并查看关注", "Save and view following")}
                </Button>
              )}
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function EntityStep({
  entities,
  selected,
  onToggle,
}: {
  entities: Entity[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { t, lang } = useApp();
  return (
    <div>
      <StepHeading
        icon={<MousePointerClick className="h-5 w-5" />}
        title={t("先选择想长期追踪的对象", "Choose entities to track")}
        description={t(
          "可多选，也可以暂时跳过。稍后能在关注页随时修改。",
          "Select any number or skip for now. You can change this later.",
        )}
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((entity) => {
          const active = selected.includes(entity.id);
          return (
            <button
              key={entity.id}
              type="button"
              onClick={() => onToggle(entity.id)}
              aria-pressed={active}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active
                  ? "border-signal bg-signal/5"
                  : "border-border hover:border-signal/40 hover:bg-accent/30"
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span>
                  <span className="block font-serif text-lg font-semibold text-foreground">
                    {pick(entity.name, lang)}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {entity.vendor ?? entity.type}
                  </span>
                </span>
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border ${
                    active ? "border-signal bg-signal text-signal-foreground" : "border-border"
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5" />}
                </span>
              </span>
              <span className="mt-3 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                {pick(entity.summary, lang)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TopicStep({
  selected,
  description,
  onToggle,
  onDescriptionChange,
}: {
  selected: string[];
  description: string;
  onToggle: (id: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  const { t, lang } = useApp();
  return (
    <div>
      <StepHeading
        icon={<Sparkles className="h-5 w-5" />}
        title={t("定义关注方向", "Define your interests")}
        description={t(
          "标签用于快速初始化；自然语言描述能保留更具体的研究语境。",
          "Topics initialize quickly; natural language preserves more specific research context.",
        )}
      />
      <div className="mt-6 flex flex-wrap gap-2">
        {TOPICS.map((topic) => {
          const active = selected.includes(topic.id);
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => onToggle(topic.id)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-2 text-sm ${
                active
                  ? "border-signal bg-signal text-signal-foreground"
                  : "border-border text-foreground hover:border-signal/50"
              }`}
            >
              {lang === "zh" ? topic.zh : topic.en}
            </button>
          );
        })}
      </div>
      <label className="mt-7 block">
        <span className="text-sm font-medium text-foreground">
          {t("用一句话描述你最近在研究什么", "Describe what you are researching")}
        </span>
        <textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={4}
          maxLength={280}
          placeholder={t(
            "例如：关注能在本地运行、支持工具调用的开源 Agent 框架",
            "Example: Open-source agent frameworks that run locally and support tool use",
          )}
          className="mt-2 w-full resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-signal"
        />
        <span className="mt-1 block text-right font-mono text-[11px] text-muted-foreground">
          {description.length}/280
        </span>
      </label>
    </div>
  );
}

function ControlStep({
  preferences,
  interests,
  onLearningChange,
}: {
  preferences: PersonalizationPreferences;
  interests: InterestProfileItem[];
  onLearningChange: (value: boolean) => void;
}) {
  const { t, lang } = useApp();
  return (
    <div>
      <StepHeading
        icon={<ShieldCheck className="h-5 w-5" />}
        title={t("确认个性化边界", "Confirm personalization controls")}
        description={t(
          "个性化应当可解释、可暂停、可修改和可清空。",
          "Personalization must remain explainable, pausable, editable, and clearable.",
        )}
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Eye className="h-4 w-4 text-signal" />
                {t("根据浏览行为逐步学习", "Learn from browsing behavior")}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t(
                  "关闭后只使用你明确选择的关注对象、标签和描述。演示版不会上传行为数据。",
                  "When off, only explicit entities, topics, and description are used. The demo uploads no behavioral data.",
                )}
              </p>
            </div>
            <Switch
              checked={preferences.behaviorLearning}
              onCheckedChange={onLearningChange}
              aria-label={t("行为学习", "Behavior learning")}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border p-4">
          <div className="font-medium text-foreground">{t("画像预览", "Profile preview")}</div>
          <div className="mt-4 space-y-3">
            {interests.map((interest) => (
              <div key={interest.id}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{pick(interest.label, lang)}</span>
                  <span className="font-mono text-muted-foreground">{interest.score}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-signal"
                    style={{ width: `${interest.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 rounded-lg border border-inferred/30 bg-inferred/5 p-3 text-xs leading-relaxed text-muted-foreground">
        {t(
          `已选择 ${preferences.selectedEntityIds.length} 个对象、${preferences.topics.length} 个方向。保存后可在关注页查看推荐理由并清空画像。`,
          `${preferences.selectedEntityIds.length} entities and ${preferences.topics.length} topics selected. You can inspect recommendation reasons and clear the profile later.`,
        )}
      </div>
    </div>
  );
}

function StepHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-signal/10 text-signal">
        {icon}
      </span>
      <div>
        <h2 className="font-serif text-2xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function createInterestProfile(
  preferences: PersonalizationPreferences,
  fallback: InterestProfileItem[],
): InterestProfileItem[] {
  const topics = preferences.topics.map((id, index) => {
    const topic = TOPICS.find((item) => item.id === id)!;
    return {
      id: `interest-${id}`,
      label: { zh: topic.zh, en: topic.en },
      score: Math.max(55, 92 - index * 7),
    };
  });
  if (topics.length) return topics;
  return fallback;
}
