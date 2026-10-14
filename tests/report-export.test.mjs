import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  configFile: false,
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { fetchReportBlob } = await vite.ssrLoadModule("/src/services/report-export.ts");
test.after(() => vite.close());

test("private report keeps authorization in the header and returns the correct file", async () => {
  for (const [format, type, text] of [
    ["md", "text/markdown", "# Report"],
    ["pdf", "application/pdf", "%PDF-1.7"],
  ]) {
    let calls = 0;
    const file = await fetchReportBlob("http://localhost/report", format, "fixture-token", {
      fetcher: async (url, init) => {
        calls++;
        assert.equal(url, "http://localhost/report");
        assert.equal(init.headers.Authorization, "Bearer fixture-token");
        return new Response(text, { headers: { "Content-Type": type } });
      },
    });
    assert.equal(await file.text(), text);
    assert.equal(calls, 1);
  }
});

test("expired sessions, error responses, HTML and empty bodies cannot become downloads", async () => {
  for (const response of [
    new Response("expired", { status: 401 }),
    new Response("unavailable", { status: 503 }),
    new Response("<html>sign in</html>", { headers: { "Content-Type": "text/html" } }),
    new Response("", { headers: { "Content-Type": "text/markdown" } }),
  ]) {
    let calls = 0;
    await assert.rejects(
      fetchReportBlob("http://localhost/report", "md", "fixture", {
        fetcher: async () => {
          calls++;
          return response;
        },
      }),
    );
    assert.equal(calls, 1, "Export failures must not silently repeat requests");
  }
});

test("deadline covers receiving headers", async () => {
  await assert.rejects(
    fetchReportBlob("http://localhost/report", "md", "", {
      timeoutMs: 10,
      fetcher: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    }),
    /报告导出超时/,
  );
});

test("deadline also covers a body stalled after successful headers", async () => {
  let bodyCancelled = false;
  await assert.rejects(
    fetchReportBlob("http://localhost/report", "md", "", {
      timeoutMs: 10,
      fetcher: async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
              init.signal.addEventListener("abort", () => {
                bodyCancelled = true;
                controller.error(new DOMException("aborted", "AbortError"));
              });
            },
          }),
          { headers: { "Content-Type": "text/markdown" } },
        ),
    }),
    /报告导出超时/,
  );
  assert.equal(bodyCancelled, true);
});
