import { readFile, writeFile } from "node:fs/promises";

import sharp from "sharp";

// Keep one authored mark. Regenerate browser/install formats with npm run generate:icons.
const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);
const source = await readFile(publicFile("icon.svg"));
const png = (size) => sharp(source).resize(size, size).png().toBuffer();

for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]) {
  await writeFile(publicFile(name), await png(size));
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
await writeFile(publicFile("favicon.ico"), Buffer.concat([directory, ...images]));
console.log("Generated favicon.ico and install icons from public/icon.svg.");
