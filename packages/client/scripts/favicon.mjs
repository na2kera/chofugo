// タブのアイコン（favicon）と、ホーム画面用のアイコン（apple-touch-icon と、マニフェストが参照する icon-*.png）を書き出す。
//   node --experimental-strip-types packages/client/scripts/favicon.mjs
// 絵はロゴの王冠（src/pixel/patterns.ts の CROWN_GLYPH）をそのまま使い、点を整数倍に拡大するだけ（にじまない）。
// 依存は足さない。PNG と ICO は Node の zlib だけで書く。
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { CROWN_GLYPH } from '../src/pixel/patterns.ts';

// 色は src/styles/global.css の --bg と --gold。
const BG = [0x10, 0x0d, 0x08];
const GOLD = [0xe2, 0xb9, 0x3b];
const PUBLIC = new URL('../public/', import.meta.url);

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** size×size の PNG。王冠の1点を unit px にして、中央に置く（半端が出るときは左上に寄せる）。 */
function png(size, unit) {
  const w = CROWN_GLYPH[0].length * unit;
  const h = CROWN_GLYPH.length * unit;
  if (w > size || h > size) throw new Error(`${size}px に unit ${unit} は入らない`);
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // フィルターなし
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - ox) / unit);
      const gy = Math.floor((y - oy) / unit);
      const on = x >= ox && y >= oy && CROWN_GLYPH[gy]?.[gx] === '#';
      raw.set(on ? GOLD : BG, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8bit、RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG をそのまま入れた ICO。 */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2); // アイコン
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.set([size, size, 0, 0], e);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(24, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.data)]);
}

const out = (name, data) => {
  writeFileSync(new URL(name, PUBLIC), data);
  console.log(`${name} (${data.length} bytes)`);
};
// 王冠は 13×9 点。16px は1倍、32px は2倍、48px は3倍、180px は10倍（まわりに余白）。
// マニフェスト用：192px は12倍、512px は32倍。丸抜き用（maskable）の 512px は24倍（312×216px）にして、
// 王冠の四隅（中心から約 189.7px）が安全な円（半径 204.8px、幅の40%）に収まるようにする。
out('favicon.ico', ico([{ size: 16, data: png(16, 1) }, { size: 32, data: png(32, 2) }, { size: 48, data: png(48, 3) }]));
out('favicon-32.png', png(32, 2));
out('apple-touch-icon.png', png(180, 10));
out('icon-192.png', png(192, 12));
out('icon-512.png', png(512, 32));
out('icon-512-maskable.png', png(512, 24));
