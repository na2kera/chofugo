import { describe, expect, it } from 'vitest';
import { legalPlays } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

describe('階段（decisions §6.8）', () => {
  it('同じマークで連続する3枚以上を出せる。OFF なら出せない', () => {
    const on = new Driver(scene({ rules: ['runs'], hands: ['S3 S4 S5 H9', 'H6 H7 H8 D3', 'C3', 'D4'], turn: 0 }));
    on.play(0, 'S3 S4 S5');
    expect(on.game.field[0]?.play).toMatchObject({ shape: 'run', suit: 'spade', low: 3, high: 5 });
    const off = new Driver(scene({ rules: [], hands: ['S3 S4 S5 H9', 'H6 H7 H8 D3', 'C3', 'D4'], turn: 0 }));
    const r = off.try({ type: 'play', seat: 0, awaitId: off.current().id, cards: cs('S3 S4 S5') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalidCombination');
  });

  it('場が階段なら、同じ枚数で、いちばん弱いカードが場のいちばん強いカードより強い階段だけ（マークは違ってよい）', () => {
    const d = new Driver(scene({ rules: ['runs'], hands: ['S3 S4 S5 H9', 'H5 H6 H7 D6 D7 D8 C8', 'C3', 'D4'], turn: 0 }));
    d.play(0, 'S3 S4 S5');
    const plays = legalPlays(d.state, 1).map((p) => p.cards);
    expect(plays).toContainEqual(cs('D6 D7 D8'));
    expect(plays).not.toContainEqual(cs('H5 H6 H7'));
    expect(plays.every((p) => p.length === 3)).toBe(true);
  });

  it('強さが逆なら判定も逆', () => {
    const d = new Driver(scene({ rules: ['runs'], revolution: true, hands: ['S9 S10 SJ H9', 'H6 H7 H8 D7 D8 D9', 'C3', 'D4'], turn: 0 }));
    d.play(0, 'S9 S10 SJ');
    const plays = legalPlays(d.state, 1).map((p) => p.cards);
    expect(plays).toEqual([cs('H6 H7 H8')]);
  });

  it('K→A→2 は作れるが、2 をまたぐ並びは作れない', () => {
    const d = new Driver(scene({ rules: ['runs'], hands: ['SK SA S2 S3 H9', 'H6', 'C3', 'D4'], turn: 0 }));
    const plays = legalPlays(d.state, 0).filter((p) => p.shape === 'run').map((p) => p.cards);
    expect(plays).toContainEqual(cs('SK SA S2'));
    expect(plays).not.toContainEqual(cs('SA S2 S3'));
  });

  it('ジョーカーは足りない数字の代わりになる。端に置くときは、その時点でいちばん強い位置', () => {
    const a = new Driver(scene({ rules: ['runs'], hands: ['S5 S6 X0 H9', 'H6', 'C3', 'D4'], turn: 0 }));
    a.play(0, 'S5 S6 X0');
    expect(a.game.field[0]?.play).toMatchObject({ low: 5, high: 7, jokers: [{ card: 'joker-0', rank: 7, suit: 'spade' }] });
    const b = new Driver(scene({ rules: ['runs'], revolution: true, hands: ['S5 S6 X0 H9', 'H6', 'C3', 'D4'], turn: 0 }));
    b.play(0, 'S5 S6 X0');
    expect(b.game.field[0]?.play).toMatchObject({ low: 4, high: 6, jokers: [{ rank: 4 }] });
    const c = new Driver(scene({ rules: ['runs'], hands: ['S5 X0 S7 H9', 'H6', 'C3', 'D4'], turn: 0 }));
    c.play(0, 'S5 X0 S7');
    expect(c.game.field[0]?.play).toMatchObject({ low: 5, high: 7, jokers: [{ rank: 6 }] });
  });

  it('いちばん強い位置が場に負けるときは、勝てる位置を選ぶ（すべての制限を満たす解釈のうち最強、§14.6）', () => {
    const d = new Driver(scene({ rules: ['runs'], revolution: true, hands: ['H8 H9 H10 H3', 'S7 X0 S6 D3', 'C3', 'D4'], turn: 0 }));
    d.play(0, 'H8 H9 H10');
    // 逆: 出す階段の high < 8。6-7-J? → 5-6-7 か 6-7-8。8 は不可なので 5-6-7
    d.play(1, 'S6 S7 X0');
    expect(d.game.field[1]?.play).toMatchObject({ low: 5, high: 7 });
  });

  it('組と階段のどちらにも読めるカードは shape の指定が必要', () => {
    const d = new Driver(scene({ rules: ['runs'], hands: ['S5 X0 X1 H9', 'H6', 'C3', 'D4'], turn: 0 }));
    const w = d.current();
    const r = d.try({ type: 'play', seat: 0, awaitId: w.id, cards: cs('S5 X0 X1') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ambiguousShape');
    d.play(0, 'S5 X0 X1', { shape: 'run' });
    expect(d.game.field[0]?.play).toMatchObject({ shape: 'run', low: 5, high: 7 });
  });
});
