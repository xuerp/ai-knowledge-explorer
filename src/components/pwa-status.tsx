import { useEffect, useState } from "react";
import { Check, CloudOff, Download, RefreshCw, X } from "lucide-react";
import { useApp } from "@/lib/app-state";

const LAST_ONLINE_KEY = "ai-radar.last-online-at";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaStatus({ dark = false }: { dark?: boolean }) {
  const { t, lang } = useApp();
  const [online, setOnline] = useState(true);
  const [lastOnlineAt, setLastOnlineAt] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const updateNetwork = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (isOnline) {
        const now = new Date().toISOString();
        window.localStorage.setItem(LAST_ONLINE_KEY, now);
        setLastOnlineAt(now);
      } else {
        setLastOnlineAt(window.localStorage.getItem(LAST_ONLINE_KEY));
      }
    };
    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    return () => {
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  if (!online) {
    return (
      <div
        role="status"
        className={`sticky top-14 z-20 border-b px-4 py-2 text-xs ${
          dark
            ? "border-white/10 bg-graph-surface text-white/80"
            : "border-inferred/30 bg-inferred/10 text-foreground"
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
          <CloudOff className="h-4 w-4 text-inferred" />
          <span className="font-medium">{t("离线浏览", "Offline browsing")}</span>
          <span className={dark ? "text-white/55" : "text-muted-foreground"}>
            {lastOnlineAt
              ? t(
                  `最后缓存：${new Date(lastOnlineAt).toLocaleString("zh-CN")}`,
                  `Last cached: ${new Date(lastOnlineAt).toLocaleString("en-US")}`,
                )
              : t("当前设备没有缓存时间记录", "No cache timestamp on this device")}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ml-auto inline-flex items-center gap-1 font-medium hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("重试", "Retry")}
          </button>
        </div>
      </div>
    );
  }

  if ((!installPrompt && !installed) || dismissed) return null;
  return (
    <div className="print-hidden fixed bottom-20 right-4 z-30 max-w-xs rounded-xl border border-border bg-card p-3 shadow-xl md:bottom-5">
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent"
        aria-label={t("关闭安装提示", "Dismiss install prompt")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3 pr-7">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-signal/10 text-signal">
          {installed ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        </span>
        <div>
          <div className="text-sm font-medium text-foreground">
            {installed
              ? t("AI Radar 已安装", "AI Radar installed")
              : t("安装 AI Radar", "Install AI Radar")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {installed
              ? t("可从设备主屏幕打开。", "Open it from your home screen.")
              : t(
                  "获得独立窗口和已访问页面的离线缓存。",
                  "Get a standalone window and offline caching for visited pages.",
                )}
          </p>
          {!installed && (
            <button
              type="button"
              onClick={install}
              className="mt-2 text-xs font-medium text-signal hover:underline"
            >
              {lang === "zh" ? "立即安装" : "Install now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
