export type FetchWithRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export async function fetchWithNetworkRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 600);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 75_000);
  const fetcher = options.fetcher ?? fetch;
  const method = (init.method ?? "GET").toUpperCase();
  const retryable = RETRYABLE_METHODS.has(method);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("The request timed out.", "TimeoutError"));
  }, timeoutMs);

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetcher(input, { ...init, signal: controller.signal });
        if (!retryable || !RETRYABLE_STATUSES.has(response.status) || attempt >= attempts) {
          return response;
        }
        await wait(baseDelayMs * attempt, controller.signal);
      } catch (error) {
        if (timedOut) {
          throw new Error("后端请求超时，请稍后重试；若已登录，其他后台数据仍可继续加载。");
        }
        if (isAbortError(error)) throw error;
        if (!retryable || attempt >= attempts) {
          throw new Error("暂时无法连接后端 API，服务可能正在唤醒，请稍后刷新重试。");
        }
        await wait(baseDelayMs * attempt, controller.signal);
      }
    }
    throw new Error("暂时无法连接后端 API，服务可能正在唤醒，请稍后刷新重试。");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function wait(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      },
      { once: true },
    );
  });
}
