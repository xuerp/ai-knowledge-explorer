import { AuthSessionExpiredError } from "./auth-errors";

export class ReportExportError extends Error {
  constructor(
    message: string,
    public readonly englishMessage: string,
  ) {
    super(message);
    this.name = "ReportExportError";
  }
}

/** One bounded request, including reading the body; no silent export retry. */
export async function fetchReportBlob(
  url: string,
  format: "pdf" | "md",
  token = "",
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<Blob> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 45_000);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (response.status === 401) throw new AuthSessionExpiredError();
    if (!response.ok)
      throw new ReportExportError(
        `报告导出失败（${response.status}），请重试。`,
        `Report export failed (${response.status}). Try again.`,
      );
    const contentType = response.headers.get("Content-Type")?.split(";")[0].trim();
    if (
      format === "pdf"
        ? contentType !== "application/pdf"
        : !["text/markdown", "text/plain"].includes(contentType ?? "")
    )
      throw new ReportExportError(
        "未收到正确格式的报告，请重新导出。",
        "The response was not a report file. Export it again.",
      );
    const blob = await response.blob();
    if (!blob.size)
      throw new ReportExportError(
        "报告文件为空，请重新导出。",
        "The report is empty. Export it again.",
      );
    return blob;
  } catch (error) {
    if (timedOut)
      throw new ReportExportError(
        "报告导出超时，请重试。当前研究记录已保留。",
        "Report export timed out. Try again; your research record is preserved.",
      );
    if (error instanceof AuthSessionExpiredError || error instanceof ReportExportError) throw error;
    throw new ReportExportError(
      "暂时无法下载报告，请检查连接后重试。",
      "The report could not be downloaded. Check the connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }
}
