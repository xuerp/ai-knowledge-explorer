import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fullCommitPattern = /^[0-9a-f]{40}$/;

export function normalizeBuildCommit(value) {
  const commit = value?.trim().toLowerCase() ?? "";
  if (!fullCommitPattern.test(commit)) {
    throw new Error("build commit 必须是完整的 40 位 Git commit。");
  }
  return commit;
}

export async function stampBuildVersion(value, outputPath = ".output/public/version.txt") {
  const commit = normalizeBuildCommit(value);
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${commit}\n`, "utf8");
  return { commit, target };
}

async function main() {
  const result = await stampBuildVersion(
    process.argv[2] ?? process.env.AI_RADAR_BUILD_COMMIT,
    process.argv[3],
  );
  console.log(`已写入预发布版本标记：${result.commit} -> ${result.target}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await main();
