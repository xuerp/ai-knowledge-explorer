import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
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
          <span>{t("AI Radar · 模型与产品选型研究", "AI Radar · Model and product research")}</span>
          <nav className="flex gap-5" aria-label={t("页脚导航", "Footer navigation")}>
            <Link className="hover:text-foreground" to="/case-study">
              {t("项目介绍", "About")}
            </Link>
            <Link className="hover:text-foreground" to="/quality">
              {t("数据与方法", "Data and methodology")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
