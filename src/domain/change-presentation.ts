import type { ChangeEvent } from "@/domain/types";

export function changeDetailLabels(kind: ChangeEvent["kind"], lang: "zh" | "en") {
  const labels = {
    new: [
      ["发布前", "Before release"],
      ["发布内容", "What launched"],
      ["适用对象", "Who it serves"],
      ["采用建议", "Adoption guidance"],
    ],
    updated: [
      ["变化前", "Before"],
      ["变化后", "After"],
      ["受影响对象", "Affected users"],
      ["升级建议", "Upgrade guidance"],
    ],
    pricing: [
      ["原价格 / 额度", "Previous pricing / limits"],
      ["新价格 / 额度", "New pricing / limits"],
      ["适用范围", "Applicable scope"],
      ["成本建议", "Cost guidance"],
    ],
    availability: [
      ["此前访问条件", "Previous access"],
      ["当前访问条件", "Current access"],
      ["开放范围", "Access scope"],
      ["接入建议", "Access guidance"],
    ],
    deprecated: [
      ["原服务状态", "Previous service status"],
      ["弃用 / 下线安排", "Retirement schedule"],
      ["受影响用户", "Affected users"],
      ["迁移建议", "Migration guidance"],
    ],
    benchmark: [
      ["原评测口径", "Previous evaluation"],
      ["本次评测变化", "Evaluation change"],
      ["比较范围", "Comparison scope"],
      ["解读建议", "Interpretation guidance"],
    ],
    rumor: [
      ["已有信息", "Known information"],
      ["待核实消息", "Unverified report"],
      ["涉及对象", "Related entities"],
      ["核实建议", "Verification guidance"],
    ],
  };
  return labels[kind].map((label) => label[lang === "zh" ? 0 : 1]);
}

export function changeDetailFields(change: ChangeEvent, lang: "zh" | "en") {
  if (!change.detail) return [];
  const keys = ["before", "after", "affected", "action"] as const;
  const labels = changeDetailLabels(change.kind, lang);
  return keys
    .filter((key) => {
      if (key !== "before" || change.kind === "updated") return true;
      if (["new", "deprecated", "rumor"].includes(change.kind)) return false;
      return !/^(尚无|暂无|尚未|未提供|未公布)/.test(change.detail!.before.zh);
    })
    .map((key) => ({ label: labels[keys.indexOf(key)], value: change.detail![key] }));
}
