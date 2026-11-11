export class AuthRequestError extends Error {
  constructor(
    message: string,
    public readonly englishMessage: string,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

export class AuthSessionExpiredError extends AuthRequestError {
  constructor() {
    super("登录已过期，请重新登录。", "Your session has expired. Sign in again.");
    this.name = "AuthSessionExpiredError";
  }
}

export function apiAvailabilityError(status: number): AuthRequestError | null {
  if (status === 504) {
    return new AuthRequestError("服务响应超时，请重试。", "The service timed out. Try again.");
  }
  if (status === 502 || status === 503) {
    return new AuthRequestError(
      "暂时无法连接服务，请重试。",
      "The service is temporarily unavailable. Try again.",
    );
  }
  return null;
}

export function authResponseError(status: number, hasToken: boolean, path: string): Error | null {
  if (status === 401 && hasToken) return new AuthSessionExpiredError();
  if (!path.startsWith("/api/v2/auth/")) return null;
  if (status === 401)
    return new AuthRequestError("邮箱或密码不正确，请检查后重试。", "Incorrect email or password.");
  if (status === 409)
    return new AuthRequestError(
      "该邮箱已注册，请直接登录。",
      "This email is already registered. Sign in instead.",
    );
  if (status === 429)
    return new AuthRequestError(
      "尝试次数过多，请稍后重试。",
      "Too many attempts. Try again shortly.",
    );
  if (status >= 500)
    return new AuthRequestError(
      "登录服务暂时不可用，请稍后重试。",
      "Sign-in service is temporarily unavailable.",
    );
  return null;
}

export function accountErrorMessage(
  reason: unknown,
  t: (zh: string, en: string) => string,
): string {
  if (reason instanceof AuthRequestError) return t(reason.message, reason.englishMessage);
  if (reason instanceof Error) {
    if (reason.message === "暂时无法连接后端 API，服务可能正在唤醒，请稍后刷新重试。")
      return t("暂时无法连接服务，请重试。", "The service is temporarily unavailable. Try again.");
    if (reason.message === "后端请求超时，请稍后重试；若已登录，其他后台数据仍可继续加载。")
      return t("服务响应超时，请重试。", "The service timed out. Try again.");
  }
  return reason instanceof Error
    ? reason.message
    : t("操作失败，请重试。", "Operation failed. Try again.");
}
