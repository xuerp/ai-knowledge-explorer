import type { Evidence, Lang } from "@/domain/types";

export function SourceExcerpt({ source, lang }: { source: Evidence; lang: Lang }) {
  if (!source.sourceExcerpt?.trim()) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {lang === "zh" ? "原文摘录暂缺" : "Source excerpt unavailable"}
      </p>
    );
  }

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-signal hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal">
        {lang === "zh" ? "查看原文摘录" : "View source excerpt"}
      </summary>
      <blockquote
        className="mt-3 whitespace-pre-wrap border-l border-border pl-3 text-base leading-relaxed text-foreground [overflow-wrap:anywhere] sm:text-sm"
        aria-label={
          lang === "zh" ? `${source.publisher} 原文摘录` : `${source.publisher} source excerpt`
        }
      >
        {source.sourceExcerpt}
      </blockquote>
    </details>
  );
}
