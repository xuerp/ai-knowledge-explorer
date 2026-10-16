export const authSessionKey = "ai-radar-auth-session";
export const authSessionExpiredEvent = "ai-radar-auth-session-expired";
export const rememberedAuthKey = "ai-radar-remembered-session";

export function readAuthToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const token = window.sessionStorage.getItem(authSessionKey);
    if (token) return token;
  } catch {
    // Browser storage can be independently restricted.
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(rememberedAuthKey) ?? "null");
    if (
      saved &&
      typeof saved.token === "string" &&
      Number.isFinite(saved.expiresAt) &&
      saved.expiresAt > Date.now()
    )
      return saved.token;
    window.localStorage.removeItem(rememberedAuthKey);
  } catch {
    // Invalid or unavailable persistent storage never establishes a session.
  }
  return "";
}

export function writeAuthToken(token: string, remember = false, expiresIn = 0): void {
  clearAuthToken();
  if (remember && expiresIn > 0) {
    try {
      window.localStorage.setItem(
        rememberedAuthKey,
        JSON.stringify({ token, expiresAt: Date.now() + Math.min(expiresIn, 7 * 86400) * 1000 }),
      );
      return;
    } catch {
      // Keep a usable tab-only session if persistence is unavailable.
    }
  }
  window.sessionStorage.setItem(authSessionKey, token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  for (const storage of ["sessionStorage", "localStorage"] as const) {
    try {
      window[storage].removeItem(storage === "sessionStorage" ? authSessionKey : rememberedAuthKey);
    } catch {
      // Clearing either storage must still work when the other is blocked.
    }
  }
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith("ai-radar-api-trial-draft-v1:")) storage.removeItem(key);
    }
  } catch {
    // Draft storage may be restricted independently of authentication.
  }
}

export function expireAuthSession(): void {
  if (typeof window === "undefined") return;
  clearAuthToken();
  window.dispatchEvent(new Event(authSessionExpiredEvent));
}
