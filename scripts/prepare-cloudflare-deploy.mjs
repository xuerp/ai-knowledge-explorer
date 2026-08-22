import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workerNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const verifiedCompatibilityDate = "2026-08-13";
const stagingApiUpstreamUrl = "https://ai-radar-api-staging.onrender.com";

export function buildStagingWranglerConfig(
  baseConfig,
  { workerName = "ai-radar-staging", domain = "" } = {},
) {
  const normalizedName = workerName.trim().toLowerCase();
  const normalizedDomain = domain.trim().toLowerCase();
  if (!workerNamePattern.test(normalizedName)) {
    throw new Error("Worker 名称只能包含小写字母、数字和连字符，且长度不能超过 63。\n");
  }
  if (normalizedDomain && !domainPattern.test(normalizedDomain)) {
    throw new Error("自定义域名必须是不含协议和路径的完整主机名。\n");
  }

  const config = { ...baseConfig };
  delete config.route;
  delete config.routes;
  config.name = normalizedName;
  // Nitro defaults to the local calendar date. Around UTC midnight that date can
  // still be in Cloudflare's future, so deployments must use a verified fixed date.
  config.compatibility_date = verifiedCompatibilityDate;
  config.workers_dev = !normalizedDomain;
  config.preview_urls = !normalizedDomain;
  config.observability = {
    enabled: true,
    head_sampling_rate: 1,
  };
  config.vars = {
    ...(config.vars ?? {}),
    AI_RADAR_API_UPSTREAM_URL: stagingApiUpstreamUrl,
  };
  if (normalizedDomain) {
    config.routes = [{ pattern: normalizedDomain, custom_domain: true }];
  }
  return config;
}

async function main() {
  const inputPath = resolve(process.argv[2] ?? ".output/server/wrangler.json");
  const outputPath = resolve(process.argv[3] ?? ".output/server/wrangler.staging.json");
  const baseConfig = JSON.parse(await readFile(inputPath, "utf8"));
  const config = buildStagingWranglerConfig(baseConfig, {
    workerName: process.env.AI_RADAR_CLOUDFLARE_WORKER_NAME,
    domain: process.env.AI_RADAR_CLOUDFLARE_DOMAIN,
  });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const route = config.routes?.[0]?.pattern ?? "workers.dev 预览地址";
  console.log(`已生成 ${outputPath}：${config.name} -> ${route}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
