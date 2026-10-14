import { useApp } from "@/lib/app-state";
import type { DecisionValidationItem } from "@/services/user-api";
import { measurementRows, protocolRows } from "@/domain/decision-measurements";

export function DecisionMeasurements({
  item,
  onChange,
}: {
  item: DecisionValidationItem;
  onChange: (patch: Partial<DecisionValidationItem>) => void;
}) {
  const { t, lang } = useApp();
  const m = item.measurements ?? {};
  const kind = item.id.split("-").at(-1);
  const update = (patch: Partial<NonNullable<DecisionValidationItem["measurements"]>>) =>
    onChange({ measurements: patch });
  const numberField = (
    key: "totalCost" | "p50Ms" | "p95Ms" | "successfulSamples" | "minimumSuccessfulSamples",
    label: string,
  ) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min={key === "minimumSuccessfulSamples" ? 1 : 0}
        step={key.endsWith("Samples") ? 1 : "any"}
        value={m[key] ?? ""}
        onChange={(event) =>
          update({ [key]: event.target.value === "" ? null : Number(event.target.value) })
        }
      />
    </label>
  );
  return (
    <>
      {item.suggestedProtocol && (
        <details className="decision-validation__conditions">
          <summary>{t("本项建议测试方案", "Suggested protocol for this check")}</summary>
          <p>
            {t(
              "这是清单生成时保存的建议，尚未执行。请先确认样本和合格标准，再填写实际结果。",
              "This saved suggestion has not been executed. Confirm samples and criteria before recording actual results.",
            )}
          </p>
          <dl>
            {protocolRows(item, lang).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {["quality", "cost", "latency", "terms"].includes(kind ?? "") && (
        <details className="decision-validation__conditions">
          <summary>
            {t("填写可核对的实测数值与条件", "Record comparable measurements and checks")}
          </summary>
          <p>
            {t(
              "未测项留空。数值只描述本批样本；保存后仅与相同口径、任务和入口核验通过的记录比较。",
              "Leave untested fields blank. Values describe these samples only; comparisons require matching conditions and passed task and entry checks.",
            )}
          </p>
          <div className="decision-validation__condition-fields">
            {kind === "quality" && (
              <>
                {numberField(
                  "successfulSamples",
                  t("本批合格样本数", "Successful samples in this batch"),
                )}
                {numberField(
                  "minimumSuccessfulSamples",
                  t(
                    "试测前约定的最低合格样本数",
                    "Minimum successful samples agreed before testing",
                  ),
                )}
                <p>
                  {t(
                    "必须与本项样本总数一致：合格数和最低要求均不能超过总数。不同最低要求分组比较；没有数值时只支持限定范围试用，不排名。",
                    "Counts must not exceed the sample total above. Different thresholds are compared separately; records without counts support a scoped trial without ranking.",
                  )}
                </p>
              </>
            )}
            {kind === "cost" && (
              <>
                {numberField("totalCost", t("本批样本总费用", "Total cost for these samples"))}
                <label>
                  {t("实际计费币种", "Billing currency")}
                  <input
                    value={m.currency ?? ""}
                    maxLength={3}
                    placeholder="USD / CNY"
                    onChange={(event) =>
                      update({ currency: event.target.value.trim().toUpperCase() || null })
                    }
                  />
                </label>
                <label>
                  {t("费用口径", "Cost basis")}
                  <select
                    value={m.costBasis ?? ""}
                    onChange={(event) =>
                      update({ costBasis: (event.target.value || null) as typeof m.costBasis })
                    }
                  >
                    <option value="">{t("尚未核验", "Not verified")}</option>
                    <option value="actual-charge">
                      {t("账单或账户实际扣费", "Actual bill or account charge")}
                    </option>
                    <option value="estimate">
                      {t("估算，不作为实际费用主选依据", "Estimate; not an actual-cost choice")}
                    </option>
                  </select>
                </label>
                <label>
                  {t("账单或估算来源说明", "Bill or estimate source")}
                  <input
                    maxLength={500}
                    value={m.sourceNote ?? ""}
                    onChange={(event) => update({ sourceNote: event.target.value })}
                  />
                </label>
              </>
            )}
            {kind === "latency" && (
              <>
                {numberField("p50Ms", t("本批任务 P50（毫秒）", "Task P50 (milliseconds)"))}
                {numberField("p95Ms", t("本批任务 P95（毫秒）", "Task P95 (milliseconds)"))}
              </>
            )}
            {kind === "terms" &&
              (["privacyVerified", "controlVerified"] as const).map((key) => (
                <label key={key}>
                  {key === "privacyVerified"
                    ? t("本次范围的隐私条件核验", "Privacy checks for this scope")
                    : t("本次范围的权限与控制核验", "Permissions and control for this scope")}
                  <select
                    value={m[key] == null ? "" : String(m[key])}
                    onChange={(event) =>
                      update({
                        [key]: event.target.value === "" ? null : event.target.value === "true",
                      })
                    }
                  >
                    <option value="">{t("尚未核验", "Not verified")}</option>
                    <option value="true">
                      {t(
                        "已核验通过，依据记在实际结果中",
                        "Verified; evidence recorded in results",
                      )}
                    </option>
                    <option value="false">{t("已核验未通过", "Verification failed")}</option>
                  </select>
                </label>
              ))}
          </div>
        </details>
      )}
    </>
  );
}

export function RecordedMeasurements({ item }: { item: DecisionValidationItem }) {
  const { lang } = useApp();
  const rows = measurementRows(item, lang);
  return rows.length ? (
    <dl className="decision-validation__review-note">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
}
