import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
// Small deterministic application icon. No image/font downloads are needed.
const size = 64;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const tile = ((x >= 12 && x < 29) || (x >= 35 && x < 52)) && ((y >= 12 && y < 29) || (y >= 35 && y < 52));
  const corner = (x < 5 || x > 58) && (y < 5 || y > 58);
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  raw.set(tile ? [14, 48, 36, 255] : [128, 219, 181, corner ? 0 : 255], offset);
}
function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4); icoHeader[6] = size; icoHeader[7] = size; icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
mkdirSync('src-tauri/icons', { recursive: true });
writeFileSync('src-tauri/icons/icon.png', png);
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([icoHeader, png]));
