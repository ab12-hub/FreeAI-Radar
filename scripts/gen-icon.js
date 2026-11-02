'use strict';
// gen-icon.js —— 纯 Node 生成雷达风格应用图标（PNG + ICO，零依赖）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(pixels, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 绘制 ----------
const px = Buffer.alloc(SIZE * SIZE * 4);
function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // alpha 混合
  const na = a / 255, oa = px[i + 3] / 255;
  const outA = na + oa * (1 - na);
  if (outA <= 0) return;
  px[i] = Math.round((r * na + px[i] * oa * (1 - na)) / outA);
  px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / outA);
  px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

const CX = 128, CY = 128;
const dist = (x, y) => Math.hypot(x - CX, y - CY);
const ang = (x, y) => Math.atan2(y - CY, x - CX); // -PI..PI

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = dist(x, y);
    // 背景圆角方块
    const R = 46;
    const bx = Math.max(R - x, x - (SIZE - 1 - R), 0);
    const by = Math.max(R - y, y - (SIZE - 1 - R), 0);
    const corner = Math.hypot(bx, by);
    const inBg = corner <= R;
    if (inBg) {
      const edge = Math.max(0, Math.min(1, R - corner));
      set(x, y, 11, 18, 32, 255 * Math.min(1, edge * 1.5)); // #0b1220
    } else continue;

    // 同心圆环（由内向外渐淡）
    for (const [r, a] of [[36, 235], [72, 165], [106, 95]]) {
      const w = Math.abs(d - r);
      if (w < 1.6) set(x, y, 52, 211, 153, Math.round(a * (1.6 - w) / 1.6));
    }
    // 十字准线（淡）
    if ((Math.abs(x - CX) < 1 && d < 112) || (Math.abs(y - CY) < 1 && d < 112)) {
      set(x, y, 52, 211, 153, 55);
    }
    // 扫描扇形（右侧起始，渐隐尾迹）
    const a0 = -0.55; // 扇形前缘角度
    let da = a0 - ang(x, y);
    while (da < 0) da += Math.PI * 2;
    while (da > Math.PI * 2) da -= Math.PI * 2;
    if (da < 1.5 && d < 112 && d > 6) {
      const fade = Math.max(0, 1 - da / 1.5);
      set(x, y, 52, 211, 153, Math.round(120 * fade * fade));
    }
    // 目标光点
    for (const [bxp, byp, rad, rr, gg, bb] of [[168, 84, 7, 250, 250, 250], [88, 176, 6, 52, 211, 153], [176, 168, 5, 56, 189, 248], [72, 76, 4, 52, 211, 153]]) {
      const dd = Math.hypot(x - bxp, y - byp);
      if (dd < rad) set(x, y, rr, gg, bb, 255);
      else if (dd < rad + 3.5) set(x, y, rr, gg, bb, Math.round(150 * (rad + 3.5 - dd) / 3.5));
    }
    // 中心点
    if (d < 6) set(x, y, 52, 211, 153, 255);
    else if (d < 9) set(x, y, 52, 211, 153, Math.round(200 * (9 - d) / 3));
  }
}

const png = encodePNG(px, SIZE);
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'src', 'main', 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);

// ---------- ICO（内嵌 256x256 PNG） ----------
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;            // 256
entry[2] = 0; entry[3] = 0;            // 256
entry[4] = 0; entry[5] = 0;            // 调色板
entry[6] = 0; entry[7] = 0;            // reserved
entry.writeUInt16LE(1, 8);             // planes
entry.writeUInt16LE(32, 10);           // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);           // data offset
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const ico = Buffer.concat([header, entry, png]);
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
fs.writeFileSync(path.join(root, 'src', 'main', 'assets', 'icon.png'), png);
console.log('icon generated: build/icon.png, build/icon.ico, src/main/assets/icon.png');
