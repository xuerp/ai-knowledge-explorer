import { Link } from "@tanstack/react-router";
import { useApp } from "@/lib/app-state";
import type { ResearchResult } from "@/services/user-api";

export function DecisionBrief({
  research,
  entityName,
  isComparable = () => true,
}: {
  research: ResearchResult;
  entityName: (id: string) => string;
  isComparable?: (id: string) => boolean;
}) {
  const { t } = useApp();
  const decision = research.decision;
  if (!decision) return null;
  const compareIds = [
    decision.recommendation.primaryEntityId,
    ...decision.recommendation.alternativeEntityIds,
  ].filter((id): id is string => typeof id === "string" && isComparable(id));

  return (
    <section
      className="paper-card space-y-5 p-5"
      aria-label={t("结构化决策说明", "Decision brief")}
    >
      <div>
        <div className="mono-meta">{t("有条件建议", "Conditional recommendation")}</div>
        <p className="mt-2 text-base font-semibold leading-relaxed text-foreground">
          {decision.recommendation.summary}
        </p>
        {decision.recommendation.primaryEntityId && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("优先核验", "Validate first")}：
            <span className="font-medium text-foreground">
              {entityName(decision.recommendation.primaryEntityId)}
            </span>
          </p>
        )}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <DecisionList title={t("成立条件", "Conditions")} items={decision.conditions} />
        <EvidenceBoundList
          title={t("权衡与边界", "Trade-offs and bounds")}
          items={decision.tradeoffs}
        />
        <EvidenceBoundList
          title={t("风险与未知", "Risks and unknowns")}
          items={decision.risks.map((item) => ({
            finding: item.detail,
            claimIds: item.claimIds,
          }))}
        />
        <DecisionList title={t("下一步核验", "Next checks")} items={decision.nextChecks} />
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
        <span>
          {t("证据截止", "Evidence as of")} {new Date(decision.asOf).toLocaleString()}
        </span>
        {compareIds.length >= 2 && (
          <Link
            to="/compare"
            search={{ models: compareIds.join(",") }}
            className="font-medium text-signal hover:underline"
          >
            {t("带入 Compare", "Open in Compare")} →
          </Link>
        )}
      </div>
    </section>
  );
}

function DecisionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {items.length ? (
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
          {items.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

function EvidenceBoundList({
  title,
  items,
}: {
  title: string;
  items: Array<{ finding: string; claimIds: string[] }>;
}) {
  const { t } = useApp();
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {items.length ? (
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
          {items.map((item) => (
            <li key={`${item.finding}-${item.claimIds.join("-")}`}>
              <span>· {item.finding}</span>
              {item.claimIds.length > 0 && (
                <span className="ml-2 inline-flex flex-wrap gap-1">
                  {item.claimIds.map((claimId) => (
                    <a
                      key={claimId}
                      href={`#claim-${claimId}`}
                      className="font-mono text-xs text-signal hover:underline"
                    >
                      {t("结论", "Claim")} {claimId}
                    </a>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}
