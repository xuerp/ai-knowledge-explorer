export type FetchWithRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  fetcher?: typeof fetch;
};

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function fetchWithNetworkRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 600);
  const fetcher = options.fetcher ?? fetch;
  const method = (init.method ?? "GET").toUpperCase();
  const retryable = RETRYABLE_METHODS.has(method);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetcher(input, init);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!retryable || attempt >= attempts) {
        throw new Error("暂时无法连接后端 API，服务可能正在唤醒，请稍后刷新重试。");
      }
      await wait(baseDelayMs * attempt, init.signal);
    }
  }
  throw new Error("暂时无法连接后端 API，服务可能正在唤醒，请稍后刷新重试。");
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
