import { createContext, useContext, useEffect, useState } from "react";
import { useApp } from "@/lib/app-state";
import { screeningReason } from "@/domain/model-led-reading";
import { readAuthToken } from "@/services/auth-session";
import {
  userApi,
  type KnowledgeCheck,
  type KnowledgeCheckPosition,
  type ModelLedLine,
  type ResearchResult,
} from "@/services/user-api";
import "./model-led.css";

type CheckState = {
  sent: (position: KnowledgeCheckPosition) => KnowledgeCheck | undefined;
  request: (position: KnowledgeCheckPosition) => Promise<void>;
  busy: string | null;
};
// Present only for the record owner; public shares never get a request button.
const CheckContext = createContext<CheckState | null>(null);
const positionKey = (position: KnowledgeCheckPosition) =>
  `${position.section}:${position.candidateIndex ?? ""}:${position.index}`;

function CheckButton({ position }: { position: KnowledgeCheckPosition }) {
  const { t } = useApp();
  const state = useContext(CheckContext);
  if (!state) return null;
  const sent = state.sent(position);
  if (sent) {
    return (
      <span className="model-led__check-sent">
        {sent.status === "resolved"
          ? t("已核验处理", "Verification handled")
          : sent.status === "rejected"
            ? t("无法核实", "Could not be verified")
            : t("已请求核验", "Verification requested")}
      </span>
    );
  }
  const key = positionKey(position);
  return (
    <button
      type="button"
      className="model-led__check"
      disabled={state.busy !== null}
      onClick={() => void state.request(position)}
    >
      {state.busy === key ? t("提交中…", "Sending…") : t("请求核验", "Request verification")}
    </button>
  );
}

function Line({
  line,
  index,
  position,
}: {
  line: ModelLedLine;
  index: string;
  position: KnowledgeCheckPosition;
}) {
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
        <span className="model-led__unverified-group">
          <span className="model-led__unverified">
            {t("模型常识，未核验", "Model knowledge, unverified")}
          </span>
          <CheckButton position={position} />
        </span>
      )}
    </li>
  );
}

function Section({
  title,
  lines,
  prefix,
  section,
}: {
  title: string;
  lines: ModelLedLine[];
  prefix: string;
  section: "tradeoffs" | "gaps" | "first_steps";
}) {
  const { t } = useApp();
  if (!lines.length) return null;
  return (
    <details className="decision-result-disclosure model-led__fold">
      <summary>{t(`${title}（${lines.length} 条）`, `${title} (${lines.length})`)}</summary>
      <ul>
        {lines.map((line, index) => (
          <Line
            key={index}
            line={line}
            index={`${prefix} ${index + 1}`}
            position={{ section, index }}
          />
        ))}
      </ul>
    </details>
  );
}

export function ModelLedAnalysisView({
  research,
  entityName,
  outcomeLevel,
  canRequestChecks = false,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
  outcomeLevel: 2 | 3;
  canRequestChecks?: boolean;
}) {
  const { t, lang } = useApp();
  const [checks, setChecks] = useState<KnowledgeCheck[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkError, setCheckError] = useState("");
  const owner = canRequestChecks && !!research.decision?.modelLed;
  useEffect(() => {
    if (!owner) return;
    const token = readAuthToken();
    if (!token) return;
    let cancelled = false;
    userApi
      .knowledgeChecks(token, research.id)
      .then((rows) => {
        if (!cancelled) setChecks(rows);
      })
      .catch(() => {
        /* The button still works; state just isn't preloaded. */
      });
    return () => {
      cancelled = true;
    };
  }, [owner, research.id]);
  const analysis = research.decision?.modelLed;
  if (!analysis) return null;
  const checkState: CheckState | null = owner
    ? {
        busy,
        sent: (position) => checks.find((row) => positionKey(row) === positionKey(position)),
        request: async (position) => {
          const token = readAuthToken();
          if (!token) {
            setCheckError(t("请先登录后再请求核验。", "Sign in to request verification."));
            return;
          }
          setBusy(positionKey(position));
          setCheckError("");
          try {
            const row = await userApi.requestKnowledgeCheck(token, research.id, position);
            setChecks((rows) => [
              ...rows.filter((item) => positionKey(item) !== positionKey(row)),
              row,
            ]);
          } catch {
            setCheckError(
              t("请求核验失败，请稍后重试。", "Could not request verification. Try again."),
            );
          } finally {
            setBusy(null);
          }
        },
      }
    : null;
  const Heading = outcomeLevel === 2 ? "h2" : "h3";
  // Only a real hard-requirement removal is worth a line; none means no line.
  const excluded = new Map<string, string>();
  for (const item of analysis.pruned) {
    const reason = item.entityId ? screeningReason(item.reason, lang) : null;
    if (item.entityId && reason && !excluded.has(item.entityId))
      excluded.set(item.entityId, reason);
  }
  return (
    <CheckContext.Provider value={checkState}>
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
            {analysis.candidates.map((candidate, candidateIndex) => (
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
                      position={{ section: "candidate", index, candidateIndex }}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {excluded.size > 0 && (
              <p className="model-led__excluded">
                {t("已排除：", "Excluded: ")}
                {[...excluded]
                  .map(([entityId, reason]) =>
                    t(
                      `${entityName(entityId)}（${reason}）`,
                      `${entityName(entityId)} (${reason})`,
                    ),
                  )
                  .join(t("；", "; "))}
              </p>
            )}
          </section>
        )}
        <Section
          title={t("主要取舍", "Main tradeoffs")}
          lines={analysis.tradeoffs}
          prefix={t("取舍", "Tradeoff")}
          section="tradeoffs"
        />
        <Section
          title={t("还需要确认", "Still to check")}
          lines={analysis.gaps}
          prefix={t("待确认", "Gap")}
          section="gaps"
        />
        <Section
          title={t("第一步", "First steps")}
          lines={analysis.firstSteps}
          prefix={t("步骤", "Step")}
          section="first_steps"
        />
        {checkError && (
          <p role="alert" className="model-led__check-error">
            {checkError}
          </p>
        )}
      </section>
    </CheckContext.Provider>
  );
}
