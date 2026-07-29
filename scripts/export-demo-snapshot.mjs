import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "backend", "data");
const outputPath = path.join(outputDirectory, "demo_snapshot.json");

const server = await createServer({
  root: projectRoot,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const module = await server.ssrLoadModule("/src/data/demo-adapter.ts");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(module.DEMO_KNOWLEDGE_SNAPSHOT, null, 2)}\n`,
    "utf8",
  );
  console.log(`Exported demo snapshot to ${path.relative(projectRoot, outputPath)}`);
} finally {
  await server.close();
}
