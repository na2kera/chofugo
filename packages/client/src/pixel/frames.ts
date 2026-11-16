// 枠のドット絵（見本 docs/mock/look-pixel.html の frame() と同じ）。
// 9×9 点の絵の四隅3点ずつを角にし、真ん中を伸ばして使う（border-image）。1点 = 2px。
// 色は見本の色だけ。ここで作った data URI を CSS 変数（--f-*）に入れる。

import { CARD_BACK_TILE } from './patterns.ts';
import { colorRowsDataUri } from './Pixel.tsx';

export const COLORS = {
  k: '#0a0806',
  bg: '#100d08',
  bg2: '#15110a',
  panel: '#1d1810',
  panel2: '#2a2216',
  gold: '#e2b93b',
  goldHi: '#ffe9a0',
  goldLo: '#9a6e1a',
  cream: '#f4ecd2',
  creamLo: '#cfc29a',
  red: '#d8402f',
  ink: '#1c1820',
  muted: '#a8997a',
  crimson: '#7a1f2b',
  crimsonLo: '#561420',
  // 見本の枠で使っている色
  dimLine: '#6b5a36',
  hotPanel: '#3a2c0c',
  redLine: '#c8463a',
  redPanel: '#3a1210',
  redText: '#ff8a76',
  field: '#17130c',
  barOff: '#3a2f1c',
} as const;

const LINE = ['..kkkkk..', '.kgggggk.', 'kggkkkggk', 'kgkpppkgk', 'kgkpppkgk', 'kgkpppkgk', 'kggkkkggk', '.kgggggk.', '..kkkkk..'];
const SOLID = ['..kkkkk..', '.khhhhhk.', 'khgggggdk', 'khgggggdk', 'khgggggdk', 'khgggggdk', 'khgggggdk', '.kdddddk.', '..kkkkk..'];

// 受け取ったカード（交換）の枠：外側に明るい金の輪、その内側に黒の線
const RECV = ['..ggggg..', '.gkkkkkg.', 'gkhhhhhkg', 'gkhcccdkg', 'gkhcccdkg', 'gkhcccdkg', 'gkdddddkg', '.gkkkkkg.', '..ggggg..'];

const C = COLORS;

export function frameVars(): Record<string, string> {
  return {
    '--f-win': colorRowsDataUri(LINE, { k: C.k, g: C.gold, p: C.panel }),
    '--f-dim': colorRowsDataUri(LINE, { k: C.k, g: C.dimLine, p: C.panel }),
    '--f-hot': colorRowsDataUri(LINE, { k: C.k, g: C.goldHi, p: C.hotPanel }),
    '--f-red': colorRowsDataUri(LINE, { k: C.k, g: C.redLine, p: C.redPanel }),
    '--f-field': colorRowsDataUri(LINE, { k: C.k, g: C.gold, p: C.field }),
    '--f-field-red': colorRowsDataUri(LINE, { k: C.k, g: C.redLine, p: C.field }),
    '--f-btn': colorRowsDataUri(SOLID, { k: C.k, h: C.goldHi, g: C.gold, d: C.goldLo }),
    '--f-plate': colorRowsDataUri(SOLID, { k: C.k, h: C.gold, g: C.gold, d: C.goldLo }),
    '--f-card': colorRowsDataUri(SOLID, { k: C.k, h: C.cream, g: C.cream, d: C.creamLo }),
    '--f-cardsel': colorRowsDataUri(SOLID, { k: C.gold, h: C.cream, g: C.cream, d: C.creamLo }),
    '--f-cardrecv': colorRowsDataUri(RECV, { g: C.goldHi, k: C.k, h: C.cream, c: C.cream, d: C.creamLo }),
    // 背景の市松模様（見本の 4px 角の市松）
    '--bg-check': colorRowsDataUri(['ab', 'ba'], { a: C.bg2, b: C.bg }),
    // カードの裏の模様（patterns.ts の CARD_BACK_TILE。1点 = 2px で敷き詰める）
    '--back-tile': colorRowsDataUri(
      CARD_BACK_TILE.map((r) => r.replace(/\./g, 'c')),
      { '#': C.crimsonLo, c: C.crimson },
    ),
  };
}

let installed = false;

/** 枠の CSS 変数を :root に入れる（1回だけ）。 */
export function installFrames(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(frameVars())) root.style.setProperty(k, v);
}
