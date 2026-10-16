import { z } from "zod";

export const trialDraftPrefix = "ai-radar-api-trial-draft-v1:";
const draftSchema = z.object({
  task: z.string().max(5000),
  samples: z.string().max(500000),
  sampleMode: z.enum(["form", "json"]),
  sampleDrafts: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        input: z.string().max(20000),
        fields: z
          .array(
            z.object({
              name: z.string().max(100),
              type: z.enum(["text", "number", "boolean", "null", "json"]),
              value: z.string().max(20000),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .min(1)
    .max(20),
  instruction: z.string().max(5000),
  minimum: z.string().max(30),
  ceiling: z.string().max(30),
  currency: z.enum(["USD", "CNY"]),
});

/** Decoding only partitions local drafts. It never authenticates a request. */
export function trialDraftKey(token: string, researchId: string) {
  try {
    const owner = JSON.parse(
      atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
    ).sub;
    return typeof owner === "string" && owner.length > 0 && owner.length <= 200
      ? `${trialDraftPrefix}${owner}:${researchId}`
      : "";
  } catch {
    return "";
  }
}

export function parseTrialDraft(text: string | null, task: string) {
  try {
    if (!text || text.length > 600000) return null;
    const draft = draftSchema.parse(JSON.parse(text));
    return draft.task === task ? draft : null;
  } catch {
    return null;
  }
}

export class TrialSampleInputError extends Error {}

export type TrialSampleField = {
  name: string;
  type: "text" | "number" | "boolean" | "null" | "json";
  value: string;
};
export type TrialSampleDraft = { id: string; input: string; fields: TrialSampleField[] };

export function emptyTrialSample(id: string): TrialSampleDraft {
  return { id, input: "", fields: [{ name: "", type: "text", value: "" }] };
}

/** User-provided expected results only; never generates samples or scores. */
export function trialSampleJSON(drafts: TrialSampleDraft[], lang: "zh" | "en") {
  const fail = (zh: string, en: string): never => {
    throw new TrialSampleInputError(lang === "zh" ? zh : en);
  };
  if (!drafts.length || drafts.length > 20) fail("请填写 1–20 条样本。", "Provide 1–20 samples.");
  const ids = new Set<string>();
  const samples = drafts.map((draft, index) => {
    const prefix = lang === "zh" ? `样本 ${index + 1}：` : `Sample ${index + 1}: `;
    if (!draft.id || ids.has(draft.id))
      fail(`${prefix}样本编号重复。`, `${prefix}Sample ids must be unique.`);
    ids.add(draft.id);
    if (!draft.input.trim() || draft.input.length > 20000)
      fail(
        `${prefix}填写实际输入材料（最多 20000 字符）。`,
        `${prefix}Provide actual input, up to 20000 characters.`,
      );
    if (!draft.fields.length || draft.fields.length > 50)
      fail(`${prefix}填写 1–50 个正确字段。`, `${prefix}Provide 1–50 expected fields.`);
    const names = new Set<string>();
    const fields = draft.fields.map((field, fieldIndex) => {
      const name = field.name.trim();
      if (!name || name.length > 100 || names.has(name))
        fail(
          `${prefix}字段 ${fieldIndex + 1} 的名称不能为空、重复或超过 100 字符。`,
          `${prefix}Field ${fieldIndex + 1} needs a unique name of up to 100 characters.`,
        );
      names.add(name);
      let value: unknown = field.value;
      if (field.value.length > 20000)
        fail(
          `${prefix}${name} 的值超过 20000 字符。`,
          `${prefix}${name} exceeds 20000 characters.`,
        );
      if (field.type === "null") value = null;
      else if (field.type === "number") {
        if (
          !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(field.value.trim()) ||
          !Number.isFinite(Number(field.value))
        )
          fail(`${prefix}${name} 请填写有效数字。`, `${prefix}Enter a valid number for ${name}.`);
        value = Number(field.value);
        if (Number.isInteger(value) && !Number.isSafeInteger(value))
          fail(
            `${prefix}${name} 超出安全整数范围，请改用文字类型保留原值。`,
            `${prefix}${name} exceeds the safe integer range; use text to retain its value.`,
          );
      } else if (field.type === "boolean") {
        if (!["true", "false"].includes(field.value))
          fail(`${prefix}${name} 请选择“是”或“否”。`, `${prefix}Choose true or false for ${name}.`);
        value = field.value === "true";
      } else if (field.type === "json") {
        try {
          value = JSON.parse(field.value);
        } catch {
          fail(`${prefix}${name} 的 JSON 格式不正确。`, `${prefix}${name} contains invalid JSON.`);
        }
      } else if (field.type !== "text")
        fail(`${prefix}${name} 的值类型无效。`, `${prefix}${name} has an invalid value type.`);
      return [name, value] as const;
    });
    return { id: draft.id, input: draft.input, expected: Object.fromEntries(fields) };
  });
  const text = JSON.stringify(samples);
  if (text.length > 500000)
    fail(
      "样本总量超过 500000 字符，请分批验证。",
      "Samples exceed 500000 characters; split the batch.",
    );
  return text;
}
