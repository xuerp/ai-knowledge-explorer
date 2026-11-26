import type { Claim } from "@/domain/types";

export type SpecField = "context_window" | "input_price" | "output_price" | "released_at";

const labels: Record<SpecField, string> = {
  context_window: "上下文窗口",
  input_price: "输入价格",
  output_price: "输出价格",
  released_at: "发布日期",
};

export function specFieldLabel(field: SpecField): string {
  return labels[field];
}

// Mirrors backend/app/spec_verification.py so the entity page can show each card
// field's reviewed basis from the claims it already loads. Keep the rules in sync.
const FIELD_PREDICATES: Record<SpecField, RegExp> = {
  context_window: /context[- ]?(window|length)|max(imum)?[- ]?context/,
  input_price: /input[- ]?price|price[- ]?input|prompt[- ]?price/,
  output_price: /output[- ]?price|price[- ]?output|completion[- ]?price/,
  released_at: /^(release|released-on|launched-on|release-date)$/,
};
const EXCLUDED = /historical|channel|promo|batch|cached|unverified/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function specFieldFor(predicate: string | null | undefined): SpecField | null {
  const value = (predicate ?? "").toLowerCase();
  if (!value || EXCLUDED.test(value)) return null;
  for (const field of Object.keys(FIELD_PREDICATES) as SpecField[]) {
    if (FIELD_PREDICATES[field].test(value)) return field;
  }
  return null;
}

function tokenCount(text: string): number | null {
  const compact = text.replaceAll(",", "").toLowerCase();
  const scaled = /(\d+(?:\.\d+)?)\s*([km])\b/.exec(compact);
  if (scaled) return Math.round(Number(scaled[1]) * (scaled[2] === "k" ? 1_000 : 1_000_000));
  const plain = /\b(\d{4,9})\b/.exec(compact);
  return plain ? Number(plain[1]) : null;
}

function price(text: string): number | null {
  const compact = text.replaceAll(",", "");
  const pattern = /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:usd|美元)|usd\s*(\d+(?:\.\d+)?)/gi;
  const values = new Set([...compact.matchAll(pattern)].map((m) => Number(m[1] ?? m[2] ?? m[3])));
  return values.size === 1 ? [...values][0] : null;
}

export function normalizedSpec(field: SpecField, value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text || text.length > 80 || /[。，；！？]/.test(text)) return null;
  if (field === "released_at") return DATE.test(text) ? text : null;
  return field === "context_window" ? tokenCount(text) : price(text);
}

export function sameSpec(field: SpecField, left: number | string, right: number | string) {
  if (field === "context_window") {
    const [a, b] = [Number(left), Number(right)];
    return Math.abs(a - b) <= Math.max(a, b) * 0.05;
  }
  if (field === "input_price" || field === "output_price") {
    return Math.abs(Number(left) - Number(right)) < 0.005;
  }
  return left === right;
}

export interface SpecBasis {
  claim: Claim;
  differs: boolean;
}

/** Latest verified, comparable fact behind one card field, and whether it differs. */
export function specBasis(
  entityId: string,
  field: SpecField,
  cardValue: string | null | undefined,
  claims: readonly Claim[],
): SpecBasis | null {
  let latest: Claim | null = null;
  const stamp = (claim: Claim) => claim.validFrom ?? claim.updatedAt ?? "";
  for (const claim of claims) {
    if (claim.entityId !== entityId || claim.confidence !== "verified") continue;
    if (specFieldFor(claim.predicate) !== field) continue;
    if (normalizedSpec(field, claim.objectOrValue) === null) continue;
    if (!latest || stamp(claim) > stamp(latest)) latest = claim;
  }
  if (!latest) return null;
  const fact = normalizedSpec(field, latest.objectOrValue);
  const card = normalizedSpec(field, cardValue);
  return { claim: latest, differs: card !== null && fact !== null && !sameSpec(field, fact, card) };
}
