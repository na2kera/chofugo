// 手の認識と、legalPlays と applyAction の突き合わせ。
import { describe, expect, it } from 'vitest';
import { applyAction, awaiting, createMatch, IMPLEMENTED_RULE_IDS, legalPlays, type MatchState, type RuleId } from './index.ts';
import { interpretGroup, interpretRuns } from './hand.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { cfg, cs, randomAction } from './test/helpers.ts';

describe('手の認識', () => {
  it('組: 同じ数字（ジョーカー混じり可）、ジョーカーだけの組、5枚組', () => {
    expect(interpretGroup(cs('S7 H7 X0'))).toMatchObject({ rank: 7, jokers: [{ rank: 7 }] });
    expect(interpretGroup(cs('X0 X1'))).toMatchObject({ rank: null });
    expect(interpretGroup(cs('S9 H9 D9 C9 X0'))).toMatchObject({ rank: 9 });
    expect(interpretGroup(cs('S7 H8'))).toBeNull();
  });
  it('階段: 同じマーク・連続・3枚以上・2で止まる', () => {
    expect(interpretRuns(cs('S3 S4 S5'))).toHaveLength(1);
    expect(interpretRuns(cs('S3 S4 H5'))).toEqual([]);
    expect(interpretRuns(cs('S3 S5 S6'))).toEqual([]);
    expect(interpretRuns(cs('S3 S4'))).toEqual([]);
    expect(interpretRuns(cs('SA S2 X0'))).toEqual([expect.objectContaining({ low: 13, high: 15 })]);
    expect(interpretRuns(cs('S4 X0 X1')).map((r) => r.low)).toEqual([3, 4]);
  });
});

/** 手札の部分集合をすべて試し、「一覧にある手は通る、ない手は拒否される」を確かめる。 */
function crossCheck(s: MatchState) {
  const w = awaiting(s)[0]!;
  const hand = s.game!.hands[w.seat]!;
  const legal = new Set(legalPlays(s, w.seat).map((p) => `${p.shape}:${p.cards.join(',')}`));
  const maxSize = hand.length <= 9 ? hand.length : 4;
  const n = hand.length;
  let tried = 0;
  for (let mask = 1; mask < 1 << n; mask++) {
    let bits = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) bits++;
    if (bits > maxSize) continue;
    const cards = hand.filter((_, i) => mask & (1 << i));
    for (const shape of ['group', 'run'] as const) {
      const r = applyAction(s, { type: 'play', seat: w.seat, awaitId: w.id, cards, shape, confirmFoul: true });
      const key = `${shape}:${[...cards].join(',')}`;
      expect(r.ok, key).toBe(legal.has(key));
      tried++;
    }
  }
  return tried;
}

describe('legalPlays と applyAction の突き合わせ', () => {
  it('でたらめに進めた対戦の手番で、手札の部分集合を総当たりする', () => {
    const rng = rngFromSeed([8, 6, 7, 5]);
    let states = 0;
    for (let m = 0; m < 6; m++) {
      const rules = (m % 2 === 0 ? [...IMPLEMENTED_RULE_IDS] : ['runs', 'suit_lock', 'temp_reverse_on_j']) as RuleId[];
      const created = createMatch(cfg(rules, 5), [m + 1, 3, 3, 3]);
      if (!created.ok) throw new Error();
      let s = created.state;
      let steps = 0;
      while (s.phase !== 'matchResult' && steps < 400) {
        steps++;
        if (s.phase === 'gameResult') {
          const r = applyAction(s, { type: 'nextGame' });
          if (!r.ok) throw new Error();
          s = r.state;
          continue;
        }
        const w = awaiting(s)[0]!;
        if (w.kind === 'turn' && nextInt(rng, 8) === 0) {
          crossCheck(s);
          states++;
        }
        const r = applyAction(s, randomAction(s, rng));
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
      }
    }
    expect(states).toBeGreaterThan(20);
  }, 60_000);
});
