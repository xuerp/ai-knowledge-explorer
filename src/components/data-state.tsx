import { AlertTriangle, CloudOff, Database, LoaderCircle, RefreshCw } from "lucide-react";
import type { DataMeta, Freshness } from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { Button } from "@/components/ui/button";

type StateKind = "loading" | "empty" | "error" | "offline";

const STATE_ICON = {
  loading: LoaderCircle,
  empty: Database,
  error: AlertTriangle,
  offline: CloudOff,
} satisfies Record<StateKind, typeof LoaderCircle>;

export function DataStatePanel({
  kind,
  title,
  description,
  onRetry,
}: {
  kind: StateKind;
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const { t } = useApp();
  const Icon = STATE_ICON[kind];
  return (
    <div
      className="paper-card mx-auto my-10 max-w-xl p-8 text-center"
      role={kind === "error" || kind === "offline" ? "alert" : "status"}
      aria-live="polite"
    >
      <Icon
        className={`mx-auto h-6 w-6 text-muted-foreground ${kind === "loading" ? "animate-spin" : ""}`}
      />
      <h2 className="mt-4 font-serif text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" className="mt-5" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          {t("重试", "Retry")}
        </Button>
      )}
    </div>
  );
}

const FRESHNESS_STYLE: Record<Freshness, string> = {
  fresh: "border-verified/40 bg-verified/10 text-verified",
  cached: "border-inferred/40 bg-inferred/10 text-inferred",
  stale: "border-conflict/40 bg-conflict/10 text-conflict",
  offline: "border-border bg-muted text-muted-foreground",
};

export function DataFreshnessBadge({ meta }: { meta: DataMeta }) {
  const { lang, t } = useApp();
  const label = {
    fresh: t("已更新", "Fresh"),
    cached: t("缓存", "Cached"),
    stale: t("可能过期", "Stale"),
    offline: t("离线", "Offline"),
  }[meta.freshness];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${FRESHNESS_STYLE[meta.freshness]}`}
      title={meta.message ? pick(meta.message, lang) : undefined}
    >
      {meta.mode === "demo" ? t("演示快照", "Demo snapshot") : label}
      {meta.mode === "live" && ` · ${label}`}
    </span>
  );
}
