#!/usr/bin/env node
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const PNG_SIG = Buffer.from([137,80,78,71,13,10,26,10]);

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) { c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crcIn = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcIn));
  return Buffer.concat([len, t, data, crc]);
}

const W = 128, H = 128;

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const rawRows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 3);
  row[0] = 0; // filter: None
  for (let x = 0; x < W; x++) {
    const cx = 64, cy = 64;
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    let r = 30, g = 30, b = 46; // dark bg #1E1E2E

    // 4-point sparkle / star
    const points = 4;
    const outerR = 46, innerR = 18;
    const pa = Math.PI * 2 / points;
    const na = ((angle % pa) + pa) % pa;
    const blend = Math.abs(na - pa / 2) / (pa / 2);
    const starR = innerR + (outerR - innerR) * blend;

    if (dist < starR - 1.5) {
      r = 255; g = 200; b = 0; // gold #FFC800
    } else if (dist < starR + 1) {
      // soft edge
      const t2 = (dist - (starR - 1.5)) / 2.5;
      r = Math.round(255 * (1 - t2) + 30 * t2);
      g = Math.round(200 * (1 - t2) + 30 * t2);
      b = Math.round(0 * (1 - t2) + 46 * t2);
    }

    // white center dot
    if (dist < 6) {
      const t2 = dist / 6;
      r = Math.round(255 * (1 - t2) + r * t2);
      g = Math.round(255 * (1 - t2) + g * t2);
      b = Math.round(255 * (1 - t2) + b * t2);
    }

    row[1 + x * 3]     = Math.min(255, Math.max(0, Math.round(r)));
    row[1 + x * 3 + 1] = Math.min(255, Math.max(0, Math.round(g)));
    row[1 + x * 3 + 2] = Math.min(255, Math.max(0, Math.round(b)));
  }
  rawRows.push(row);
}

const raw = Buffer.concat(rawRows);
const compressed = zlib.deflateSync(raw);

const png = Buffer.concat([
  PNG_SIG,
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync('icons/extension-icon.png', png);
console.log('Icon created:', png.length, 'bytes');
