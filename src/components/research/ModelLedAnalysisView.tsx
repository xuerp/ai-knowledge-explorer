import { useApp } from "@/lib/app-state";
import { screeningReason } from "@/domain/model-led-reading";
import "./model-led.css";
import type { ModelLedLine, ResearchResult } from "@/services/user-api";

function Line({ line, index }: { line: ModelLedLine; index: string }) {
  const { t } = useApp();
  return (
    <li className="model-led__line" data-basis={line.basis}>
      <span>{line.text}</span>
      {line.basis === "verified" ? (
        <span className="model-led__sources">
          {line.claimIds.slice(0, 2).map((id, sourceIndex) => (
            <a
              key={id}
              href={`#claim-${id}`}
              aria-label={t(
                `${index} 的来源 ${sourceIndex + 1}`,
                `Source ${sourceIndex + 1} for ${index}`,
              )}
            >
              {t("来源", "Source")}
              {line.claimIds.length > 1 ? ` ${sourceIndex + 1}` : ""}
            </a>
          ))}
        </span>
      ) : (
        <span className="model-led__unverified">
          {t("模型常识，未核验", "Model knowledge, unverified")}
        </span>
      )}
    </li>
  );
}

function Section({
  title,
  lines,
  prefix,
}: {
  title: string;
  lines: ModelLedLine[];
  prefix: string;
}) {
  if (!lines.length) return null;
  return (
    <details className="decision-result-disclosure model-led__fold">
      <summary>
        {title}
        <span className="model-led__count">{lines.length}</span>
      </summary>
      <ul>
        {lines.map((line, index) => (
          <Line key={index} line={line} index={`${prefix} ${index + 1}`} />
        ))}
      </ul>
    </details>
  );
}

export function ModelLedAnalysisView({
  research,
  entityName,
  outcomeLevel,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
  outcomeLevel: 2 | 3;
}) {
  const { t } = useApp();
  const analysis = research.decision?.modelLed;
  if (!analysis) return null;
  const Heading = outcomeLevel === 2 ? "h2" : "h3";
  return (
    <section className="model-led" aria-label={t("模型分析", "Model analysis")}>
      <Heading className="decision-outcome__headline">{analysis.headline}</Heading>
      <p className="decision-outcome__summary">{analysis.summary.text}</p>
      <p className="model-led__source">
        {t(
          "由模型根据已收录资料和自身常识分析：带“来源”的内容已核验；标为“模型常识，未核验”的内容请自行确认。明确提出的硬条件已由系统检查。",
          "Analysed by a model from the catalog and its own knowledge. Items with a source are verified; items marked as model knowledge are unverified. Explicit hard requirements were checked by the system.",
        )}
      </p>
      <p className="model-led__understood">
        <strong>{t("理解的任务：", "Understood task: ")}</strong>
        {analysis.understoodTask}
      </p>
      {analysis.candidates.length > 0 && (
        <section className="model-led__section">
          <h4>{t("建议的选择", "Suggested options")}</h4>
          {analysis.candidates.map((candidate) => (
            <div key={candidate.entityId} className="model-led__candidate">
              <h5>
                {entityName(candidate.entityId)}
                <span className="model-led__role">
                  {candidate.role === "primary" ? t("首选", "Primary") : t("备选", "Alternative")}
                </span>
              </h5>
              <ul>
                {candidate.points.map((line, index) => (
                  <Line
                    key={index}
                    line={line}
                    index={`${entityName(candidate.entityId)} ${index + 1}`}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      <Section
        title={t("主要取舍", "Main tradeoffs")}
        lines={analysis.tradeoffs}
        prefix={t("取舍", "Tradeoff")}
      />
      <Section
        title={t("还需要确认", "Still to check")}
        lines={analysis.gaps}
        prefix={t("待确认", "Gap")}
      />
      <Section
        title={t("第一步", "First steps")}
        lines={analysis.firstSteps}
        prefix={t("步骤", "Step")}
      />
    </section>
  );
}

export function ModelLedScreening({
  research,
  entityName,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
}) {
  const { t, lang } = useApp();
  const analysis = research.decision?.modelLed;
  if (!analysis) return null;
  const excluded = new Map<string, string>();
  for (const item of analysis.pruned) {
    const reason = item.entityId ? screeningReason(item.reason, lang) : null;
    if (item.entityId && reason && !excluded.has(item.entityId))
      excluded.set(item.entityId, reason);
  }
  const removed = analysis.pruned.filter((item) => !screeningReason(item.reason, lang)).length;
  const citations = research.citations ?? [];
  const sources = new Set(citations.flatMap((item) => item.evidence.map((source) => source.id)));
  return (
    <details className="decision-result-disclosure model-led__screening">
      <summary>{t("其他候选与筛选依据", "Other options and screening")}</summary>
      <div className="model-led__screening-body">
        <section className="model-led__section">
          <h4>{t("未入选的候选", "Options not recommended")}</h4>
          {excluded.size ? (
            <ul>
              {[...excluded].map(([entityId, reason]) => (
                <li key={entityId} className="model-led__excluded">
                  <strong>{entityName(entityId)}</strong>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {t(
                "模型提出的候选都没有违反你的硬条件，没有被系统剔除。",
                "No proposed option violated your hard requirements.",
              )}
            </p>
          )}
        </section>
        <section className="model-led__section">
          <h4>{t("本次参考的资料", "Evidence used")}</h4>
          <p>
            {t(
              `已收录资料中的 ${citations.length} 条事实，来自 ${sources.size} 个来源。`,
              `${citations.length} facts from ${sources.size} sources in the catalog.`,
            )}
            {removed > 0 &&
              t(
                ` 另有 ${removed} 条模型内容因缺少依据或不符合规则，已在显示前删除。`,
                ` ${removed} model statements were removed before display for missing support or rule violations.`,
              )}
          </p>
        </section>
      </div>
    </details>
  );
}
