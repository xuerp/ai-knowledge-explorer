import { type ReactNode } from "react";
import { TopNav } from "./TopNav";
import { BottomNav } from "./BottomNav";
import { PwaStatus } from "@/components/pwa-status";

export function AppShell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
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
          <span>在线 · 演示数据模式 · AI Radar V2</span>
          <span>所有事实、评分与关系均标记来源和可信度，不代表真实产品结论。</span>
        </div>
      </footer>
    </div>
  );
}
