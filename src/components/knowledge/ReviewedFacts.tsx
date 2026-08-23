import { useEffect, useState } from "react";
import { ChevronDown, History, LibraryBig } from "lucide-react";
import { ConfidenceChip, SourceRow } from "@/components/common";
import { getClaimDisplayDate, splitClaimsForDisplay } from "@/domain/claim-display";
import { claimTextForReadingMode, rankClaimsForReadingMode } from "@/domain/claim-reading-mode";
import type { Claim, Source } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";
import { knowledgeRepository } from "@/services/knowledge-repository";

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

export function ReviewedFacts({
  entityId,
  claims,
  evidence,
}: {
  entityId: string;
  claims: Claim[];
  evidence: Source[];
}) {
  const { t, lang, mode } = useApp();
  const visibleLimit = mode === "general" ? 3 : mode === "product" ? 5 : 8;
  const rankedClaims = rankClaimsForReadingMode(claims, mode);
  const displayed = splitClaimsForDisplay(rankedClaims, visibleLimit, true);
  const [remoteHistory, setRemoteHistory] = useState<Claim[]>([]);
  const [remoteEvidence, setRemoteEvidence] = useState<Source[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loadingHistory, setLoadingHistory] = useState(false);
  const visibleHistory = remoteHistory.length
    ? remoteHistory
    : displayed.history.slice(0, HISTORY_PAGE_SIZE);
  const remainingHistory = remoteHistory.length
    ? Number(Boolean(nextCursor))
    : displayed.history.length - visibleHistory.length;
  const evidenceById = new Map(
    [...evidence, ...remoteEvidence].map((source) => [source.id, source]),
  );

  const loadMoreHistory = async () => {
    setLoadingHistory(true);
    try {
      const page = await knowledgeRepository.getEntityClaims(
        entityId,
        "history",
        remoteHistory.length ? nextCursor : undefined,
        HISTORY_PAGE_SIZE,
      );
      setRemoteHistory((current) =>
        Array.from(new Map([...current, ...page.items].map((claim) => [claim.id, claim])).values()),
      );
      setRemoteEvidence((current) =>
        Array.from(
          new Map([...current, ...page.evidence].map((source) => [source.id, source])).values(),
        ),
      );
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void knowledgeRepository
      .getEntityClaims(entityId, "history", undefined, HISTORY_PAGE_SIZE, controller.signal)
      .then((page) => {
        setRemoteHistory(page.items);
        setRemoteEvidence(page.evidence);
        setNextCursor(page.nextCursor);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [entityId]);

  const renderClaim = (claim: Claim, compact = false) => {
    const claimSources = claim.sourceIds
      .map((sourceId) => evidenceById.get(sourceId))
      .filter((source): source is Source => Boolean(source));
    const primaryDate = getClaimDisplayDate(claim, claimSources);

    return (
      <article key={claim.id} className={compact ? "px-4 py-4 md:px-5" : "px-4 py-5 md:px-5"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {primaryDate ? (
            <time className="font-mono text-xs text-muted-foreground">
              {primaryDate.kind === "effective"
                ? t("发生 / 生效", "Occurred / effective")
                : t("官方资料发布", "Official source published")}{" "}
              {displayDate(primaryDate.value, lang)}
            </time>
          ) : (
            <span />
          )}
          <ConfidenceChip level={claim.confidence} />
        </div>
        <p className="mt-2 text-sm leading-6 text-foreground md:text-[15px]">
          {pick(claimTextForReadingMode(claim, mode), lang)}
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
            {t(
              mode === "general"
                ? "关键事实"
                : mode === "product"
                  ? "产品决策事实"
                  : "技术与证据事实",
              mode === "general"
                ? "Key facts"
                : mode === "product"
                  ? "Product decision facts"
                  : "Technical and evidence facts",
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(
              `共 ${claims.length} 条，本模式重点展示 ${displayed.visible.length} 条`,
              `${claims.length} total · ${displayed.visible.length} prioritized for this mode`,
            )}
          </div>
        </div>
        <div className="divide-y divide-border">
          {displayed.visible.map((claim) => renderClaim(claim))}
        </div>
      </div>

      {visibleHistory.length > 0 && (
        <details className="paper-card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 md:px-5">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-signal">
              <History className="h-4 w-4" />
              {t(
                `历史事实（已加载 ${visibleHistory.length} 条）`,
                `Fact history (${visibleHistory.length} loaded)`,
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
                  disabled={loadingHistory}
                  onClick={() => void loadMoreHistory()}
                >
                  {t(
                    loadingHistory ? "加载中…" : "再加载 10 条",
                    loadingHistory ? "Loading…" : "Load 10 more",
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
