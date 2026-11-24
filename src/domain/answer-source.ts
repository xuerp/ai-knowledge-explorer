/** How the answer text was produced, as shown next to a decision result. */
export type AnswerSourceNotice =
  "model-unavailable" | "model-analysis-failed" | "invite-only" | null;

const providerFaults = new Set([
  "generation-invalid",
  "generation-provider-error",
  "generation-unavailable",
]);

/**
 * Model answers are limited to invited accounts. Everyone else receives an
 * extractive answer; that is an account scope and must not read as an outage.
 */
const modelAnalysisFaults = new Set([
  "model-led-invalid",
  "model-led-provider-error",
  "model-led-too-large",
  "model-led-unavailable",
]);

export function answerSourceNotice(reason: string | null | undefined): AnswerSourceNotice {
  if (reason === "generation-not-entitled") return "invite-only";
  // A model analysis that ran and failed is shown as such, with a retry.
  if (reason && modelAnalysisFaults.has(reason)) return "model-analysis-failed";
  if (reason && providerFaults.has(reason)) return "model-unavailable";
  return null;
}
