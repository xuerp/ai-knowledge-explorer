import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Library, Network, Sparkles } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { useKnowledgeReturn } from "@/hooks/use-knowledge-return";

const NAV = [
  { to: "/updates", icon: Activity, zh: "动态", en: "Updates" },
  { to: "/knowledge", icon: Library, zh: "知识库", en: "Knowledge" },
  { to: "/ask", icon: Sparkles, zh: "决策", en: "Decide" },
  { to: "/graph", icon: Network, zh: "图谱", en: "Graph" },
] as const;

export function BottomNav() {
  const knowledgeReturn = useKnowledgeReturn();
  const { t } = useApp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card md:hidden">
      <ul className="grid grid-cols-4">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                search={item.to === "/knowledge" ? knowledgeReturn.search : undefined}
                hash={item.to === "/knowledge" ? knowledgeReturn.hash : undefined}
                className={
                  "relative flex flex-col items-center justify-center gap-1 py-2 text-[11px] " +
                  (active
                    ? "font-medium text-signal before:absolute before:left-1/2 before:top-0 before:h-0.5 before:w-7 before:-translate-x-1/2 before:bg-signal"
                    : "text-muted-foreground")
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
