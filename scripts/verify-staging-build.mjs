import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function verifyStagingBuild(
  outputDirectory = ".output",
  expectedApiProxy = "https://ai-radar-staging.1966761779.workers.dev/backend",
  expectedApiUpstream = "https://ai-radar-api-staging.onrender.com",
) {
  const root = resolve(outputDirectory);
  const files = await collectFiles(root);
  const textFiles = files.filter((file) => /\.(?:html|js|mjs|json)$/.test(file));
  let combined = "";
  for (const file of textFiles) combined += await readFile(file, "utf8");
  if (!combined.includes(expectedApiProxy)) {
    throw new Error(`预发构建未包含预期同域 API 代理：${expectedApiProxy}`);
  }
  if (!combined.includes(expectedApiUpstream)) {
    throw new Error(`预发构建未包含预期 API 上游：${expectedApiUpstream}`);
  }
  if (combined.includes("http://127.0.0.1:8001")) {
    throw new Error("预发构建错误地包含本机 API 地址，拒绝部署。");
  }
  return { filesChecked: textFiles.length, expectedApiProxy, expectedApiUpstream };
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const result = await verifyStagingBuild();
  console.log(
    `预发构建验证通过：检查 ${result.filesChecked} 个文件，代理为 ${result.expectedApiProxy}`,
  );
}
