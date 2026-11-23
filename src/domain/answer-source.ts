/** How the answer text was produced, as shown next to a decision result. */
export type AnswerSourceNotice = "model-unavailable" | "invite-only" | null;

const providerFaults = new Set([
  "generation-invalid",
  "generation-provider-error",
  "generation-unavailable",
]);

/**
 * Model answers are limited to invited accounts. Everyone else receives an
 * extractive answer; that is an account scope and must not read as an outage.
 */
export function answerSourceNotice(reason: string | null | undefined): AnswerSourceNotice {
  if (reason === "generation-not-entitled") return "invite-only";
  if (reason && providerFaults.has(reason)) return "model-unavailable";
  return null;
}
