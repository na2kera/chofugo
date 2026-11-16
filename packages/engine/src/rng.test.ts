import { describe, expect, it } from 'vitest';
import { isValidSeed, nextInt, nextU32, rngFromSeed, type RngState } from './rng.ts';

describe('乱数（xoshiro128**）', () => {
  it('参照実装と同じ列を出す（状態 [1,2,3,4] から）', () => {
    const s: RngState = [1, 2, 3, 4];
    expect([nextU32(s), nextU32(s), nextU32(s), nextU32(s), nextU32(s), nextU32(s)]).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492,
    ]);
  });
  it('種の検証: 32 ビット符号なし整数4個、全部 0 は不可', () => {
    expect(isValidSeed([1, 2, 3, 4])).toBe(true);
    expect(isValidSeed([0, 0, 0, 0])).toBe(false);
    expect(isValidSeed([1, 2, 3])).toBe(false);
    expect(isValidSeed([1, 2, 3, 2 ** 32])).toBe(false);
    expect(isValidSeed([1, 2, 3, 1.5])).toBe(false);
  });
  it('nextInt は範囲内で、JSON 往復しても同じ列', () => {
    const a = rngFromSeed([7, 7, 7, 7]);
    const b = JSON.parse(JSON.stringify(a)) as RngState;
    for (let i = 0; i < 1000; i++) {
      const x = nextInt(a, 13);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(13);
      expect(nextInt(b, 13)).toBe(x);
    }
  });
});
