import { describe, expect, it } from 'vitest';
import { qrRows, qrUnit } from './qr.ts';

const ID = 'K7M2QX9DaBcDeFgHiJkLmN';
const URL52 = `https://chofugo.na2kera.com/r/${ID}`;
const URL60 = `https://chofugo.na2kera.workers.dev/r/${ID}`;

const FINDER = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];

function block(rows: string[], x: number, y: number): string[] {
  return rows.slice(y, y + 7).map((r) => r.slice(x, x + 7));
}

describe('QR コードの点の並び', () => {
  it('正方形で、# と . だけでできている', () => {
    const rows = qrRows(URL52);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.length).toBe(rows.length);
      expect(r).toMatch(/^[#.]+$/);
    }
  });

  it('招待リンクの長さ（52文字・60文字）で 33 点になる', () => {
    expect(URL52.length).toBe(52);
    expect(URL60.length).toBe(60);
    expect(qrRows(URL52).length).toBe(33);
    expect(qrRows(URL60).length).toBe(33);
  });

  it('左上・右上・左下に位置合わせの模様がある', () => {
    const rows = qrRows(URL52);
    const n = rows.length;
    expect(block(rows, 0, 0)).toEqual(FINDER);
    expect(block(rows, n - 7, 0)).toEqual(FINDER);
    expect(block(rows, 0, n - 7)).toEqual(FINDER);
  });

  it('同じ文字列なら同じ並び、違うルーム ID なら違う並びになる', () => {
    expect(qrRows(URL52)).toEqual(qrRows(URL52));
    const other = `https://chofugo.na2kera.com/r/ZZM2QX9DaBcDeFgHiJkLmN`;
    expect(other.length).toBe(52);
    expect(qrRows(other)).not.toEqual(qrRows(URL52));
  });
});

describe('QR コードの点の大きさ', () => {
  it('幅360の画面の中身の幅（308px）で 6、幅390（338px）で 8', () => {
    expect(qrUnit(33, 308, 10_000)).toBe(6);
    expect(qrUnit(33, 338, 10_000)).toBe(8);
  });

  it('狭い・低いときは 4', () => {
    expect(qrUnit(33, 200, 10_000)).toBe(4);
    expect(qrUnit(33, 10_000, 200)).toBe(4);
    expect(qrUnit(33, 100, 100)).toBe(4);
  });

  it('幅の境目：一辺（点の数＋8）× 点の大きさ がちょうど入る幅から、その大きさになる', () => {
    expect(qrUnit(33, 328, 10_000)).toBe(8);
    expect(qrUnit(33, 327, 10_000)).toBe(6);
    expect(qrUnit(33, 246, 10_000)).toBe(6);
    expect(qrUnit(33, 245, 10_000)).toBe(4);
  });

  it('領域が 0 のときも 4 を返す（測る前）。点の数が違えば、一辺もそれに合わせて決まる', () => {
    expect(qrUnit(33, 0, 0)).toBe(4);
    expect(qrUnit(29, 296, 10_000)).toBe(8); // (29+8)×8 = 296
    expect(qrUnit(29, 295, 10_000)).toBe(6);
    expect(qrUnit(37, 338, 10_000)).toBe(6); // (37+8)×8 = 360 は入らない
  });

  it('高さが足りないときは小さくなる', () => {
    expect(qrUnit(33, 338, 328)).toBe(8);
    expect(qrUnit(33, 338, 327)).toBe(6);
    expect(qrUnit(33, 338, 246)).toBe(6);
    expect(qrUnit(33, 338, 245)).toBe(4);
  });
});
