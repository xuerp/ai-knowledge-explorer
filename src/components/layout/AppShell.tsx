import { type ReactNode } from "react";
import { TopNav } from "./TopNav";
import { BottomNav } from "./BottomNav";

export function AppShell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <div
      className={
        "min-h-screen flex flex-col " +
        (dark ? "bg-graph-bg text-foreground" : "bg-background text-foreground")
      }
    >
      <TopNav dark={dark} />
      <main className="flex-1 pb-24 md:pb-8">{children}</main>
      <BottomNav />
      <footer className="hidden md:block border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-6 text-xs text-muted-foreground flex flex-wrap gap-4 justify-between">
          <span>AI Radar · 演示数据版本 · Demo build</span>
          <span>所有事实、评分与关系均标记为演示数据（Demo data），不代表真实产品结论。</span>
        </div>
      </footer>
    </div>
  );
}
