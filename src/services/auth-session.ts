export const authSessionKey = "ai-radar-auth-session";

export function readAuthToken(): string {
  return typeof window === "undefined" ? "" : (window.sessionStorage.getItem(authSessionKey) ?? "");
}

export function writeAuthToken(token: string): void {
  window.sessionStorage.setItem(authSessionKey, token);
}

export function clearAuthToken(): void {
  window.sessionStorage.removeItem(authSessionKey);
}
