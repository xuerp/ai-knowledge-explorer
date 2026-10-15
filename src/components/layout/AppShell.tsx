import { useEffect, type ReactNode } from "react";
import { expireAuthSession, readAuthToken, rememberedAuthKey } from "@/services/auth-session";
import { TopNav } from "./TopNav";
import { BottomNav } from "./BottomNav";
import { PwaStatus } from "@/components/pwa-status";
import { useApp } from "@/lib/app-state";

export function AppShell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  const { t } = useApp();
  useEffect(() => {
    const syncLogout = (event: StorageEvent) => {
      if (event.key === rememberedAuthKey && !event.newValue && !readAuthToken())
        expireAuthSession();
    };
    window.addEventListener("storage", syncLogout);
    return () => window.removeEventListener("storage", syncLogout);
  }, []);

  return (
    <div
      className={
        "min-h-screen flex flex-col " +
        (dark ? "bg-graph-bg text-foreground" : "bg-background text-foreground")
      }
    >
      <TopNav />
      <PwaStatus dark={dark} />
      <main className="flex-1 pb-24 md:pb-8">{children}</main>
      <BottomNav />
      <footer className="hidden border-t border-border bg-card/70 md:block">
        <div className="page-container py-3 text-[11px] text-muted-foreground flex flex-wrap gap-4 justify-between">
          <span>{t("AI Radar V2 · AI 研究工作台", "AI Radar V2 · AI research workspace")}</span>
          <span>
            {t(
              "部分页面包含示例内容；重要决策请核对数据状态、日期与原始来源。",
              "Some pages contain sample content. Verify data status, dates, and original sources before making important decisions.",
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}
