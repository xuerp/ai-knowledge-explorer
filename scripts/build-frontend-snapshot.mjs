import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { format, resolveConfig } from "prettier";
import { applyCatalogOverlays, publicCatalogSnapshot } from "../src/data/catalog-overlay.mjs";

const root = new URL("../", import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const server = await createServer({
  root: fileURLToPath(root),
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const { BASE_DEMO_KNOWLEDGE_SNAPSHOT } = await server.ssrLoadModule("/src/data/demo-baseline.ts");
  const [extension, frontier, manifest] = await Promise.all([
    read("backend/data/catalog_extension.json"),
    read("backend/data/frontier_catalog_v1.json"),
    read("product/core-models.v1.json"),
  ]);
  const snapshot = publicCatalogSnapshot(
    applyCatalogOverlays(BASE_DEMO_KNOWLEDGE_SNAPSHOT, extension, frontier),
  );
  const ids = new Set(snapshot.entities.map((entity) => entity.id));
  for (const model of manifest.models) {
    if (!ids.has(model.entityId)) throw new Error(`Missing core model: ${model.entityId}`);
  }
  // Preserve the full public catalog. The manifest validates coverage; it does not filter records.
  const output = new URL("src/data/generated/snapshot.json", root);
  const expected = await format(JSON.stringify(snapshot), {
    ...(await resolveConfig(fileURLToPath(output))),
    parser: "json",
  });
  if (process.argv.includes("--write")) {
    await mkdir(new URL(".", output), { recursive: true });
    await writeFile(output, expected);
  } else {
    const actual = await readFile(output, "utf8").catch(() => "");
    if (actual.replace(/\r\n/g, "\n") !== expected.replace(/\r\n/g, "\n")) {
      throw new Error("Frontend snapshot is stale. Run npm run generate:frontend-snapshot.");
    }
  }
  console.log(
    `Frontend snapshot: ${snapshot.entities.length} entities, ${snapshot.claims.length} claims.`,
  );
} finally {
  await server.close();
}
