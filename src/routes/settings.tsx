import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, BookOpen, Languages, LockKeyhole, Moon, Sun, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/common";
import { pick, useApp } from "@/lib/app-state";
import {
  readNotificationPreferences,
  writeNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/personalization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { READING_MODE_OPTIONS } from "@/domain/reading-mode";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "设置 · AI Radar" },
      { name: "description", content: "管理语言、阅读模式、主题、通知与隐私偏好。" },
    ],
  }),
  component: SettingsPage,
});

const SECTIONS = [
  { id: "language", zh: "语言", en: "Language" },
  { id: "reading", zh: "阅读模式", en: "Reading mode" },
  { id: "theme", zh: "主题", en: "Theme" },
  { id: "notifications", zh: "通知", en: "Notifications" },
  { id: "privacy", zh: "隐私", en: "Privacy" },
] as const;

function SettingsPage() {
  const { t, lang, setLang, mode, setMode, theme, setTheme } = useApp();
  const [notifications, setNotifications] = useState<NotificationPreferences | null>(null);

  useEffect(() => setNotifications(readNotificationPreferences()), []);
  useEffect(() => {
    if (notifications) writeNotificationPreferences(notifications);
  }, [notifications]);

  return (
    <AppShell>
      <PageHeader
        title={t("设置", "Settings")}
        subtitle={t(
          "你的界面和通知偏好仅保存在当前设备，可随时调整。",
          "Your interface and notification preferences are saved on this device.",
        )}
      />

      <div className="page-container grid gap-8 pb-12 pt-3 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden self-start rounded-lg border border-border bg-card p-2 md:sticky md:top-20 md:block">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t(section.zh, section.en)}
            </a>
          ))}
        </aside>

        <div className="min-w-0 space-y-6">
          <SettingSection
            id="language"
            icon={<Languages className="h-4 w-4" />}
            title={t("语言设置", "Language")}
            description={t("切换后整个界面即时更新。", "The full interface updates immediately.")}
          >
            <Segmented
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
              value={lang}
              onChange={(value) => setLang(value as typeof lang)}
            />
          </SettingSection>

          <SettingSection
            id="reading"
            icon={<BookOpen className="h-4 w-4" />}
            title={t("阅读模式", "Reading mode")}
            description={t(
              "同一份知识以不同深度呈现，不改变底层证据。",
              "Change explanation depth without changing the underlying evidence.",
            )}
          >
            <div className="grid gap-2">
              {READING_MODE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setMode(option.id)}
                  aria-pressed={mode === option.id}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                    mode === option.id
                      ? "border-signal bg-accent"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <span
                    className={`mt-0.5 h-4 w-4 rounded-full border-4 ${
                      mode === option.id
                        ? "border-signal bg-white"
                        : "border-border-strong bg-white"
                    }`}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {pick(option.label, lang)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {pick(option.description, lang)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </SettingSection>

          <SettingSection
            id="theme"
            icon={theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            title={t("主题", "Theme")}
            description={t(
              "浅色适合阅读，深色适合沉浸探索。",
              "Light for reading, dark for immersion.",
            )}
          >
            <Segmented
              options={[
                { value: "light", label: t("浅色", "Light") },
                { value: "dark", label: t("深色", "Dark") },
              ]}
              value={theme}
              onChange={(value) => setTheme(value as typeof theme)}
            />
          </SettingSection>

          <SettingSection
            id="notifications"
            icon={<Bell className="h-4 w-4" />}
            title={t("通知", "Notifications")}
            description={t(
              "控制重大版本变化和每日摘要提醒。",
              "Control major-change alerts and daily digests.",
            )}
          >
            <PreferenceRow
              label={t("站内通知", "In-app notifications")}
              description={t(
                "重大版本和能力变化时提醒。",
                "Alerts for major releases and capability changes.",
              )}
              checked={notifications?.inAppEnabled ?? true}
              onCheckedChange={(inAppEnabled) =>
                setNotifications((current) => (current ? { ...current, inAppEnabled } : current))
              }
            />
            <PreferenceRow
              label={t("每日邮件摘要", "Daily email digest")}
              description={t(
                "按设定时间汇总过去 24 小时变化。",
                "A 24-hour change digest at your chosen time.",
              )}
              checked={notifications?.dailyEmailEnabled ?? false}
              onCheckedChange={(dailyEmailEnabled) =>
                setNotifications((current) =>
                  current ? { ...current, dailyEmailEnabled } : current,
                )
              }
            />
            {notifications?.dailyEmailEnabled && (
              <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-[1fr_150px]">
                <div>
                  <Label htmlFor="settings-email">{t("接收邮箱", "Email")}</Label>
                  <Input
                    id="settings-email"
                    type="email"
                    className="mt-1.5"
                    value={notifications.email}
                    onChange={(event) =>
                      setNotifications((current) =>
                        current ? { ...current, email: event.target.value } : current,
                      )
                    }
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <Label htmlFor="settings-time">{t("发送时间", "Delivery time")}</Label>
                  <Input
                    id="settings-time"
                    type="time"
                    className="mt-1.5"
                    value={notifications.digestHour}
                    onChange={(event) =>
                      setNotifications((current) =>
                        current ? { ...current, digestHour: event.target.value } : current,
                      )
                    }
                  />
                </div>
              </div>
            )}
          </SettingSection>

          <SettingSection
            id="privacy"
            icon={<LockKeyhole className="h-4 w-4" />}
            title={t("隐私与账户", "Privacy and account")}
            description={t(
              "演示版本不会上传你的本机偏好。",
              "The demo does not upload your local preferences.",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <UserRound className="h-4 w-4 text-signal" />
                  {t("本机访客账户", "Local guest account")}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    "关注、设置与研究记录保存在浏览器中。",
                    "Follows, settings, and research stay in this browser.",
                  )}
                </p>
              </div>
              <Button variant="outline" asChild>
                <a href="/account">{t("账户详情", "Account details")}</a>
              </Button>
            </div>
          </SettingSection>
        </div>
      </div>
    </AppShell>
  );
}

function SettingSection({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-signal">{icon}</span>
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="paper-card space-y-4 p-5">{children}</div>
    </section>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-md px-4 text-sm ${
            value === option.value
              ? "bg-signal text-signal-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PreferenceRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
