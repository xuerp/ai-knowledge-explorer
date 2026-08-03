import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Info,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { ConfidenceChip, DemoBadge } from "@/components/common";
import { useApp, pick } from "@/lib/app-state";
import type {
  Claim,
  Confidence,
  Evidence,
  KnowledgeSnapshot,
  ResearchAnswer,
} from "@/domain/types";

export function ResearchReport({
  answer,
  snapshot,
  publicView = false,
  dataMode = "demo",
}: {
  answer: ResearchAnswer;
  snapshot: KnowledgeSnapshot;
  publicView?: boolean;
  dataMode?: "demo" | "live";
}) {
  const { t, lang } = useApp();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const claimById = useMemo(
    () => new Map(snapshot.claims.map((claim) => [claim.id, claim])),
    [snapshot.claims],
  );
  const evidenceById = useMemo(
    () => new Map(snapshot.evidence.map((source) => [source.id, source])),
    [snapshot.evidence],
  );
  const claims = answer.claimIds
    .map((id) => claimById.get(id))
    .filter((claim): claim is Claim => Boolean(claim));
  const sources = [
    ...new Map(
      claims
        .flatMap((claim) => claim.sourceIds)
        .map((id) => evidenceById.get(id))
        .filter((source): source is Evidence => Boolean(source))
        .map((source) => [source.id, source]),
    ).values(),
  ];

  const downloadMarkdown = () => {
    const markdown = createMarkdown(answer, claims, sources, lang);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${answer.id}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async () => {
    const shareUrl = `${window.location.origin}/share/${answer.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <article className="print-report">
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {publicView ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-verified/40 bg-verified/10 px-2.5 py-1 text-xs font-medium text-verified">
                <Globe2 className="h-3.5 w-3.5" />
                {t("公开研究页", "Public research page")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/35 bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal">
                <FileText className="h-3.5 w-3.5" />
                {t("私密研究记录", "Private research record")}
              </span>
            )}
            {dataMode === "demo" && <DemoBadge />}
            <span className="chip">
              {answer.status === "ready"
                ? t("研究完成", "Research ready")
                : t("证据不足", "Insufficient evidence")}
            </span>
          </div>
          <p className="text-xs font-medium uppercase tracking-widest text-signal">
            {t("研究问题", "Research question")}
          </p>
          <h1 className="mt-2 max-w-4xl font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-5xl">
            {pick(answer.question, lang)}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {t("生成时间", "Generated")} {formatTimestamp(answer.generatedAt, lang)}
            </span>
            <span>
              {t(
                `${claims.length} 条结论 · ${sources.length} 个来源`,
                `${claims.length} claims · ${sources.length} sources`,
              )}
            </span>
            <span>
              {dataMode === "demo"
                ? t("数据模式：演示快照", "Data mode: demo snapshot")
                : t("数据模式：已审核图谱", "Data mode: reviewed graph")}
            </span>
          </div>
          <div className="print-hidden mt-6 flex flex-wrap gap-2">
            {!publicView && (
              <Link
                to="/share/$id"
                params={{ id: answer.id }}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-signal px-3 text-sm font-medium text-signal-foreground hover:opacity-90"
              >
                <Globe2 className="h-4 w-4" />
                {t("打开公开分享页", "Open public share")}
              </Link>
            )}
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
            >
              {copyState === "copied" ? (
                <Check className="h-4 w-4 text-verified" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copyState === "copied"
                ? t("链接已复制", "Link copied")
                : copyState === "failed"
                  ? t("复制失败", "Copy failed")
                  : t("复制分享链接", "Copy share link")}
            </button>
            <button
              type="button"
              onClick={downloadMarkdown}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
            >
              <Download className="h-4 w-4" />
              Markdown
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
            >
              <Printer className="h-4 w-4" />
              {t("打印 / PDF", "Print / PDF")}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-8">
          <section aria-labelledby="summary-title">
            <p className="text-xs font-medium uppercase tracking-widest text-signal">
              {t("结论摘要", "Executive summary")}
            </p>
            <h2 id="summary-title" className="sr-only">
              {t("研究结论摘要", "Research summary")}
            </h2>
            <p className="mt-3 font-serif text-2xl leading-relaxed text-foreground md:text-3xl">
              {pick(answer.summary, lang)}
            </p>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-inferred/30 bg-inferred/5 p-3 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-inferred" />
              {t(
                "结论只覆盖当前快照中能够被引用支持的范围；缺失证据不会被流畅文本掩盖。",
                "The conclusion is limited to what the current snapshot can cite; fluent prose never hides missing evidence.",
              )}
            </div>
          </section>

          <section aria-labelledby="claims-title">
            <div className="mb-4">
              <p className="text-xs font-medium uppercase tracking-widest text-signal">
                {t("逐结论核验", "Claim-by-claim review")}
              </p>
              <h2
                id="claims-title"
                className="mt-1 font-serif text-2xl font-semibold text-foreground"
              >
                {t("结论与证据", "Conclusions & evidence")}
              </h2>
            </div>
            <div className="space-y-4">
              {claims.map((claim, index) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  number={index + 1}
                  evidenceById={evidenceById}
                />
              ))}
              {!claims.length && (
                <div className="paper-card p-6 text-sm text-muted-foreground">
                  {t(
                    "当前研究记录没有足够证据形成可发布结论。",
                    "This record has insufficient evidence for publishable claims.",
                  )}
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="sources-title">
            <div className="mb-4">
              <p className="text-xs font-medium uppercase tracking-widest text-signal">
                {t("出处", "Provenance")}
              </p>
              <h2
                id="sources-title"
                className="mt-1 font-serif text-2xl font-semibold text-foreground"
              >
                {t("原始资料", "Primary sources")}
              </h2>
            </div>
            <ol className="paper-card divide-y divide-border">
              {sources.map((source, index) => (
                <li key={source.id}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 p-4 transition-colors hover:bg-accent/40"
                  >
                    <span className="font-mono text-xs text-signal">[{index + 1}]</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">
                        {pick(source.title, lang)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {source.publisher} · {source.publishedAt} ·{" "}
                        {source.verifiedAt
                          ? t(`核验于 ${source.verifiedAt}`, `Verified ${source.verifiedAt}`)
                          : t("尚未独立核验", "Not independently verified")}
                      </span>
                    </span>
                    <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="paper-card p-4">
            <h2 className="font-serif text-lg font-semibold text-foreground">
              {t("研究过程", "Research process")}
            </h2>
            <ol className="mt-4 space-y-3">
              {answer.steps.map((step, index) => (
                <li key={step.id} className="flex items-start gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-verified/10 text-verified">
                    {step.status === "complete" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="font-mono text-[10px]">{index + 1}</span>
                    )}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {pick(step.label, lang)}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {step.status === "complete" ? t("已完成", "Complete") : step.status}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="paper-card p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-verified" />
              <h2 className="font-serif text-lg font-semibold text-foreground">
                {t("可信边界", "Trust boundary")}
              </h2>
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
              <li>· {t("事实与推断分别标记", "Facts and inferences are labelled")}</li>
              <li>· {t("每条结论绑定来源", "Every claim binds to sources")}</li>
              <li>· {t("冲突不会被静默覆盖", "Conflicts are never silently overwritten")}</li>
              <li>· {t("演示数据不冒充实时结果", "Demo data never masquerades as live")}</li>
            </ul>
          </section>

          {publicView && (
            <section className="print-hidden rounded-xl border border-border bg-accent/35 p-4">
              <p className="text-sm font-medium text-foreground">
                {t("继续验证这份研究", "Continue validating this research")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t(
                  "打开 AI Radar 可查看完整实体档案、关系路径与时间线。",
                  "Open AI Radar for complete entity profiles, relationship paths, and timelines.",
                )}
              </p>
              <Link
                to="/ask"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-signal hover:underline"
              >
                {t("进入 AI 研究", "Open AI research")} →
              </Link>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

function ClaimCard({
  claim,
  number,
  evidenceById,
}: {
  claim: Claim;
  number: number;
  evidenceById: Map<string, Evidence>;
}) {
  const { t, lang } = useApp();
  const sources = claim.sourceIds
    .map((id) => evidenceById.get(id))
    .filter((source): source is Evidence => Boolean(source));
  const border: Record<Confidence, string> = {
    verified: "border-l-verified",
    inferred: "border-l-inferred",
    unverified: "border-l-border-strong",
    conflict: "border-l-conflict",
  };
  return (
    <article className={`paper-card border-l-4 p-5 ${border[claim.confidence]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {t(`结论 ${number}`, `Claim ${number}`)}
        </span>
        <ConfidenceChip level={claim.confidence} />
        <span className="ml-auto text-xs text-muted-foreground">{claim.updatedAt}</span>
      </div>
      <p className="mt-3 text-base leading-relaxed text-foreground">{pick(claim.text, lang)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {sources.map((source, index) => (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="chip hover:border-signal/50 hover:text-signal"
          >
            [{index + 1}] {source.publisher}
          </a>
        ))}
      </div>
      {!sources.length && (
        <div className="mt-4 flex items-center gap-2 text-xs text-conflict">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("该结论没有可访问来源。", "This claim has no accessible source.")}
        </div>
      )}
    </article>
  );
}

function formatTimestamp(value: string, lang: "zh" | "en") {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function createMarkdown(
  answer: ResearchAnswer,
  claims: Claim[],
  sources: Evidence[],
  lang: "zh" | "en",
) {
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index + 1]));
  const lines = [
    `# ${pick(answer.question, lang)}`,
    "",
    `> ${pick(answer.summary, lang)}`,
    "",
    `Generated: ${answer.generatedAt}`,
    `Status: ${answer.status}`,
    "",
    "## Claims",
    "",
  ];
  claims.forEach((claim, index) => {
    const citations = claim.sourceIds
      .map((id) => sourceIndex.get(id))
      .filter(Boolean)
      .map((number) => `[${number}]`)
      .join(" ");
    lines.push(
      `### ${index + 1}. ${claim.confidence}`,
      "",
      `${pick(claim.text, lang)} ${citations}`.trim(),
      "",
    );
  });
  lines.push("## Sources", "");
  sources.forEach((source, index) => {
    lines.push(
      `${index + 1}. [${pick(source.title, lang)}](${source.url}) — ${source.publisher}, ${source.publishedAt}`,
    );
  });
  lines.push("", "---", "Generated from an explicitly labelled AI Radar demo snapshot.", "");
  return lines.join("\n");
}
