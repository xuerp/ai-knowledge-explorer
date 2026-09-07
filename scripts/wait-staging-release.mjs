import { pathToFileURL } from "node:url";

const fullCommitPattern = /^[0-9a-f]{40}$/;

function requiredUrl(value, label) {
  if (!value) throw new Error(`${label} 未配置。`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} 必须使用 HTTPS。`);
  return url;
}

export function normalizeExpectedCommit(value) {
  const commit = value?.trim().toLowerCase() ?? "";
  if (!fullCommitPattern.test(commit)) {
    throw new Error("AI_RADAR_EXPECTED_COMMIT 必须是完整的 40 位 Git commit。");
  }
  return commit;
}

async function fetchWithTimeout(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}。`);
  return response;
}

export async function readStagingCommits({ apiReadyUrl, frontendVersionUrl, fetchImpl = fetch }) {
  const [readyResponse, versionResponse] = await Promise.all([
    fetchWithTimeout(fetchImpl, apiReadyUrl),
    fetchWithTimeout(fetchImpl, frontendVersionUrl),
  ]);
  const ready = await readyResponse.json();
  return {
    backendCommit: String(ready.buildCommit ?? "")
      .trim()
      .toLowerCase(),
    frontendCommit: (await versionResponse.text()).trim().toLowerCase(),
    backendReady: ready.ok === true,
  };
}

export async function waitForStagingRelease({
  expectedCommit,
  apiReadyUrl,
  frontendVersionUrl,
  fetchImpl = fetch,
  maxAttempts = 45,
  intervalMs = 20_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onAttempt = () => {},
}) {
  let latest = null;
  let latestError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      latest = await readStagingCommits({ apiReadyUrl, frontendVersionUrl, fetchImpl });
      latestError = null;
      onAttempt({ attempt, ...latest });
      if (
        latest.backendReady &&
        latest.backendCommit === expectedCommit &&
        latest.frontendCommit === expectedCommit
      ) {
        return latest;
      }
    } catch (error) {
      latestError = error;
      onAttempt({ attempt, error: error instanceof Error ? error.message : String(error) });
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  const observed = latest
    ? `backend=${latest.backendCommit || "missing"}, frontend=${latest.frontendCommit || "missing"}`
    : `未读取到部署状态${latestError ? `：${latestError.message}` : ""}`;
  throw new Error(`staging 未在等待窗口内运行预期提交 ${expectedCommit}；${observed}。`);
}

async function main() {
  const expectedCommit = normalizeExpectedCommit(process.env.AI_RADAR_EXPECTED_COMMIT);
  const apiReadyUrl = requiredUrl(process.env.AI_RADAR_STAGING_READY_URL, "staging ready URL");
  const frontendVersionUrl = requiredUrl(
    process.env.AI_RADAR_STAGING_VERSION_URL,
    "staging version URL",
  );
  const result = await waitForStagingRelease({
    expectedCommit,
    apiReadyUrl,
    frontendVersionUrl,
    onAttempt: ({ attempt, backendCommit, frontendCommit, error }) => {
      console.log(
        error
          ? `等待 staging 第 ${attempt} 次：${error}`
          : `等待 staging 第 ${attempt} 次：backend=${backendCommit || "missing"}, frontend=${frontendCommit || "missing"}`,
      );
    },
  });
  console.log(JSON.stringify({ expectedCommit, ...result }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) await main();
