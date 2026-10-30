import { type ReactNode } from "react";

import { type ProductionReadinessCheck } from "@/services/admin-api";

export function DiagnosticCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function QueueMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

export function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: "idle" | "running" | "succeeded" | "partial" | "failed";
}) {
  const className =
    status === "succeeded"
      ? "bg-verified/10 text-verified"
      : status === "running"
        ? "bg-inferred/10 text-inferred"
        : status === "partial"
          ? "bg-unverified/10 text-unverified"
          : status === "failed"
            ? "bg-conflict/10 text-conflict"
            : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-xs ${className}`}>{label}</span>;
}

export function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="paper-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 font-serif text-3xl font-semibold">{value}</div>
    </div>
  );
}

export function QualityMetric({
  label,
  value,
  threshold,
}: {
  label: string;
  value: number;
  threshold: string;
}) {
  return (
    <div className="rounded-lg border border-amber-400/30 bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{Math.round(value * 100)}%</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{threshold}</div>
    </div>
  );
}

export function IntegrationCard({
  title,
  ready,
  detail,
  action,
}: {
  title: string;
  ready: boolean;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            ready ? "bg-verified/10 text-verified" : "bg-unverified/10 text-unverified"
          }`}
        >
          {ready ? "已配置" : "待配置"}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{detail}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ReadinessCard({ check }: { check: ProductionReadinessCheck }) {
  const label =
    check.status === "ready"
      ? "通过"
      : check.status === "blocked"
        ? "阻塞"
        : check.status === "warning"
          ? "警告"
          : "人工确认";
  const tone =
    check.status === "ready"
      ? "bg-verified/10 text-verified"
      : check.status === "blocked"
        ? "bg-conflict/10 text-conflict"
        : "bg-unverified/10 text-unverified";
  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium">{check.title}</h3>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${tone}`}>{label}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{check.detail}</p>
      {check.action && <p className="mt-2 text-xs leading-5">下一步：{check.action}</p>}
    </article>
  );
}

export function Notice({
  title,
  detail,
  destructive = false,
}: {
  title: string;
  detail: string;
  destructive?: boolean;
}) {
  return (
    <div
      className={`mx-auto my-8 max-w-3xl rounded-lg border p-5 ${destructive ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}
    >
      <h2 className="font-medium">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export function DataList({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: ReactNode;
  rows: { key: string; title: string; detail: string }[];
}) {
  return (
    <section className="paper-card p-5">
      <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
        {icon}
        {title}
      </h2>
      <div className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <div key={row.key} className="py-3">
            <div className="text-sm font-medium">{row.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{row.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
