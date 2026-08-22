import { BookOpen, CheckCircle2, Lightbulb, ShieldAlert } from "lucide-react";
import { SectionHeading } from "@/components/common";
import type { EntityDetail, LocalizedText } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";
import { getKnowledgeBlockOrder } from "@/domain/reading-mode";

type Knowledge = NonNullable<EntityDetail["knowledge"]>;

export function KnowledgeArticle({
  knowledge,
  entityName,
  sectionEyebrow = "01",
  articleLabel,
  articleTitle,
}: {
  knowledge: Knowledge;
  entityName: LocalizedText;
  sectionEyebrow?: string;
  articleLabel?: LocalizedText;
  articleTitle?: LocalizedText;
}) {
  const { t, lang, mode } = useApp();

  return (
    <div className="flex flex-col gap-8" data-reading-mode={mode}>
      <section
        data-reading-block="guide"
        style={{ order: getKnowledgeBlockOrder(mode, "guide") }}
        className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]"
      >
        <article className="paper-card p-6 md:p-8">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-signal">
            <BookOpen className="h-4 w-4" />
            {articleLabel ? pick(articleLabel, lang) : t("知识导读", "Knowledge guide")}
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">
            {articleTitle
              ? pick(articleTitle, lang)
              : t(`什么是 ${entityName.zh}？`, `What is ${entityName.en}?`)}
          </h2>
          <div className="mt-5 space-y-4 text-[15px] leading-8 text-ink-soft">
            {knowledge.introduction.map((paragraph, index) => (
              <p key={index}>{pick(paragraph, lang)}</p>
            ))}
          </div>
          <div className="mt-7 rounded-xl border border-signal/20 bg-signal/5 p-5">
            <div className="flex items-center gap-2 font-semibold text-signal">
              <Lightbulb className="h-4 w-4" />
              {t("为什么值得关注", "Why it matters")}
            </div>
            <p className="mt-2 text-sm leading-7 text-foreground">
              {pick(knowledge.significance, lang)}
            </p>
          </div>
        </article>

        <aside className="paper-card p-6">
          <div className="text-xs font-medium uppercase tracking-widest text-signal">
            {t("30 秒看懂", "Understand in 30 seconds")}
          </div>
          <div className="mt-5 space-y-5">
            {knowledge.keyPoints.map((point, index) => (
              <div key={index} className="border-b border-border pb-5 last:border-0 last:pb-0">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-verified" />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {pick(point.title, lang)}
                    </h3>
                    <p className="mt-1.5 text-sm leading-6 text-ink-soft">
                      {pick(point.description, lang)}
                    </p>
                    {point.sourceIds && point.sourceIds.length > 0 && (
                      <span className="mt-2 inline-block text-[11px] text-verified">
                        {t(
                          `${point.sourceIds.length} 个直接来源`,
                          `${point.sourceIds.length} direct source${point.sourceIds.length > 1 ? "s" : ""}`,
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section
        data-reading-block="use-cases"
        style={{ order: getKnowledgeBlockOrder(mode, "use-cases") }}
      >
        {mode === "technical" ? (
          <details className="paper-card group p-5">
            <summary className="cursor-pointer list-none text-sm font-semibold text-foreground marker:hidden">
              <span className="flex items-center justify-between gap-4">
                <span>{t("使用场景（按需展开）", "Use cases (expand when needed)")}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t(`${knowledge.useCases.length} 项`, `${knowledge.useCases.length} items`)}
                </span>
              </span>
            </summary>
            <div className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-3">
              <UseCaseCards knowledge={knowledge} />
            </div>
          </details>
        ) : (
          <>
            <SectionHeading
              eyebrow={sectionEyebrow}
              title={t("适合用来做什么", "What it is useful for")}
              description={t(
                "先从任务出发判断是否适合，再查看规格、价格和证据。",
                "Start from the task, then inspect specifications, price and evidence.",
              )}
            />
            {knowledge.useCases.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-3">
                <UseCaseCards knowledge={knowledge} />
              </div>
            ) : (
              <div className="paper-card p-5 text-sm text-muted-foreground">
                {t(
                  "当前证据不足以形成产品场景结论，请先查看证据或进入 AI 研究。",
                  "Current evidence is insufficient for a product use-case conclusion. Review the evidence or open AI Research.",
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section
        data-reading-block="limitations"
        style={{ order: getKnowledgeBlockOrder(mode, "limitations") }}
        className="rounded-xl border border-[#f4c767] bg-[#fffbeb] p-5 text-[#78350f] dark:border-[#8a621a] dark:bg-[#2d210b] dark:text-[#fde7ae]"
      >
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" />
          {t("选择与判断边界", "Limits and interpretation")}
        </div>
        <ul className="mt-3 grid gap-2 text-sm leading-6 md:grid-cols-2">
          {knowledge.limitations.map((limitation, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{pick(limitation, lang)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function UseCaseCards({ knowledge }: { knowledge: Knowledge }) {
  const { lang } = useApp();

  return knowledge.useCases.map((useCase, index) => (
    <article key={index} className="paper-card p-5">
      <span className="font-mono text-xs text-signal">{String(index + 1).padStart(2, "0")}</span>
      <h3 className="mt-3 font-semibold text-foreground">{pick(useCase.title, lang)}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{pick(useCase.description, lang)}</p>
    </article>
  ));
}
