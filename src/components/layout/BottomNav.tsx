import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Library, Radar, Sparkles, GitCompareArrows } from "lucide-react";
import { useApp } from "@/lib/app-state";

const NAV = [
  { to: "/", icon: Home, zh: "首页", en: "Home" },
  { to: "/knowledge", icon: Library, zh: "知识库", en: "Knowledge" },
  { to: "/compare", icon: GitCompareArrows, zh: "对比", en: "Compare" },
  { to: "/graph", icon: Radar, zh: "洞察", en: "Insights" },
  { to: "/ask", icon: Sparkles, zh: "研究", en: "Ask" },
] as const;

export function BottomNav() {
  const { t } = useApp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur">
      <ul className="grid grid-cols-5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            item.to === "/"
              ? pathname === "/"
              : pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={
                  "flex flex-col items-center justify-center gap-1 py-2 text-[11px] " +
                  (active ? "text-signal" : "text-muted-foreground")
                }
              >
                <Icon className="h-5 w-5" />
                {t(item.zh, item.en)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
