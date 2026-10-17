import { useEffect, useState, type ReactNode } from "react";
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
import { SourceExcerpt } from "@/components/research/SourceExcerpt";
import { createMarkdown } from "@/domain/research-markdown";
import { userApi } from "@/services/user-api";
import { readAuthToken } from "@/services/auth-session";
import { AuthSessionExpiredError, accountErrorMessage } from "@/services/auth-errors";
import { ReportExportError } from "@/services/report-export";
import { decisionPresentation, guidanceStatusLabel } from "@/domain/decision-presentation";
import { selectResearchEvidence } from "@/domain/research-evidence";
import { getClaimDisplayDate } from "@/domain/claim-display";
import type { ResearchResult } from "@/services/user-api";
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
  publishedSlug,
  research,
  decisionContent,
}: {
  answer: ResearchAnswer;
  snapshot: KnowledgeSnapshot;
  publicView?: boolean;
  dataMode?: "demo" | "live";
  publishedSlug?: string;
  research?: ResearchResult;
  decisionContent?: ReactNode;
}) {
  const { t, lang } = useApp();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportNeedsLogin, setExportNeedsLogin] = useState(false);
  const [exportFile, setExportFile] = useState<{
    url: string;
    name: string;
    format: "pdf" | "md";
  } | null>(null);
  useEffect(
    () => () => {
      if (exportFile) URL.revokeObjectURL(exportFile.url);
    },
    [exportFile],
  );
  useEffect(() => {
    setExportFile(null);
    setExportError("");
    setExportNeedsLogin(false);
  }, [answer.id, lang]);
  const { claims, evidence: sources } = selectResearchEvidence(
    research ?? answer,
    snapshot.claims,
    snapshot.evidence,
  );
  const shareId = dataMode === "demo" ? answer.id : publishedSlug;
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index + 1]));
  const evidenceById = new Map(sources.map((source) => [source.id, source]));

  const downloadFile = async (format: "pdf" | "md") => {
    setExporting(true);
    setExportError("");
    setExportNeedsLogin(false);
    setExportFile(null);
    try {
      const blob =
        research && userApi.configured
          ? await userApi.reportFile(
              research.id,
              format,
              lang,
              publicView ? "" : readAuthToken(),
              publicView ? publishedSlug : undefined,
            )
          : format === "md"
            ? new Blob([createMarkdown(answer, claims, sources, lang, dataMode)], {
                type: "text/markdown;charset=utf-8",
              })
            : null;
      if (!blob)
        throw new Error(
          t(
            "PDF 导出需要已保存的 API 研究记录。",
            "PDF export requires a saved API research record.",
          ),
        );
      const url = URL.createObjectURL(blob);
      const name = `ai-radar-${answer.id}.${format}`;
      setExportFile({ url, name, format });
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setExportNeedsLogin(error instanceof AuthSessionExpiredError);
      setExportError(
        error instanceof ReportExportError
          ? t(error.message, error.englishMessage)
          : accountErrorMessage(error, t),
      );
    } finally {
      setExporting(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareId) return;
    const shareUrl = `${window.location.origin}/share/${shareId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <article className="print-report research-report">
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
              {research?.decision?.guidance
                ? guidanceStatusLabel(research.decision.guidance.outcome, lang)
                : research?.decision && decisionPresentation(research, lang).allExcluded
                  ? t("无符合条件的候选", "No eligible candidate")
                  : research?.decision?.plan?.state === "needs-input"
                    ? t("待确认任务与条件", "Task and conditions need clarification")
                    : answer.status === "ready"
                      ? t("分析已生成", "Analysis generated")
                      : t("证据不足", "Insufficient evidence")}
            </span>
          </div>
          <h1 className="research-report__question">{pick(answer.question, lang)}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {t("生成时间", "Generated")} {formatTimestamp(answer.generatedAt, lang)}
            </span>
            <span>
              {t(
                `${claims.length} 条结论 · ${sources.length} 条来源引用`,
                `${claims.length} claims · ${sources.length} source references`,
              )}
            </span>
            <span>
              {dataMode === "demo"
                ? t("数据范围：示例快照", "Data scope: sample snapshot")
                : t("数据模式：已审核图谱", "Data mode: reviewed graph")}
            </span>
          </div>
          <div className="print-hidden mt-6 flex flex-wrap gap-2">
            {!publicView && shareId && (
              <Link
                to="/share/$id"
                params={{ id: shareId }}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-signal px-3 text-sm font-medium text-signal-foreground hover:opacity-90"
              >
                <Globe2 className="h-4 w-4" />
                {t("打开公开分享页", "Open public share")}
              </Link>
            )}
            {shareId && (
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
            )}
            <button
              type="button"
              onClick={() => void downloadFile("md")}
              disabled={exporting}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
            >
              <Download className="h-4 w-4" />
              Markdown
            </button>
            <button
              type="button"
              onClick={() => void downloadFile("pdf")}
              disabled={exporting || !research || !userApi.configured}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
            >
              <Printer className="h-4 w-4" />
              {exporting ? t("正在导出…", "Exporting…") : t("下载 PDF 报告", "Download PDF report")}
            </button>
          </div>
          <p className="print-hidden mt-3 text-xs text-muted-foreground">
            {t(
              "导出独立报告：结论、功能比较、条件与缺口、验证计划、来源。不包含网页按钮和私人验证笔记。",
              "Exports a reading report with conclusions, features, constraints, trial plan and sources. Page controls and private validation notes are excluded.",
            )}
          </p>
          {exportError && (
            <p role="alert" className="print-hidden mt-2 text-sm text-destructive">
              {exportError}
              {exportNeedsLogin && research && (
                <Link
                  to="/account"
                  search={{ returnTo: `/research/${research.id}` }}
                  className="ml-2 font-medium underline"
                >
                  {t("重新登录并返回报告", "Sign in and return to this report")}
                </Link>
              )}
            </p>
          )}
          {exportFile && (
            <p role="status" className="print-hidden mt-3 text-sm text-muted-foreground">
              {t(
                "报告已生成。如果未开始下载：",
                "Report generated. If the download did not start: ",
              )}
              <a
                href={exportFile.url}
                download={exportFile.name}
                className="ml-1 font-medium text-signal underline"
              >
                {exportFile.format === "pdf"
                  ? t("保存 PDF 文件", "Save PDF file")
                  : t("保存 Markdown 文件", "Save Markdown file")}
              </a>
            </p>
          )}
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6 ${research?.decision ? "" : "lg:grid-cols-[minmax(0,1fr)_280px]"}`}
      >
        <div className={research?.decision ? "space-y-3" : "space-y-8"}>
          {!research?.decision && (
            <section aria-labelledby="summary-title">
              <h2 id="summary-title" className="research-report__section-title">
                {t("研究结论摘要", "Research summary")}
              </h2>
              <p className="research-report__summary">{pick(answer.summary, lang)}</p>
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-inferred/30 bg-inferred/5 p-3 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-inferred" />
                {t(
                  "结论只覆盖当前快照中能够被引用支持的范围；缺失证据不会被流畅文本掩盖。",
                  "The conclusion is limited to what the current snapshot can cite; fluent prose never hides missing evidence.",
                )}
              </div>
            </section>
          )}

          {decisionContent}
          <details className="research-source-library" open={research?.decision ? undefined : true}>
            <summary>
              {t(
                `全部结论与原始来源（${claims.length} 条事实）`,
                `All claims and source documents (${claims.length} claims)`,
              )}
            </summary>
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
                    sourceIndex={sourceIndex}
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
                  <li key={source.id} id={`source-${source.id}`} className="scroll-mt-24">
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
                          {source.publisher} ·{" "}
                          {source.publishedAt || t("来源日期未标注", "Source date unavailable")} ·{" "}
                          {source.verifiedAt
                            ? t(`核验于 ${source.verifiedAt}`, `Verified ${source.verifiedAt}`)
                            : t("尚未独立核验", "Not independently verified")}
                        </span>
                      </span>
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </a>
                    <div className="px-4 pb-4">
                      <SourceExcerpt source={source} lang={lang} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </details>
        </div>

        {!research?.decision && (
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
                        <span className="font-mono text-[11px]">{index + 1}</span>
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
                <li>
                  ·{" "}
                  {t(
                    "固定快照与实时结果清晰区分",
                    "Fixed snapshots remain distinct from live results",
                  )}
                </li>
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
        )}
      </div>
    </article>
  );
}

