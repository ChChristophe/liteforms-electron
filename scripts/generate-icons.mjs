// Generates the Liteforms application + tray icons from app/icon.svg using the
// already-installed `sharp` dependency. Outputs:
//   resources/icon-256.png  application icon (electron-builder converts to .ico)
//   resources/icon-32.png   system tray icon (crisp at high DPI)
//   resources/icon.ico      multi-size ICO (tray + app window icon)
// Run: node scripts/generate-icons.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "app", "icon.svg");
const outDir = join(root, "resources");

const sizes = [16, 24, 32, 48, 64, 128, 256];

function buildIco(images) {
  const headerSize = 6 + 16 * images.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const body = [];
  let offset = headerSize;
  images.forEach(({ size, png }, index) => {
    const entry = header.subarray(6 + index * 16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    body.push(png);
  });

  return Buffer.concat([header, ...body]);
}

const svg = await readFile(svgPath);
await mkdir(outDir, { recursive: true });

const pngs = [];
for (const size of sizes) {
  const png = await sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();
  pngs.push({ size, png });
  if (size === 256) await writeFile(join(outDir, "icon-256.png"), png);
  if (size === 32) await writeFile(join(outDir, "icon-32.png"), png);
}

await writeFile(join(outDir, "icon.ico"), buildIco(pngs));

console.log(`Generated resources/icon-256.png, resources/icon-32.png and resources/icon.ico (${sizes.join("/")}).`);