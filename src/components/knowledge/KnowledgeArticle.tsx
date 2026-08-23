import { BookOpen, CheckCircle2, Lightbulb, ShieldAlert } from "lucide-react";
import { SectionHeading } from "@/components/common";
import type { EntityDetail, LocalizedText } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";
import { getKnowledgeBlockOrder } from "@/domain/reading-mode";

type Knowledge = NonNullable<EntityDetail["knowledge"]>;
type KnowledgeArticleProps = {
  knowledge: Knowledge;
  entityName: LocalizedText;
  sectionEyebrow?: string;
  articleLabel?: LocalizedText;
  articleTitle?: LocalizedText;
};

export function KnowledgeArticle({
  knowledge,
  entityName,
  sectionEyebrow = "01",
  articleLabel,
  articleTitle,
}: KnowledgeArticleProps) {
  const { t, lang, mode } = useApp();

  if (mode === "product") {
    return (
      <ProductKnowledgeArticle
        knowledge={knowledge}
        entityName={entityName}
        sectionEyebrow={sectionEyebrow}
      />
    );
  }

  if (mode === "technical") {
    return (
      <TechnicalKnowledgeArticle
        knowledge={knowledge}
        entityName={entityName}
        sectionEyebrow={sectionEyebrow}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8" data-reading-mode={mode} data-reading-view="general">
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
        <SectionHeading
          eyebrow={sectionEyebrow}
          title={t("适合用来做什么", "What it is useful for")}
          description={t(
            "先从代表性任务理解用途；更完整的选择条件请切换产品模式。",
            "Start with representative tasks; switch to Product mode for fuller selection criteria.",
          )}
        />
        {knowledge.useCases.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-3">
            <UseCaseCards knowledge={knowledge} limit={3} />
          </div>
        ) : (
          <div className="paper-card p-5 text-sm text-muted-foreground">
            {t(
              "当前证据不足以形成使用场景结论。",
              "Current evidence is insufficient for a use-case conclusion.",
            )}
          </div>
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

function ProductKnowledgeArticle({
  knowledge,
  entityName,
  sectionEyebrow = "01",
}: KnowledgeArticleProps) {
  const { t, lang } = useApp();

  return (
    <div className="flex flex-col gap-8" data-reading-mode="product" data-reading-view="product">
      <section data-reading-block="use-cases">
        <SectionHeading
          eyebrow={sectionEyebrow}
          title={t("产品决策视图", "Product decision view")}
          description={t(
            "围绕用户价值、适用任务和采用风险判断是否值得进入方案。",
            "Evaluate user value, suitable jobs, and adoption risks before choosing it.",
          )}
        />
        <div className="mb-4 rounded-xl border border-signal/20 bg-signal/5 p-5">
          <div className="text-xs font-medium uppercase tracking-widest text-signal">
            {t("核心产品价值", "Core product value")}
          </div>
          <p className="mt-2 text-sm leading-7 text-foreground">
            {pick(knowledge.significance, lang)}
          </p>
        </div>
        {knowledge.useCases.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-3">
            <UseCaseCards knowledge={knowledge} />
          </div>
        ) : (
          <div className="paper-card p-5 text-sm text-muted-foreground">
            {t(
              "当前证据不足以形成产品场景结论，请先查看已审核事实。",
              "Current evidence is insufficient for a product use-case conclusion. Review the verified facts first.",
            )}
          </div>
        )}
      </section>

      <section
        data-reading-block="limitations"
        className="rounded-xl border border-[#f4c767] bg-[#fffbeb] p-5 text-[#78350f] dark:border-[#8a621a] dark:bg-[#2d210b] dark:text-[#fde7ae]"
      >
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" />
          {t("采用前必须确认", "Confirm before adoption")}
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

      <details data-reading-block="guide" className="paper-card group p-5">
        <summary className="cursor-pointer list-none font-semibold text-foreground marker:hidden">
          <span className="flex items-center justify-between gap-4">
            <span>
              {t(`补充了解：${entityName.zh} 是什么`, `Background: what is ${entityName.en}`)}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("按需展开", "Expand if needed")}
            </span>
          </span>
        </summary>
        <div className="mt-5 space-y-4 border-t border-border pt-5 text-sm leading-7 text-ink-soft">
          {knowledge.introduction.map((paragraph, index) => (
            <p key={index}>{pick(paragraph, lang)}</p>
          ))}
        </div>
      </details>
    </div>
  );
}

function TechnicalKnowledgeArticle({
  knowledge,
  entityName,
  sectionEyebrow = "01",
}: KnowledgeArticleProps) {
  const { t, lang } = useApp();
  const sourcedPoints = knowledge.keyPoints.filter((point) => point.sourceIds?.length);

  return (
    <div
      className="flex flex-col gap-8"
      data-reading-mode="technical"
      data-reading-view="technical"
    >
      <section data-reading-block="guide">
        <SectionHeading
          eyebrow={sectionEyebrow}
          title={t(
            `${entityName.zh}：技术定义与证据口径`,
            `${entityName.en}: technical definition`,
          )}
          description={t(
            "只展示已有结构化资料和可追溯表述；缺少技术专用文本时沿用已审核原文。",
            "Uses structured, traceable material only; verified wording is retained when no technical variant exists.",
          )}
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
          <article className="paper-card p-6">
            <div className="space-y-4 text-sm leading-7 text-ink-soft">
              {knowledge.introduction.map((paragraph, index) => (
                <p key={index}>{pick(paragraph, lang)}</p>
              ))}
            </div>
          </article>
          <aside className="paper-card p-6">
            <div className="text-xs font-medium uppercase tracking-widest text-signal">
              {t("有直接来源的技术要点", "Source-backed technical points")}
            </div>
            <div className="mt-4 space-y-4">
              {(sourcedPoints.length > 0 ? sourcedPoints : knowledge.keyPoints).map(
                (point, index) => (
                  <div key={index} className="border-b border-border pb-4 last:border-0 last:pb-0">
                    <h3 className="text-sm font-semibold text-foreground">
                      {pick(point.title, lang)}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-ink-soft">
                      {pick(point.description, lang)}
                    </p>
                    <span className="mt-2 inline-block font-mono text-[11px] text-verified">
                      {t(
                        `${point.sourceIds?.length ?? 0} 个直接来源`,
                        `${point.sourceIds?.length ?? 0} direct sources`,
                      )}
                    </span>
                  </div>
                ),
              )}
            </div>
          </aside>
        </div>
      </section>

      <section
        data-reading-block="limitations"
        className="rounded-xl border border-border bg-muted/20 p-5"
      >
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <ShieldAlert className="h-4 w-4 text-signal" />
          {t("技术边界与证据限制", "Technical and evidence boundaries")}
        </div>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-ink-soft md:grid-cols-2">
          {knowledge.limitations.map((limitation, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{pick(limitation, lang)}</span>
            </li>
          ))}
        </ul>
      </section>

      {knowledge.useCases.length > 0 && (
        <details data-reading-block="use-cases" className="paper-card group p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-foreground marker:hidden">
            <span className="flex items-center justify-between gap-4">
              <span>{t("非技术信息：使用场景", "Non-technical context: use cases")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t(
                  `${knowledge.useCases.length} 项，默认收起`,
                  `${knowledge.useCases.length} items, collapsed`,
                )}
              </span>
            </span>
          </summary>
          <div className="mt-5 grid gap-4 border-t border-border pt-5 md:grid-cols-3">
            <UseCaseCards knowledge={knowledge} />
          </div>
        </details>
      )}
    </div>
  );
}

function UseCaseCards({ knowledge, limit }: { knowledge: Knowledge; limit?: number }) {
  const { lang } = useApp();

  return knowledge.useCases.slice(0, limit).map((useCase, index) => (
    <article key={index} className="paper-card p-5">
      <span className="font-mono text-xs text-signal">{String(index + 1).padStart(2, "0")}</span>
      <h3 className="mt-3 font-semibold text-foreground">{pick(useCase.title, lang)}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{pick(useCase.description, lang)}</p>
    </article>
  ));
}
