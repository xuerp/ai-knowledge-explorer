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
          <span>AI Radar V2 · AI 研究工作台</span>
          <span>部分页面包含示例内容；重要决策请核对数据状态、日期与原始来源。</span>
        </div>
      </footer>
    </div>
  );
}
