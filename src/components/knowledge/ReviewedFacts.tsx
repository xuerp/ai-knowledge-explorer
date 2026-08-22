import { useState } from "react";
import { ChevronDown, History, LibraryBig } from "lucide-react";
import { ConfidenceChip, SourceRow } from "@/components/common";
import { splitClaimsForDisplay } from "@/domain/claim-display";
import type { Claim, Source } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";

const HISTORY_PAGE_SIZE = 10;

function displayDate(value: string, lang: "zh" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function ReviewedFacts({ claims, evidence }: { claims: Claim[]; evidence: Source[] }) {
  const { t, lang } = useApp();
  const displayed = splitClaimsForDisplay(claims);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
  const visibleHistory = displayed.history.slice(0, historyLimit);
  const remainingHistory = displayed.history.length - visibleHistory.length;
  const evidenceById = new Map(evidence.map((source) => [source.id, source]));

  const renderClaim = (claim: Claim, compact = false) => {
    const claimSources = claim.sourceIds
      .map((sourceId) => evidenceById.get(sourceId))
      .filter((source): source is Source => Boolean(source));

    return (
      <article key={claim.id} className={compact ? "px-4 py-4 md:px-5" : "px-4 py-5 md:px-5"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <time className="font-mono text-xs text-muted-foreground">
            {t("最近核验", "Last verified")} {displayDate(claim.updatedAt, lang)}
          </time>
          <ConfidenceChip level={claim.confidence} />
        </div>
        <p className="mt-2 text-sm leading-6 text-foreground md:text-[15px]">
          {pick(claim.text, lang)}
        </p>
        {claimSources.length > 0 && (
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-signal hover:underline">
              {t(
                `${claimSources.length} 个直接证据来源`,
                `${claimSources.length} direct evidence source${claimSources.length > 1 ? "s" : ""}`,
              )}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 rounded-lg border border-border bg-muted/20 py-1">
              {claimSources.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </div>
          </details>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-4">
      <div className="paper-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3 md:px-5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <LibraryBig className="h-4 w-4 text-signal" />
            {t("当前事实摘要", "Current fact summary")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(
              `共 ${claims.length} 条，展示最近 ${displayed.visible.length} 条`,
              `${claims.length} total · showing ${displayed.visible.length} recent`,
            )}
          </div>
        </div>
        <div className="divide-y divide-border">
          {displayed.visible.map((claim) => renderClaim(claim))}
        </div>
      </div>

      {displayed.history.length > 0 && (
        <details className="paper-card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 md:px-5">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-signal">
              <History className="h-4 w-4" />
              {t(
                `历史事实（${displayed.history.length}）`,
                `Fact history (${displayed.history.length})`,
              )}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border">
            <div className="divide-y divide-border">
              {visibleHistory.map((claim) => renderClaim(claim, true))}
            </div>
            {remainingHistory > 0 && (
              <div className="border-t border-border p-4 text-center">
                <button
                  type="button"
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-signal transition-colors hover:bg-accent"
                  onClick={() => setHistoryLimit((limit) => limit + HISTORY_PAGE_SIZE)}
                >
                  {t(
                    `再加载 ${Math.min(HISTORY_PAGE_SIZE, remainingHistory)} 条`,
                    `Load ${Math.min(HISTORY_PAGE_SIZE, remainingHistory)} more`,
                  )}
                </button>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
