// Generates icons/icon{16,32,48,128}.png with no image dependencies.
// The mark is a ranked list: three bars, the top one "steal" green, plus an
// on-the-clock dot — the same idea the panel itself uses.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x14, 0x16, 0x1c];
// Descending bars = a ranked list. The top one is "steal" green and is trailed
// by the on-the-clock dot, so the two read as one row rather than colliding.
const BARS = [
  { w: 0.70, rgb: [0x17, 0xc9, 0x64] },
  { w: 0.86, rgb: [0x5b, 0x64, 0x79] },
  { w: 0.58, rgb: [0x3b, 0x42, 0x54] },
];

/** Anti-aliased coverage of a rounded rect at a point, via 3x3 supersampling. */
function coverage(px, py, fn) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++)
    for (let sx = 0; sx < 3; sx++)
      if (fn(px + (sx + 0.5) / 3, py + (sy + 0.5) / 3)) hits++;
  return hits / 9;
}

const inRoundRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};
const inCircle = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

function render(S) {
  const buf = new Uint8Array(S * S * 4); // RGBA, starts fully transparent
  const put = (x, y, rgb, a) => {
    if (a <= 0) return;
    const i = (y * S + x) * 4;
    const dst = buf[i + 3] / 255;
    const out = a + dst * (1 - a);
    for (let k = 0; k < 3; k++) {
      const d = buf[i + k] * dst;
      buf[i + k] = Math.round((rgb[k] * a + d * (1 - a)) / (out || 1));
    }
    buf[i + 3] = Math.round(out * 255);
  };

  const tile = inRoundRect(0, 0, S, S, S * 0.22);
  const padX = S * 0.20, barH = S * 0.115, gap = S * 0.105, topY = S * 0.255;
  const wide = S - padX * 2;
  const barFns = BARS.map((b, i) => ({
    rgb: b.rgb,
    fn: inRoundRect(padX, topY + i * (barH + gap), wide * b.w, barH, barH / 2),
  }));
  // Vertically centred on the top bar, clear of its rounded end.
  const dot = S >= 32 ? inCircle(S * 0.80, topY + barH / 2, S * 0.072) : null;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      put(x, y, BG, coverage(x, y, tile));
      for (const b of barFns) put(x, y, b.rgb, coverage(x, y, b.fn));
      if (dot) put(x, y, BARS[0].rgb, coverage(x, y, dot));
    }
  }
  return buf;
}

// --- minimal PNG encoder -----------------------------------------------------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = ~0;
  for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(S, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const S of [16, 32, 48, 128]) {
  const out = new URL(`../icons/icon${S}.png`, import.meta.url);
  const bytes = png(S, render(S));
  writeFileSync(out, bytes);
  console.log(`icon${S}.png  ${bytes.length} bytes`);
}
