import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Placeholder icon drawn from code: four tiles on a rounded square.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const inRoundedRect = (x, y, left, top, size, radius) => {
  const right = left + size;
  const bottom = top + size;
  if (x < left || x > right || y < top || y > bottom) return false;
  const dx = Math.max(left + radius - x, x - (right - radius), 0);
  const dy = Math.max(top + radius - y, y - (bottom - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
};

function pixel(x, y) {
  if (!inRoundedRect(x, y, 0, 0, 1, 0.22)) return [0, 0, 0, 0];
  for (const [left, top] of [[0.2, 0.2], [0.54, 0.2], [0.2, 0.54], [0.54, 0.54]]) {
    if (inRoundedRect(x, y, left, top, 0.26, 0.06)) return [255, 255, 255, 255];
  }
  return [38, 92, 168, 255];
}

function png(size) {
  const samples = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const total = [0, 0, 0, 0];
      for (let sx = 0; sx < samples; sx++) {
        for (let sy = 0; sy < samples; sy++) {
          const sample = pixel((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
          for (let c = 0; c < 4; c++) total[c] += sample[c];
        }
      }
      for (let c = 0; c < 4; c++) raw[offset++] = Math.round(total[c] / (samples * samples));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = new URL('../public/icon/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`${size}.png`, dir), png(size));
console.log('Icons written');