function ClaimCard({
  claim,
  number,
  evidenceById,
  sourceIndex,
}: {
  claim: Claim;
  number: number;
  evidenceById: Map<string, Evidence>;
  sourceIndex: Map<string, number>;
}) {
  const { t, lang } = useApp();
  const sources = claim.sourceIds
    .map((id) => evidenceById.get(id))
    .filter((source): source is Evidence => Boolean(source));
  const date = getClaimDisplayDate(claim, sources);
  const border: Record<Confidence, string> = {
    verified: "border-verified/40",
    inferred: "border-inferred/40",
    unverified: "border-border-strong",
    conflict: "border-conflict/40",
  };
  return (
    <article
      id={`claim-${claim.id}`}
      className={`paper-card scroll-mt-24 border p-5 ${border[claim.confidence]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {t(`结论 ${number}`, `Claim ${number}`)}
        </span>
        <ConfidenceChip level={claim.confidence} />
        <span className="ml-auto text-xs text-muted-foreground">
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
        </span>
      </div>
      <p className="mt-3 text-base leading-relaxed text-foreground">{pick(claim.text, lang)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {sources.map((source) => (
          <a
            key={source.id}
            href={`#source-${source.id}`}
            className="chip hover:border-signal/50 hover:text-signal"
          >
            [{sourceIndex.get(source.id)}] {source.publisher}
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
  // SQLite returns naive datetimes although persisted research times are UTC.
  // Preserve explicit offsets; never reinterpret a naive API time as browser-local.
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  return (
    new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Shanghai",
    }).format(new Date(timestamp)) + (lang === "zh" ? "（北京时间）" : " UTC+8")
  );
}
