// カードの並べ方（design-client §7.4）。大きさは変えず、ずれの幅だけを並べる幅に合わせて変える。

export const CARD_W = 56;
export const CARD_H = 80;
export const CARD_W_L = 68;
export const CARD_H_L = 96;
/** 重ねないときの間（2px の倍数）。 */
export const GAP = 4;
/** 重ねるときのずれの最小（数字が必ず見える幅）。 */
export const MIN_STEP = 30;
/** 2段のとき、下の段を上の段からずらす量（上の段の数字とマークが見える）。 */
export const ROW_STEP = 52;

const even = (n: number) => Math.floor(n / 2) * 2;

export type RowLayout = {
  /** 各段のカードの番号（元の並びの位置）。 */
  rows: number[][];
  /** カード同士のずれ（px）。 */
  step: number;
  /** 段ごとの左端（px）。 */
  starts: number[];
  /** 全体の高さ（選んだカードが上にずれる分は含まない）。 */
  height: number;
};

function rowsFor(n: number, twoRowsFrom: number): number[][] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n < twoRowsFrom) return [idx];
  const top = Math.ceil(n / 2);
  return [idx.slice(0, top), idx.slice(top)];
}

function stepFor(longest: number, width: number, cardW: number): number {
  if (longest <= 1) return cardW + GAP;
  const fit = even((width - cardW) / (longest - 1));
  return Math.max(MIN_STEP, Math.min(cardW + GAP, fit));
}

function startsFor(rows: number[][], step: number, width: number, cardW: number): number[] {
  return rows.map((r) => {
    const w = cardW + Math.max(0, r.length - 1) * step;
    return Math.max(0, even((width - w) / 2));
  });
}

/** 手札：8枚以下なら1段、9枚以上なら2段（前半を上段、後半を下段）。 */
export function handLayout(n: number, width: number): RowLayout {
  const rows = rowsFor(n, 9);
  const longest = Math.max(...rows.map((r) => r.length), 0);
  const step = stepFor(longest, width, CARD_W);
  return { rows, step, starts: startsFor(rows, step, width, CARD_W), height: CARD_H + (rows.length - 1) * ROW_STEP };
}

/** 場の手：4枚以下は大きいカードを並べる。5枚以上は幅56px を重ね、8枚以上なら2段。 */
export function fieldLayout(n: number, width: number): RowLayout & { large: boolean } {
  if (n <= 4) {
    const rows = [Array.from({ length: n }, (_, i) => i)];
    const step = CARD_W_L + 8;
    return { rows, step, starts: startsFor(rows, step, width, CARD_W_L), height: CARD_H_L, large: true };
  }
  const rows = rowsFor(n, 8);
  const longest = Math.max(...rows.map((r) => r.length));
  const step = stepFor(longest, width, CARD_W);
  return { rows, step, starts: startsFor(rows, step, width, CARD_W), height: CARD_H + (rows.length - 1) * ROW_STEP, large: false };
}
