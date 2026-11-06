import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import sharp from "sharp";

// The page, README and all browser/install formats share public/brand/radar.svg.
// Regenerate derived formats with npm run generate:icons.
const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);
const source = Buffer.from(
  (await readFile(publicFile("brand/radar.svg"), "utf8")).replace(/\r\n/g, "\n"),
);
const manifestFile = new URL("../product/brand-icons.v1.json", import.meta.url);
const outputs = [
  "brand/apple-touch-icon.png",
  "brand/icon-192.png",
  "brand/icon-512.png",
  "brand/favicon.ico",
  "favicon.ico",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fingerprint = async () => ({
  source: "public/brand/radar.svg",
  sourceSha256: hash(source),
  files: Object.fromEntries(
    await Promise.all(
      outputs.map(async (file) => [`public/${file}`, hash(await readFile(publicFile(file)))]),
    ),
  ),
});
if (process.argv.includes("--check")) {
  assert.deepEqual(
    JSON.parse(await readFile(manifestFile, "utf8")),
    await fingerprint(),
    "Brand assets drifted; run npm run generate:icons.",
  );
  console.log("Brand icon source and all generated formats match.");
  process.exit(0);
}
const png = (size) => sharp(source).resize(size, size).png().toBuffer();

for (const [name, size] of [
  ["brand/apple-touch-icon.png", 180],
  ["brand/icon-192.png", 192],
  ["brand/icon-512.png", 512],
]) {
  // Opaque, padded install icons keep the mark inside mobile mask safe areas.
  const markSize = Math.round(size * 0.75);
  const leading = Math.floor((size - markSize) / 2);
  const trailing = size - markSize - leading;
  const image = await sharp(source)
    .resize(markSize, markSize)
    .extend({
      top: leading,
      left: leading,
      bottom: trailing,
      right: trailing,
      background: "#ffffff",
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  await writeFile(publicFile(name), image);
}

// ICO directories can contain PNG images. Include native tab/bookmark sizes,
// rather than relying on a downscaled 256px template image.
const sizes = [16, 32, 48, 256];
const images = await Promise.all(sizes.map(png));
const directory = Buffer.alloc(6 + 16 * images.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
for (const [index, image] of images.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
}
const ico = Buffer.concat([directory, ...images]);
await writeFile(publicFile("brand/favicon.ico"), ico);
// Conventional fallback URL, generated from the same source; never a separate logo.
await writeFile(publicFile("favicon.ico"), ico);
await writeFile(manifestFile, JSON.stringify(await fingerprint(), null, 2) + "\n");
console.log("Generated blue browser/install icons from public/brand/radar.svg.");
