'use strict';
/* Deterministic wallpaper for the alvidaa native Home.
 *
 * Generated at build time rather than committed as a binary: the repo stays
 * free of image assets, the output is reproducible, and the build inlines it
 * as a data URI so the candidate is still a single self-contained file.
 *
 * Design: deep obsidian base, a cyan-to-indigo bloom from the top, a second
 * indigo wash bottom-right for direction, a soft vignette, and a little grain
 * so large flat areas do not band on the panel.
 */
const zlib = require('node:zlib');

const WIDTH = 1920;
const HEIGHT = 1080;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function clamp(value) { return value < 0 ? 0 : value > 255 ? 255 : Math.round(value); }

function glow(x, y, cx, cy, radius, color, strength) {
  const dx = (x - cx) / radius;
  const dy = (y - cy) / radius;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= 1) return null;
  const falloff = (1 - d) * (1 - d) * strength;
  return [color[0] * falloff, color[1] * falloff, color[2] * falloff];
}

function render() {
  const stride = WIDTH * 3 + 1;
  const raw = Buffer.alloc(stride * HEIGHT);
  const cyan = [56, 189, 248];
  const indigo = [99, 102, 241];
  const base = [7, 8, 12];

  for (let y = 0; y < HEIGHT; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < WIDTH; x++) {
      let r = base[0], g = base[1], b = base[2];

      const top = glow(x, y, WIDTH * 0.5, -HEIGHT * 0.15, WIDTH * 0.95, cyan, 0.10);
      if (top) { r += top[0]; g += top[1]; b += top[2]; }

      const topIndigo = glow(x, y, WIDTH * 0.35, -HEIGHT * 0.05, WIDTH * 0.75, indigo, 0.06);
      if (topIndigo) { r += topIndigo[0]; g += topIndigo[1]; b += topIndigo[2]; }

      const corner = glow(x, y, WIDTH, HEIGHT, WIDTH * 0.85, indigo, 0.12);
      if (corner) { r += corner[0]; g += corner[1]; b += corner[2]; }

      // Vignette: darken toward the edges.
      const vx = (x - WIDTH / 2) / (WIDTH / 2);
      const vy = (y - HEIGHT / 2) / (HEIGHT / 2);
      const vignette = 1 - 0.35 * Math.min(1, Math.sqrt(vx * vx + vy * vy));
      r *= vignette; g *= vignette; b *= vignette;

      // Deterministic grain, +-2, so gradients do not band.
      const noise = ((x * 73856093) ^ (y * 19349663)) & 3;
      r += noise - 1.5; g += noise - 1.5; b += noise - 1.5;

      const offset = row + 1 + x * 3;
      raw[offset] = clamp(r);
      raw[offset + 1] = clamp(g);
      raw[offset + 2] = clamp(b);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { render, WIDTH, HEIGHT };

if (require.main === module) {
  const png = render();
  console.log('wallpaper: ' + WIDTH + 'x' + HEIGHT + ', ' + png.length + ' bytes');
}
