import { type ReactNode } from "react";
import { Info, ShieldCheck, HelpCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { useApp, pick } from "@/lib/app-state";
import { CONFIDENCE_LABELS, ENTITY_TYPE_LABELS } from "@/domain/labels";
import type { Confidence, Entity, Source } from "@/domain/types";
import { Link } from "@tanstack/react-router";

export function DemoBadge({ className = "" }: { className?: string }) {
  const { t } = useApp();
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border border-signal/40 bg-signal/10 text-signal text-[11px] px-2 py-0.5 font-medium " +
        className
      }
      title={t("本项目所有事实均为演示数据", "All facts in this project are demo data")}
    >
      <Info className="h-3 w-3" />
      {t("演示数据", "Demo data")}
    </span>
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
        "inline-flex items-center gap-1 rounded-full text-[11px] px-2 py-0.5 border " + meta.cls
      }
    >
      <Icon className="h-3 w-3" />
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
        <h2 className="font-serif text-xl md:text-2xl font-semibold text-foreground">{title}</h2>
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
      to="/knowledge/model/$slug"
      params={{ slug: entity.slug }}
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
            {t("发布", "Published")} {src.publishedAt}
          </span>
          <span>
            {t("采集", "Collected")} {src.collectedAt}
          </span>
          {src.verifiedAt && (
            <span>
              {t("核验", "Verified")} {src.verifiedAt}
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
    <div className="border-b border-border">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <DemoBadge />
            </div>
            <h1 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm md:text-base text-muted-foreground mt-2 max-w-3xl">
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
