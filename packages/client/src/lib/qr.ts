// 招待リンクの QR コード（ロビーの「QR」、client-assumptions S 節）。
// 点の並びは uqr で作る（uqr を import するのはこのファイルだけ）。誤り訂正は M。まわりの余白（4点ぶん）は含めない。
// dev/qr.ts はポスター用に固定した別の URL の並びなので、ここでは使わない。

import { encode } from 'uqr';

/** text の QR コードを、# = 暗い点、. = 明るい点の行にして返す（Pixel の rows の形）。 */
export function qrRows(text: string): string[] {
  const { data } = encode(text, { ecc: 'M', border: 0 });
  return data.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));
}

/** 点の大きさの候補（px）。大きいものから。 */
const UNITS = [8, 6, 4] as const;

/** 左右（上下）の余白4点ずつを含めた一辺が、使える幅と高さの両方に収まるいちばん大きい点の大きさ。どれも収まらなければ 4。 */
export function qrUnit(modules: number, availWidth: number, availHeight: number): number {
  const side = modules + 8;
  for (const u of UNITS) {
    if (side * u <= availWidth && side * u <= availHeight) return u;
  }
  return 4;
}
