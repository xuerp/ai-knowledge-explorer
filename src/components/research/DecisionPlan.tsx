import type { DecisionResult } from "@/services/user-api";
import { useApp } from "@/lib/app-state";

export function DecisionPlan({
  plan,
  entityName,
  dimensionName,
}: {
  plan: NonNullable<DecisionResult["plan"]>;
  entityName: (id: string) => string;
  dimensionName: (id: string) => string;
}) {
  const { t } = useApp();
  const content = (action: (typeof plan.actions)[number]) => (
    <>
      {action.candidateIds.length > 3 ? (
        <details>
          <summary>
            {t(
              `查看适用的 ${action.candidateIds.length} 个候选`,
              `Inspect ${action.candidateIds.length} relevant candidates`,
            )}
          </summary>
          <p>{action.candidateIds.map(entityName).join("、")}</p>
        </details>
      ) : (
        !!action.candidateIds.length && (
          <p className="decision-plan__targets">
            {t("适用候选：", "Candidates: ")}
            {action.candidateIds.map(entityName).join("、")}
          </p>
        )
      )}
      {!!action.dimensions.length && (
        <p className="decision-plan__targets">
          {t("需要解决：", "Resolve: ")}
          {action.dimensions.map(dimensionName).join("、")}
        </p>
      )}
      <p>{action.instruction}</p>
      <p className="decision-plan__unlock">{action.unlocks}</p>
      {!!action.claimIds.length && (
        <div className="decision-brief__claims">
          {action.claimIds.map((id, index) => (
            <a key={id} href={`#claim-${id}`} className="text-signal hover:underline">
              {t("核对已有引用", "Inspect existing citation")} {index + 1}
            </a>
          ))}
        </div>
      )}
    </>
  );
  const first = plan.actions[0];
  return (
    <section className="decision-plan" aria-label={t("推进选择", "Move the decision forward")}>
      <h3>{t("现在先做什么", "What to do first")}</h3>
      {plan.trialCandidateIds.length > 3 ? (
        <p className="decision-plan__qualified">
          {t(
            `本次有 ${plan.trialCandidateIds.length} 个候选可开始小范围验证；先选 2–3 个使用同一批样本比较。`,
            `${plan.trialCandidateIds.length} candidates qualify for a limited trial; choose two or three to compare on identical samples.`,
          )}
        </p>
      ) : (
        !!plan.trialCandidateIds.length && (
          <p className="decision-plan__qualified">
            {t("可开始小范围验证：", "Ready for a limited trial: ")}
            <strong>{plan.trialCandidateIds.map(entityName).join("、")}</strong>
          </p>
        )
      )}
      {first && (
        <div>
          <h4>{first.title}</h4>
          {content(first)}
        </div>
      )}
      {plan.actions.length > 1 && (
        <details className="decision-plan__more">
          <summary>
            {t(
              `查看其余 ${plan.actions.length - 1} 项处理步骤`,
              `Inspect ${plan.actions.length - 1} additional actions`,
            )}
          </summary>
          {plan.actions.slice(1).map((action) => (
            <div className="decision-plan__additional" key={action.id}>
              <h4>
                {action.title}
                {action.dimensions.length
                  ? ` · ${action.dimensions.map(dimensionName).join("、")}`
                  : ""}
              </h4>
              {content(action)}
            </div>
          ))}
        </details>
      )}
      {plan.trial && (
        <details className="decision-plan__protocol">
          <summary>
            {plan.trialCandidateIds.length
              ? t(
                  "查看业务测试方案与合格标准",
                  "Inspect the trial protocol and acceptance criteria",
                )
              : t(
                  "资格核验后可用的业务测试方案",
                  "Business protocol to use after eligibility verification",
                )}
          </summary>
          <p className="decision-plan__targets">
            {t("以下是建议方案，尚未执行。", "Proposed protocol; it has not been executed.")}
          </p>
          <h4>{t("样本", "Sample")}</h4>
          <p>{plan.trial.sample}</p>
          {(
            [
              [t("操作", "Procedure"), plan.trial.procedure],
              [t("记录指标", "Metrics to record"), plan.trial.metrics],
              [t("怎样判定合格", "Acceptance criteria"), plan.trial.acceptance],
            ] as Array<[string, string[]]>
          ).map(([label, rows]) => (
            <div key={label}>
              <h4>{label}</h4>
              <ul>
                {rows.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </div>
          ))}
          <p>
            {t(
              "将实际结果保存到私人验证，再复核建议。更换版本、入口或样本后需要重新验证。",
              "Save actual results in private validation and review the recommendation. Revalidate after changing version, interface or sample.",
            )}
          </p>
        </details>
      )}
    </section>
  );
}
