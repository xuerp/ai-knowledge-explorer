import { useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ConfidenceChip, SourceRow } from "@/components/common";
import { getClaimDisplayDate } from "@/domain/claim-display";
import {
  claimTextForReadingMode,
  rankClaimsForReadingMode,
  claimTopicLabel,
} from "@/domain/claim-reading-mode";
import type { Claim, Source } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";
import { knowledgeRepository, type EntityClaimPage } from "@/services/knowledge-repository";

const FACT_PAGE_SIZE = 8;

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
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState<EntityClaimPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const cursor = cursors[pageIndex];
  const topics = [
    ...new Set(
      claims.map((claim) => claim.predicate).filter((value): value is string => Boolean(value)),
    ),
  ];
  const prioritized = rankClaimsForReadingMode(claims, mode).slice(0, 3);
  const evidenceById = new Map(
    [...evidence, ...(result?.evidence ?? [])].map((source) => [source.id, source]),
  );

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setResult(null);
    const timer = window.setTimeout(() => {
      void knowledgeRepository
        .getEntityClaims(entityId, "all", cursor, FACT_PAGE_SIZE, controller.signal, {
          q: query,
          topic,
        })
        .then((page) => {
          if (active) setResult(page);
        })
        .catch(() => {
          if (active)
            setError(t("事实暂时无法加载，请重试。", "Facts could not be loaded. Retry."));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [entityId, expanded, cursor, query, topic, retry, t]);

  function resetPage() {
    setCursors([undefined]);
    setPageIndex(0);
  }
  function renderClaim(claim: Claim) {
    const claimSources = claim.sourceIds
      .map((id) => evidenceById.get(id))
      .filter((source): source is Source => Boolean(source));
    const date = getClaimDisplayDate(claim, claimSources);
    return (
      <article key={claim.id} className="reviewed-facts__row">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {date ? (
              <time dateTime={date.value}>
                {date.kind === "effective"
                  ? t("发生 / 生效", "Occurred / effective")
                  : t("官方资料发布", "Source published")}{" "}
                {date.value.slice(0, 10)}
              </time>
            ) : (
              t("未标注发生日期", "Event date unavailable")
            )}
            {claim.validTo && (
              <span>
                {" "}
                · {t("有效至", "Valid until")} {claim.validTo}
              </span>
            )}
          </span>
          <ConfidenceChip level={claim.confidence} />
        </div>
        <p className="mt-2 text-sm leading-6 text-foreground">
          {pick(claimTextForReadingMode(claim, mode), lang)}
        </p>
        {claimSources.length > 0 ? (
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-signal hover:underline">
              {t(`查看依据 (${claimSources.length})`, `View evidence (${claimSources.length})`)}
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 divide-y divide-border">
              {claimSources.map((source) => (
                <div key={source.id} className="py-1">
                  <SourceRow source={source} />
                </div>
              ))}
            </div>
          </details>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("当前没有可显示的直接来源。", "No directly displayable source.")}
          </p>
        )}
      </article>
    );
  }

  return (
    <div className="paper-card reviewed-facts">
      <div className="reviewed-facts__toolbar">
        <span className="text-sm text-muted-foreground">
          {expanded
            ? t("检索全部事实与历史依据", "Browse all facts and historical evidence")
            : t(
                `${claims.length} 条当前事实 · 精选 ${prioritized.length} 条`,
                `${claims.length} current facts · ${prioritized.length} highlighted`,
              )}
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          className="text-sm font-medium text-signal"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("收起列表", "Collapse list") : t("查阅全部事实", "Browse all facts")}
        </button>
      </div>
      {expanded && (
        <div className="reviewed-facts__filters">
          <label className="reviewed-facts__search">
            <Search aria-hidden="true" />
            <input
              value={query}
              maxLength={200}
              aria-label={t("搜索全部事实", "Search all facts")}
              placeholder={t(
                "搜索能力、价格或接入条件…",
                "Search capabilities, pricing or access…",
              )}
              onChange={(event) => {
                setQuery(event.target.value);
                resetPage();
              }}
            />
          </label>
          <select
            value={topic}
            aria-label={t("事实主题", "Fact topic")}
            onChange={(event) => {
              setTopic(event.target.value);
              resetPage();
            }}
          >
            <option value="">{t("全部主题", "All topics")}</option>
            {topics.map((value) => (
              <option key={value} value={value}>
                {claimTopicLabel(value, lang)}
              </option>
            ))}
          </select>
        </div>
      )}
      {expanded ? (
        loading ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {t("正在加载事实…", "Loading facts…")}
          </p>
        ) : error ? (
          <div role="alert" className="p-4 text-sm">
            <p>{error}</p>
            <button
              type="button"
              className="mt-2 text-signal"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("重试", "Retry")}
            </button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {result?.items.length ? (
                result.items.map(renderClaim)
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  {t(
                    "没有匹配事实，试试其他关键词或主题。",
                    "No matching facts. Try another query or topic.",
                  )}
                </p>
              )}
            </div>
            {result && (
              <div className="reviewed-facts__pagination">
                <span>
                  {t(
                    `共 ${result.total} 条 · 第 ${pageIndex + 1} 页`,
                    `${result.total} facts · Page ${pageIndex + 1}`,
                  )}
                </span>
                {(pageIndex > 0 || result.nextCursor) && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={pageIndex === 0}
                      onClick={() => setPageIndex((value) => value - 1)}
                    >
                      {t("上一页", "Previous")}
                    </button>
                    <button
                      type="button"
                      disabled={!result.nextCursor}
                      onClick={() => {
                        setCursors((values) => [
                          ...values.slice(0, pageIndex + 1),
                          result.nextCursor,
                        ]);
                        setPageIndex((value) => value + 1);
                      }}
                    >
                      {t("下一页", "Next")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )
      ) : (
        <div className="divide-y divide-border">{prioritized.map(renderClaim)}</div>
      )}
    </div>
  );
}
