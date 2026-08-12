import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function verifyStagingBuild(
  outputDirectory = ".output",
  expectedApiOrigin = "https://ai-radar-api-staging.onrender.com",
) {
  const root = resolve(outputDirectory);
  const files = await collectFiles(root);
  const textFiles = files.filter((file) => /\.(?:html|js|mjs|json)$/.test(file));
  let combined = "";
  for (const file of textFiles) combined += await readFile(file, "utf8");
  if (!combined.includes(expectedApiOrigin)) {
    throw new Error(`预发构建未包含预期 API 地址：${expectedApiOrigin}`);
  }
  if (combined.includes("http://127.0.0.1:8001")) {
    throw new Error("预发构建错误地包含本机 API 地址，拒绝部署。");
  }
  return { filesChecked: textFiles.length, expectedApiOrigin };
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
    `预发构建验证通过：检查 ${result.filesChecked} 个文件，API 为 ${result.expectedApiOrigin}`,
  );
}
