import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const PUBLIC_ICONS_DIR = path.resolve(process.cwd(), 'public', 'icons');
const ASSETS_ICONS_DIR = path.resolve(process.cwd(), 'assets', 'icons');
const BRANDING_DIR = path.resolve(process.cwd(), 'assets', 'branding');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function blendPixel(buf, size, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
  const idx = (y * size + x) * 4;
  const srcA = Math.min(1, Math.max(0, a));
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * srcA + buf[idx] * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4; // 4x4 supersampling for crisp anti-aliased edges
  const stroke = Math.max(0.065, 1.35 / size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;

          // Rounded dark slate tile (#0F172A -> #131D35 subtle top-down light)
          const boxD = sdRoundedBox(u, v, 0.9, 0.9, 0.34);
          if (boxD > 0) continue;

          const grad = (v + 1) * 0.5;
          let r = 15 + grad * 6;
          let g = 23 + grad * 9;
          let b = 42 + grad * 14;

          // Subtle inner rim highlight
          if (boxD > -0.075) {
            r = 51;
            g = 65;
            b = 85;
          }

          // Left chevron "<" in crisp cyan-blue (#38BDF8)
          const dL1 = sdSegment(u, v, -0.24, -0.34, -0.56, 0.0);
          const dL2 = sdSegment(u, v, -0.56, 0.0, -0.24, 0.34);
          // Right chevron ">" in crisp cyan-blue (#38BDF8)
          const dR1 = sdSegment(u, v, 0.24, -0.34, 0.56, 0.0);
          const dR2 = sdSegment(u, v, 0.56, 0.0, 0.24, 0.34);
          // Center slash / context node in clean bright white (#F8FAFC)
          const dMid = sdSegment(u, v, -0.1, 0.38, 0.1, -0.38);

          const chevronD = Math.min(dL1, dL2, dR1, dR2);
          if (chevronD <= stroke) {
            r = 56;
            g = 189;
            b = 248;
          }
          if (dMid <= stroke * 0.9) {
            r = 248;
            g = 250;
            b = 252;
          }

          // Small emerald intelligence pulse dot at top-right inside frame (#34D399)
          const dDot = Math.hypot(u - 0.52, v + 0.52);
          if (dDot <= 0.115) {
            r = 52;
            g = 211;
            b = 153;
          }

          ar += r;
          ag += g;
          ab += b;
          aa += 1;
        }
      }

      const samples = ss * ss;
      if (aa > 0) {
        blendPixel(rgba, size, x, y, ar / aa, ag / aa, ab / aa, aa / samples);
      }
    }
  }

  return encodePng(size, size, rgba);
}

const SVG_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <rect x="6" y="6" width="116" height="116" rx="22" fill="#0F172A" stroke="#334155" stroke-width="4"/>
  <path d="M48 42L28 64L48 86" stroke="#38BDF8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M80 42L100 64L80 86" stroke="#38BDF8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M58 88L70 40" stroke="#F8FAFC" stroke-width="8" stroke-linecap="round"/>
  <circle cx="96" cy="32" r="7" fill="#34D399"/>
</svg>
`;

fs.mkdirSync(PUBLIC_ICONS_DIR, { recursive: true });
fs.mkdirSync(ASSETS_ICONS_DIR, { recursive: true });
fs.mkdirSync(BRANDING_DIR, { recursive: true });

for (const size of SIZES) {
  const png = renderIcon(size);
  fs.writeFileSync(path.join(PUBLIC_ICONS_DIR, `icon-${size}.png`), png);
  fs.writeFileSync(path.join(ASSETS_ICONS_DIR, `icon-${size}.png`), png);
}
fs.writeFileSync(path.join(BRANDING_DIR, 'logo.svg'), SVG_LOGO, 'utf8');
console.log('Generated CodeContext icons:', SIZES.map((s) => `icon-${s}.png`).join(', '));
