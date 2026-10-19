#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "apps", "web", "public");
const sourceLogo = path.join(publicDir, "img", "logo-parallax.png");

/**
 * Builds a valid Microsoft ICO binary buffer containing multiple PNG images.
 * Universal format supported by all modern browsers (Safari, Chrome, Firefox, Edge).
 */
function buildIcoBuffer(images) {
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = ICO icon
  header.writeUInt16LE(count, 4); // image count

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // color count (0 for 32bpp)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.buffer.length, 8); // size of image data in bytes
    entry.writeUInt32LE(offset, 12); // offset of image data
    dirEntries.push(entry);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...images.map((img) => img.buffer)]);
}

export async function generateFavicons() {
  if (!fs.existsSync(sourceLogo)) {
    throw new Error(`Master logo file not found: ${sourceLogo}`);
  }

  // 1. Trim excessive transparent padding while preserving the full emblem & proportions
  const trimmedBuffer = await sharp(sourceLogo).trim().toBuffer();
  const trimmedMeta = await sharp(trimmedBuffer).metadata();
  const symbolWidth = trimmedMeta.width || 616;
  const symbolHeight = trimmedMeta.height || 970;

  // Helper to create square transparent favicon with centered symbol
  async function renderTransparentSquareIcon(size, paddingRatio = 0.08) {
    const availH = Math.round(size * (1 - paddingRatio * 2));
    const targetH = Math.max(1, availH);
    const targetW = Math.max(1, Math.round((targetH * symbolWidth) / symbolHeight));

    const resizedSymbol = await sharp(trimmedBuffer)
      .resize(targetW, targetH, { fit: "contain" })
      .toBuffer();

    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: resizedSymbol,
          top: Math.round((size - targetH) / 2),
          left: Math.round((size - targetW) / 2),
        },
      ])
      .png()
      .toBuffer();
  }

  // Helper for Apple Touch Icon: solid dark background #0C0F17 (--px-ink)
  async function renderAppleTouchIcon(size = 180) {
    const targetH = 130; // safe area for iOS rounded squircle mask
    const targetW = Math.round((targetH * symbolWidth) / symbolHeight);

    const resizedSymbol = await sharp(trimmedBuffer)
      .resize(targetW, targetH, { fit: "contain" })
      .toBuffer();

    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 12, g: 15, b: 23, alpha: 1 }, // #0C0F17
      },
    })
      .composite([
        {
          input: resizedSymbol,
          top: Math.round((size - targetH) / 2),
          left: Math.round((size - targetW) / 2),
        },
      ])
      .png()
      .toBuffer();
  }

  // Generate PNG variants
  const png16 = await renderTransparentSquareIcon(16, 0.06);
  const png32 = await renderTransparentSquareIcon(32, 0.08);
  const png48 = await renderTransparentSquareIcon(48, 0.08);
  const appleTouch = await renderAppleTouchIcon(180);

  // Generate ICO embedding 16x16, 32x32, and 48x48
  const icoBuffer = buildIcoBuffer([
    { width: 16, height: 16, buffer: png16 },
    { width: 32, height: 32, buffer: png32 },
    { width: 48, height: 48, buffer: png48 },
  ]);

  // Write outputs to apps/web/public
  fs.writeFileSync(path.join(publicDir, "favicon-16x16.png"), png16);
  fs.writeFileSync(path.join(publicDir, "favicon-32x32.png"), png32);
  fs.writeFileSync(path.join(publicDir, "favicon-48x48.png"), png48);
  fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), appleTouch);
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), icoBuffer);

  console.log("[OK] Favicons generated successfully in apps/web/public/ :");
  console.log("  - favicon.ico (16, 32, 48px)");
  console.log("  - favicon-16x16.png");
  console.log("  - favicon-32x32.png");
  console.log("  - favicon-48x48.png");
  console.log("  - apple-touch-icon.png (180x180)");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateFavicons().catch((err) => {
    console.error("[ERREUR] Échec de la génération des favicons:", err);
    process.exit(1);
  });
}
