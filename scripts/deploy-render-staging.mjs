import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const stagingService = "srv-d9s7ljvavr4c73al2kjg";

export function deploymentUrl(hook, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) {
    throw new Error("Render deployment requires the verified full commit SHA.");
  }
  let url;
  try {
    url = new URL(hook);
  } catch {
    throw new Error("RENDER_STAGING_DEPLOY_HOOK is missing or invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.render.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/deploy/${stagingService}` ||
    !url.searchParams.get("key") ||
    [...url.searchParams.keys()].some((key) => key !== "key") ||
    url.searchParams.getAll("key").length !== 1
  ) {
    throw new Error("Render hook must target the existing staging service with one key.");
  }
  // Render disables Git auto-deploys for a commit-pinned hook. GitHub's tested
  // release job owns deployment, so post-deploy checks cannot block deployment.
  url.searchParams.set("ref", commit);
  return url;
}

export async function deployRenderStaging({ hook, commit, fetchImpl = fetch }) {
  const url = deploymentUrl(hook, commit);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // Fetch errors can include the hook URL. Neither errors nor response bodies
    // are printed because both may expose credentials or deployment internals.
    throw new Error("Render staging deployment request failed; credential details hidden.");
  }
  if (!response.ok) {
    throw new Error(`Render staging deployment was rejected (HTTP ${response.status}).`);
  }
  return { service: stagingService, commit, accepted: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        await deployRenderStaging({
          hook: process.env.RENDER_STAGING_DEPLOY_HOOK,
          commit: process.env.GITHUB_SHA,
        }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
