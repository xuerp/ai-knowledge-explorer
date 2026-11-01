const recoveryKey = "ai-radar-asset-recovery-v1";
const recoveryCooldownMs = 5 * 60 * 1000;

export function isAssetLoadError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  return /Unable to preload CSS for|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk .+ failed/i.test(
    message,
  );
}

/** Refresh a stale document once; never clear the user's session or drafts. */
export function recoverStaleAssets(error: unknown, now = Date.now()): boolean {
  if (!isAssetLoadError(error) || typeof window === "undefined") return false;
  try {
    const previous = window.sessionStorage.getItem(recoveryKey);
    const lastRecovery = previous === null ? NaN : Number(previous);
    if (Number.isFinite(lastRecovery) && now - lastRecovery < recoveryCooldownMs) return false;
    window.sessionStorage.setItem(recoveryKey, String(now));
    window.location.reload();
    return true;
  } catch {
    // Without a persistent guard, leave recovery to the explicit refresh button.
    return false;
  }
}
