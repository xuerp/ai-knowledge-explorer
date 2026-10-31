import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const status = JSON.parse(
  fs.readFileSync(path.join(root, "product/delivery-status.json"), "utf8").replace(/^\uFEFF/, ""),
);
const start = "<!-- delivery-status:start -->";
const end = "<!-- delivery-status:end -->";
const block = [
  start,
  "",
  "## 当前项目进度",
  "",
  `记录更新：${status.updatedAt}。${status.summary.zh}。`,
  "",
  status.boundary.zh,
  "",
  ...status.modules.flatMap((item) => [
    `- **${item.name.zh}**：${item.implemented.zh} ${item.verified.zh}`,
    "",
  ]),
  "统一来源：`product/delivery-status.json`。修改后运行 `npm run sync:delivery-status`；检查命令会阻止各入口进度漂移。",
  end,
].join("\n");
let failed = false;
for (const relative of [
  "docs/portfolio/CASE_STUDY.md",
  "docs/portfolio/VALIDATION.md",
  "docs/portfolio/WALKTHROUGH.md",
]) {
  const file = path.join(root, relative);
  const current = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const begin = current.indexOf(start),
    finish = current.indexOf(end);
  if (begin < 0 !== finish < 0) throw new Error(`Incomplete status markers: ${relative}`);
  const next =
    begin < 0
      ? `${current.trimEnd()}\n\n${block}\n`
      : current.slice(0, begin) + block + current.slice(finish + end.length);
  if (next === current) continue;
  if (process.argv.includes("--write")) fs.writeFileSync(file, next);
  else {
    console.error(`Delivery status out of sync: ${relative}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else
  console.log("Delivery status synchronized across the project page and three public documents.");
