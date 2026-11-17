// DEATH（decisions §15.5、§19.3、§19.4、design-4 §2.4、§2.9、§6.6）と、「いちばん強いカード」の決め方。
import { describe, expect, it } from 'vitest';
import { strongestCards } from '../hand.ts';
import { rngFromSeed } from '../rng.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['triple4_purge'] as const;

describe('いちばん強いカード（strongestCards）', () => {
  it('1通りに決まるときは乱数を進めない', () => {
    const rng = rngFromSeed([1, 2, 3, 4]);
    const before = rng.slice();
    expect(strongestCards(rng, cs('S3 HK X0 D2'), 2, false)).toEqual(cs('D2 X0'));
    expect(strongestCards(rng, cs('S3 HK D2'), 1, true)).toEqual(cs('S3'));
    // 境目に同じ強さが並んでも、並んだものを全部取るなら引かない
    expect(strongestCards(rng, cs('S9 H9 C3'), 2, false)).toEqual(cs('S9 H9'));
    expect(strongestCards(rng, cs('S9 H9'), 5, false)).toEqual(cs('S9 H9'));
    expect(rng).toEqual(before);
  });

  it('境目に同じ強さが並び、その中から選ぶときだけ引く（ジョーカー2枚から1枚も引く）', () => {
    const rng = rngFromSeed([1, 2, 3, 4]);
    const before = rng.slice();
    const one = strongestCards(rng, cs('S9 H9 C3'), 1, false);
    expect(one).toHaveLength(1);
    expect(cs('S9 H9')).toContain(one[0]);
    expect(rng).not.toEqual(before);
    const mid = rng.slice();
    const jk = strongestCards(rng, cs('X0 X1 S2'), 1, false);
    expect(['joker-0', 'joker-1']).toContain(jk[0]);
    expect(rng).not.toEqual(mid);
    // 2枚のうち1枚は確定（2）、残り1枚を同じ強さの A から選ぶ
    const two = strongestCards(rngFromSeed([5, 6, 7, 8]), cs('S2 SA HA DA'), 2, false);
    expect(two).toContain('spade-15');
    expect(two).toHaveLength(2);
  });
});

describe('DEATH', () => {
  it('出した人以外の全員が、いちばん強いカードを1枚捨てる（ジョーカーが最強）。全員に見える出来事は進行方向の順', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S4 H4 D4 S9', 'H5 HK X0', 'D7 DA', 'C3 C2'], turn: 0 }));
    const before = d.state.rng.slice();
    const ev = d.play(0, 'S4 H4 D4');
    expect(ev.map((e) => e.type)).toEqual(['play', 'purge']);
    expect(ev[1]).toEqual(
      expect.objectContaining({
        by: 0,
        discards: [
          { seat: 1, card: 'joker-0' },
          { seat: 2, card: 'diamond-14' },
          { seat: 3, card: 'club-15' },
        ],
      }),
    );
    expect(d.state.rng).toEqual(before); // どれも1通りに決まる
    expect(d.game.discard).toEqual(['joker-0', 'diamond-14', 'club-15']);
    expect(d.game.hands[1]).toEqual(cs('H5 HK'));
    // 4の3枚組は場に残り、次の人から続く
    expect(d.game.field).toHaveLength(1);
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('革命中は3が最強。J バック中も、その時点の向きで決める', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['S4 H4 D4 S9', 'H3 HK', 'D7 DA', 'C3 C2'], turn: 0, revolution: true }));
    a.play(0, 'S4 H4 D4');
    expect(a.events.at(-1)).toMatchObject({ discards: [{ seat: 1, card: 'heart-3' }, { seat: 2, card: 'diamond-7' }, { seat: 3, card: 'club-3' }] });
    const b = new Driver(scene({ rules: [...R], hands: ['S4 H4 D4 S9', 'H3 HK', 'D7 DA', 'C3 C2'], turn: 0, tempReverse: true }));
    b.play(0, 'S4 H4 D4');
    expect(b.events.at(-1)).toMatchObject({ discards: [{ seat: 1, card: 'heart-3' }, { seat: 2, card: 'diamond-7' }, { seat: 3, card: 'club-3' }] });
  });

  it('同じ強さのカードが並ぶときは乱数で選ぶ', () => {
    const picked = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const s = scene({ rules: [...R], hands: ['S4 H4 D4 S9', 'H9 S10 C10', 'D7', 'C3'], turn: 0 });
      s.rng = rngFromSeed([k + 1, 3, 5, 7]);
      const d = new Driver(s);
      const before = d.state.rng.slice();
      d.play(0, 'S4 H4 D4');
      expect(d.state.rng).not.toEqual(before);
      const disc = d.events.find((e) => e.type === 'purge');
      if (disc?.type !== 'purge') throw new Error();
      picked.add(disc.discards[0]!.card);
    }
    expect([...picked].sort()).toEqual(['club-10', 'spade-10']);
  });

  it('捨てて0枚になった人は上がる（反則ではない）。順位は進行方向で出した人に近い順', () => {
    const d = new Driver(scene({ rules: [...R, 'forbidden_finish'], hands: ['S4 H4 D4 S9', 'X0', 'D2', 'C3 C5'], turn: 0 }));
    d.play(0, 'S4 H4 D4');
    expect(d.events.filter((e) => e.type === 'placed')).toEqual([
      expect.objectContaining({ seat: 1, place: 1, reason: 'finish' }),
      expect.objectContaining({ seat: 2, place: 2, reason: 'finish' }),
    ]);
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
    // 逆回り中は 3 → 2 → 1 の順
    const r = new Driver(scene({ rules: [...R, 'reverse_order_on_9'], hands: ['S4 H4 D4 S9', 'HK', 'D7', 'C3 C5'], turn: 0, orderReversed: true }));
    r.play(0, 'S4 H4 D4');
    expect(r.events.find((e) => e.type === 'purge')).toMatchObject({ discards: [{ seat: 3 }, { seat: 2 }, { seat: 1 }] });
    expect(r.events.filter((e) => e.type === 'placed').map((e) => (e.type === 'placed' ? [e.seat, e.place] : []))).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });

  it('出した人が最後の3枚で出したときは、出した人が先に上がる。効果は起きる', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S4 H4 D4', 'HK', 'D7 D8', 'C3 C5'], turn: 0 }));
    d.play(0, 'S4 H4 D4');
    expect(d.types()).toEqual(['play', 'purge', 'placed', 'placed']);
    expect(d.events.filter((e) => e.type === 'placed')).toEqual([
      expect.objectContaining({ seat: 0, place: 1, reason: 'finish' }),
      expect.objectContaining({ seat: 1, place: 2, reason: 'finish' }),
    ]);
  });

  it('ジョーカー入りの3枚・4枚の4は役にならない', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['S4 H4 X0 S9', 'HK', 'D7', 'C3'], turn: 0 }));
    expect(a.play(0, 'S4 H4 X0').map((e) => e.type)).toEqual(['play']);
    const b = new Driver(scene({ rules: [...R], hands: ['S4 H4 D4 C4 S9', 'HK', 'D7', 'C3'], turn: 0 }));
    expect(b.play(0, 'S4 H4 D4 C4').map((e) => e.type)).toEqual(['play']);
  });
});
