// 状態の中に持つ乱数（design §3.1、§8.1）。
// 方式: xoshiro128**（Blackman & Vigna）。状態は 32 ビット符号なし整数 4 個。
// 状態は配列なので JSON にそのまま書き出せる。関数は状態を破壊的に進める（呼び出し側は下書きの状態だけを渡す）。

export type RngState = [number, number, number, number];

/** 試合を作るときにサーバーが渡す 128 ビットの種（32 ビット符号なし整数 4 個。全部 0 は不可）。 */
export type Seed = readonly [number, number, number, number];

export function isValidSeed(seed: unknown): seed is Seed {
  if (!Array.isArray(seed) || seed.length !== 4) return false;
  for (const v of seed) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) return false;
  }
  return seed.some((v) => v !== 0);
}

/** 種から乱数の状態を作る。xoshiro128** の最初の出力は状態の一部だけで決まるため、16 回空回しして混ぜる。 */
export function rngFromSeed(seed: Seed): RngState {
  const s: RngState = [seed[0] >>> 0, seed[1] >>> 0, seed[2] >>> 0, seed[3] >>> 0];
  for (let i = 0; i < 16; i++) nextU32(s);
  return s;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** 32 ビット符号なし整数を1つ返し、状態を進める。 */
export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** 0 以上 n 未満の整数を偏りなく返す（棄却法）。n は 1 以上 2^32 以下。 */
export function nextInt(s: RngState, n: number): number {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const v = nextU32(s);
    if (v < limit) return v % n;
  }
}

/** 配列をその場でシャッフルする（Fisher–Yates）。 */
export function shuffleInPlace<T>(s: RngState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(s, i + 1);
    const a = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = a;
  }
}

/** 配列から k 個を順不同で選ぶ（元の配列は変えない）。 */
export function sample<T>(s: RngState, arr: readonly T[], k: number): T[] {
  const copy = arr.slice();
  shuffleInPlace(s, copy);
  return copy.slice(0, k);
}
