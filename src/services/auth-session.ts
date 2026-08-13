export const authSessionKey = "ai-radar-auth-session";
export const authSessionExpiredEvent = "ai-radar-auth-session-expired";

export function readAuthToken(): string {
  return typeof window === "undefined" ? "" : (window.sessionStorage.getItem(authSessionKey) ?? "");
}

export function writeAuthToken(token: string): void {
  window.sessionStorage.setItem(authSessionKey, token);
}

export function clearAuthToken(): void {
  window.sessionStorage.removeItem(authSessionKey);
}

export function expireAuthSession(): void {
  if (typeof window === "undefined") return;
  clearAuthToken();
  window.dispatchEvent(new Event(authSessionExpiredEvent));
}
