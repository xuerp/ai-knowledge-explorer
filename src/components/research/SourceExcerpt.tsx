import type { Evidence, Lang } from "@/domain/types";

export function SourceExcerpt({ source, lang }: { source: Evidence; lang: Lang }) {
  if (!source.sourceExcerpt?.trim()) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {lang === "zh" ? "原文摘录暂缺" : "Source excerpt unavailable"}
      </p>
    );
  }

  const isQuote = source.sourceExcerptKind === "quote";
  const isSummary = source.sourceExcerptKind === "summary";
  const label = isQuote
    ? lang === "zh"
      ? "原文摘录"
      : "source excerpt"
    : isSummary
      ? lang === "zh"
        ? "整理摘要（非原文引语）"
        : "editorial summary (not a quotation)"
      : lang === "zh"
        ? "来源文本（引语性质待核对）"
        : "source text (quotation status unverified)";
  const TextElement = isQuote ? "blockquote" : "p";

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-signal hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal">
        {lang === "zh" ? `查看${label}` : `View ${label}`}
      </summary>
      <TextElement
        className="mt-3 whitespace-pre-wrap border-l border-border pl-3 text-base leading-relaxed text-foreground [overflow-wrap:anywhere] sm:text-sm"
        aria-label={`${source.publisher} ${label}`}
      >
        {source.sourceExcerpt}
      </TextElement>
    </details>
  );
}
