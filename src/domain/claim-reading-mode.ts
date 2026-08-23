import type { Claim, ReadingMode } from "@/domain/types";

const PRODUCT_TERMS = [
  "price",
  "pricing",
  "availability",
  "launch",
  "release",
  "product",
  "user",
  "cost",
  "价格",
  "定价",
  "发布",
  "上线",
  "可用",
  "产品",
  "用户",
  "成本",
];

const TECHNICAL_TERMS = [
  "api",
  "benchmark",
  "architecture",
  "context",
  "latency",
  "parameter",
  "token",
  "tool",
  "multimodal",
  "评测",
  "架构",
  "上下文",
  "延迟",
  "参数",
  "令牌",
  "工具",
  "多模态",
];

function searchableText(claim: Claim) {
  return [
    claim.subject,
    claim.predicate,
    claim.objectOrValue,
    claim.text.zh,
    claim.text.en,
    claim.text.technical?.zh,
    claim.text.technical?.en,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function keywordScore(text: string, terms: readonly string[]) {
  return terms.reduce((score, term) => score + Number(text.includes(term)), 0);
}

export function rankClaimsForReadingMode(claims: readonly Claim[], mode: ReadingMode): Claim[] {
  const terms = mode === "product" ? PRODUCT_TERMS : mode === "technical" ? TECHNICAL_TERMS : [];
  return [...claims].sort((left, right) => {
    const scoreDifference =
      keywordScore(searchableText(right), terms) - keywordScore(searchableText(left), terms);
    return (
      scoreDifference ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function claimTextForReadingMode(claim: Claim, mode: ReadingMode) {
  return mode === "technical" && claim.text.technical ? claim.text.technical : claim.text;
}
