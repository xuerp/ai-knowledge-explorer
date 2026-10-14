import { type ReactNode } from "react";
import { Info, ShieldCheck, HelpCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { useApp, pick } from "@/lib/app-state";
import { CONFIDENCE_LABELS, ENTITY_TYPE_LABELS } from "@/domain/labels";
import type { Confidence, DataMode, Entity, Source } from "@/domain/types";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function DemoBadge({
  className = "",
  mode = "demo",
  updatedAt,
}: {
  className?: string;
  mode?: DataMode;
  updatedAt?: string;
}) {
  const { t } = useApp();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`data-status-badge ${className}`}>
          <Info aria-hidden="true" />
          {mode === "demo" ? t("示例快照", "Sample snapshot") : t("数据状态", "Data status")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="data-status-explanation"
        align="end"
        aria-label={t("数据状态说明", "Data status explanation")}
      >
        <h2>{t("当前数据从哪里来", "Where this data comes from")}</h2>
        <p>
          {mode === "demo"
            ? t(
                "当前处于示例模式，包含固定演示内容和人工核验的模型目录，并非持续实时采集。",
                "Sample mode combines fixed demonstrations and a manually reviewed model catalog, without continuous live collection.",
              )
            : t(
                "当前使用 API 返回的数据快照。接口连接成功不代表每条信息刚刚发生或已完成核验。",
                "This snapshot comes from the API. A successful connection does not mean every fact is recent or verified.",
              )}
        </p>
        {updatedAt && (
          <p>
            {t("快照日期", "Snapshot date")}: {updatedAt.slice(0, 10)}
          </p>
        )}
        <p>
          {t(
            "每条内容的发生日期、核验日期和证据等级需要分别查看。",
            "Check each record's event date, verification date and evidence level separately.",
          )}
        </p>
        <Link to="/quality">
          {t("查看数据质量与覆盖说明", "View data quality and coverage")}{" "}
          <ExternalLink aria-hidden="true" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

export function WorkspaceHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="workspace-header__actions">{actions}</div>}
    </header>
  );
}

const CONF_STYLE: Record<Confidence, { cls: string; icon: typeof ShieldCheck }> = {
  verified: { cls: "text-verified border-verified/40 bg-verified/10", icon: ShieldCheck },
  inferred: { cls: "text-inferred border-inferred/40 bg-inferred/10", icon: Info },
  unverified: { cls: "text-unverified border-border bg-muted", icon: HelpCircle },
  conflict: { cls: "text-conflict border-conflict/40 bg-conflict/10", icon: AlertTriangle },
};

export function ConfidenceChip({ level }: { level: Confidence }) {
  const { lang } = useApp();
  const meta = CONF_STYLE[level];
  const Icon = meta.icon;
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] " +
        meta.cls
      }
    >
      <Icon className="h-3 w-3 shrink-0" />
      {pick(CONFIDENCE_LABELS[level], lang)}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-widest text-signal font-medium mb-1">
            {eyebrow}
          </div>
        )}
        <h2 className="text-xl md:text-2xl font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function EntityChip({ entity }: { entity: Entity }) {
  const { lang } = useApp();
  return (
    <Link
      to="/knowledge/$type/$slug"
      params={{ type: entity.type, slug: entity.slug }}
      className="chip hover:border-signal/60 hover:text-foreground"
    >
      {pick(ENTITY_TYPE_LABELS[entity.type], lang)} · {pick(entity.name, lang)}
    </Link>
  );
}

export function SourceRow({ source: src }: { source: Source }) {
  const { lang, t } = useApp();
  return (
    <a
      href={src.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-accent/60 transition-colors group"
    >
      <div className="chip shrink-0 mt-0.5">{src.publisher}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground group-hover:text-signal truncate">
          {pick(src.title, lang)}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
          <span>
            {src.publishedAt
              ? `${t("发布", "Published")} ${src.publishedAt.slice(0, 10)}`
              : t("发布日期待核实", "Publication date not verified")}
          </span>
          <span>
            {t("采集", "Collected")} {src.collectedAt.slice(0, 10)}
          </span>
          {src.verifiedAt && (
            <span>
              {t("核验", "Verified")}{" "}
              <time dateTime={src.verifiedAt} title={src.verifiedAt}>
                {src.verifiedAt.slice(0, 10)}
              </time>
            </span>
          )}
        </div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
    </a>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div>
      <div className="page-container pt-8 pb-4 md:pt-10 md:pb-5">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-2 max-w-3xl leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
          {actions}
        </div>
      </div>
    </div>
  );
}
