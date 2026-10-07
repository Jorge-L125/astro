const zlib = require('zlib');

// Genera un PNG pequeño (una gota coral) para el icono de la bandeja, sin archivos externos.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function makeIconPng(size = 32) {
  const rows = [];
  const cx = size / 2, cy = size * 0.6, r = size * 0.36;
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      // círculo + punta superior = gota
      const inCircle = dx * dx + dy * dy <= r * r;
      const tipT = (cy - (y + 0.5)) / (cy - size * 0.06);
      const inTip = tipT > 0 && tipT < 1 && Math.abs(dx) <= r * (1 - tipT) * 0.95;
      const eye = (Math.abs(Math.abs(dx) - size * 0.13) < size * 0.05) && Math.abs(dy + size * 0.02) < size * 0.1;
      if (inCircle || inTip) row.push(...(eye ? [20, 20, 22, 255] : [255, 107, 74, 255]));
      else row.push(0, 0, 0, 0);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { makeIconPng };
