import type { DecisionValidationItem } from "@/services/user-api";

export function measurementRows(item: DecisionValidationItem, lang: "zh" | "en") {
  const m = item.measurements;
  if (!m) return [];
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const rows: Array<[string, string]> = [];
  if (m.successfulSamples != null)
    rows.push([
      t("本批合格样本数", "Successful samples in this batch"),
      String(m.successfulSamples),
    ]);
  if (m.minimumSuccessfulSamples != null)
    rows.push([
      t("试测前约定的最低合格样本数", "Minimum successful samples agreed before testing"),
      String(m.minimumSuccessfulSamples),
    ]);
  if (m.totalCost != null)
    rows.push([
      t("本批样本总费用", "Total cost for these samples"),
      `${m.totalCost} ${m.currency ?? t("币种未填", "currency missing")}`,
    ]);
  if (m.costBasis)
    rows.push([
      t("费用口径", "Cost basis"),
      m.costBasis === "actual-charge"
        ? t("用户记录的实际扣费", "User-recorded actual charge")
        : t("估算；不用于实际费用优先选择", "Estimate; excluded from actual-cost choice"),
    ]);
  if (m.sourceNote) rows.push([t("数值来源说明", "Measurement source"), m.sourceNote]);
  if (m.p50Ms != null) rows.push(["P50", `${m.p50Ms} ms`]);
  if (m.p95Ms != null) rows.push(["P95", `${m.p95Ms} ms`]);
  if (m.privacyVerified != null)
    rows.push([
      t("已测范围的隐私条件", "Privacy within the tested scope"),
      m.privacyVerified
        ? t("用户核验通过", "User verified")
        : t("用户核验未通过", "User verification failed"),
    ]);
  if (m.controlVerified != null)
    rows.push([
      t("已测范围的控制条件", "Control within the tested scope"),
      m.controlVerified
        ? t("用户核验通过", "User verified")
        : t("用户核验未通过", "User verification failed"),
    ]);
  return rows;
}

export function protocolRows(
  item: DecisionValidationItem,
  lang: "zh" | "en",
): Array<[string, string]> {
  const protocol = item.suggestedProtocol;
  if (!protocol) return [];
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return [
    [t("建议样本（不是实测结果）", "Suggested sample, not a result"), protocol.sample],
    [t("建议操作", "Suggested procedure"), protocol.procedure.join("；")],
    [t("应记录指标", "Metrics to record"), protocol.metrics.join("；")],
    [
      t("试测前确认的合格标准", "Acceptance criteria to confirm before testing"),
      protocol.acceptance.join("；"),
    ],
  ];
}
