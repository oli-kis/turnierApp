import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the PWA icon set from the „Anzeigetafel" palette.
 *
 * The mark is the scoreboard itself: a pine slab, a chalk band where the score
 * would be flipped, and the live-orange progress bar under it — the same three
 * elements as the app's signature ScoreCard.
 *
 * Everything here is axis-aligned rectangles, which is why this script can write
 * PNGs with nothing but node's zlib: no font rasterization, no canvas, no
 * native image dependency to install on a build machine.
 *
 * Run: npm run icons
 */

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons");

const PINE = [26, 90, 72]; // --color-pine
const PINE_DEEP = [14, 61, 48]; // --color-pine-deep
const CHALK = [246, 246, 242]; // --color-chalk
const LIVE = [232, 89, 12]; // --color-live

/* --------------------------------------------------------------- PNG encoding */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encode RGBA pixel data as a PNG buffer. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ drawing */

function canvas(size, [r, g, b]) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = 255;
  }
  return px;
}

function rect(px, size, x0, y0, w, h, [r, g, b]) {
  const xEnd = Math.min(size, Math.round(x0 + w));
  const yEnd = Math.min(size, Math.round(y0 + h));
  for (let y = Math.max(0, Math.round(y0)); y < yEnd; y++) {
    for (let x = Math.max(0, Math.round(x0)); x < xEnd; x++) {
      const i = (y * size + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
}

/**
 * @param size    pixel dimensions
 * @param padding fraction of the canvas kept clear around the mark. Maskable
 *                icons get a wide margin so Android can crop to a circle without
 *                clipping the scoreboard.
 */
function drawIcon(size, padding) {
  const px = canvas(size, PINE);
  const inset = size * padding;
  const boardW = size - inset * 2;
  const boardH = boardW * 0.62;
  const boardX = inset;
  const boardY = (size - boardH) / 2;

  // Slab shadow, then the board face.
  rect(px, size, boardX, boardY, boardW, boardH, PINE_DEEP);
  rect(px, size, boardX, boardY, boardW, boardH * 0.7, CHALK);

  // The gap between the two score halves — the scoreboard's colon.
  const gapW = Math.max(2, boardW * 0.06);
  rect(px, size, boardX + boardW / 2 - gapW / 2, boardY, gapW, boardH * 0.7, PINE_DEEP);

  // Live progress bar, filled about a third of the way across.
  const barY = boardY + boardH * 0.78;
  const barH = boardH * 0.16;
  rect(px, size, boardX, barY, boardW, barH, CHALK);
  rect(px, size, boardX, barY, boardW * 0.38, barH, LIVE);

  return encodePng(size, size, px);
}

/* -------------------------------------------------------------------- output */

const targets = [
  { file: "icon-192.png", size: 192, padding: 0.14 },
  { file: "icon-512.png", size: 512, padding: 0.14 },
  { file: "icon-maskable-512.png", size: 512, padding: 0.26 },
  { file: "apple-touch-icon.png", size: 180, padding: 0.14 },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, padding } of targets) {
  writeFileSync(resolve(OUT_DIR, file), drawIcon(size, padding));
  console.log(`wrote ${file} (${size}x${size})`);
}
