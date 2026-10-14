import labels from "@/data/model-spec-labels.json";

/** Translate billing qualifiers without changing the stored numbers or units. */
export function modelSpecChinese(value: string): string {
  for (const [original, translation] of Object.entries(labels)) {
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "g"), translation);
  }
  return value;
}
