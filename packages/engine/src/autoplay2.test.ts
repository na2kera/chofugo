// その2の自動対戦テスト（design-2 §2.9）。
// (a) 16種すべて ON、(c) 前提を満たすランダムな組み合わせ（種から決める）を、CPU の決まりと「でたらめ」の両方で最後まで回す。
// 毎手の検査はその1と同じ（helpers.ts の checkInvariants：54枚、待たれている席に選べる操作がある、手数の上限、順位と得点）。
// (b) 定番8種の256通りは autoplay.test.ts（列挙の元を DAIFUGO_MODE_RULE_IDS に固定した）。
import { describe, expect, it } from 'vitest';
import { STAGE1_RULE_IDS, RULE_MODULES, type GameEvent, type RuleId } from './index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { cfg, runMatch, type Policy, type RunStats } from './test/helpers.ts';

type Seen = { types: Set<string>; reasons: Set<string>; kinds: Set<string>; marks: Set<string> };

function collect(seen: Seen, stats: RunStats): void {
  for (const t of stats.types) seen.types.add(t);
  for (const k of stats.awaitKinds) seen.kinds.add(k);
  for (const e of stats.events ?? []) note(seen, e);
}

function note(seen: Seen, e: GameEvent): void {
  if (e.type === 'placed') seen.reasons.add(e.reason);
  if (e.type === 'fieldCleared') seen.reasons.add(`flush:${e.reason}`);
  if (e.type === 'respond' && e.toDiscard === true) seen.marks.add('respond:toDiscard');
  if (e.type === 'gameStart') seen.marks.add(`leaderRule:${e.leaderRule}`);
  if (e.type === 'choiceStart') seen.marks.add(`choice:${e.rule}`);
  if (e.type === 'skipped' && e.seats.length > 1) seen.marks.add('skipped:many');
}

/** そのルールの前提のルール。 */
function findRequirement(id: RuleId): readonly RuleId[] {
  return RULE_MODULES.find((m) => m.id === id)?.requires ?? [];
}

const newSeen = (): Seen => ({ types: new Set(), reasons: new Set(), kinds: new Set(), marks: new Set() });

describe('自動対戦（16種すべて ON）', () => {
  const seen = newSeen();
  for (const policy of ['cpu', 'random', 'timeout'] as Policy[]) {
    it(`${policy}: 種を変えた試合が最後まで進み、不変条件が保たれる`, () => {
      for (let i = 0; i < 25; i++) {
        const seed: [number, number, number, number] = [i * 104729 + 3, 16, 0xc0ffee, ['cpu', 'random', 'timeout'].indexOf(policy) + 1];
        try {
          const { state, stats } = runMatch(cfg([...STAGE1_RULE_IDS], 5), seed, policy, { keepEvents: true });
          expect(state.phase).toBe('matchResult');
          collect(seen, stats);
        } catch (e) {
          throw new Error(`policy=${policy} seed=${seed.join(',')}: ${(e as Error).message}`);
        }
      }
    }, 120_000);
  }

  it('その2の分岐を通っている', () => {
    for (const t of ['choiceStart', 'give', 'discard', 'choiceSkip', 'skipped', 'seqLock', 'orderReverse', 'respond', 'respondSkip']) {
      expect(seen.types, t).toContain(t);
    }
    for (const k of ['turn', 'choice', 'exchangeGive', 'respond:block_flush_with_4', 'respond:spade3_beats_joker']) {
      expect(seen.kinds, k).toContain(k);
    }
    for (const r of ['finish', 'foul', 'dethrone', 'last', 'flush:triple3_trump', 'flush:flush_on_8', 'flush:allPassed']) {
      expect(seen.reasons, r).toContain(r);
    }
    for (const m of ['respond:toDiscard', 'leaderRule:diamond3', 'choice:give_on_7', 'choice:discard_on_10', 'skipped:many']) {
      expect(seen.marks, m).toContain(m);
    }
  });
});

describe('自動対戦（前提を満たすランダムな組み合わせ）', () => {
  it('300通りの組み合わせを、CPU とでたらめで最後まで回す（どの待ちの種類にも選べる操作がある）', () => {
    const rng = rngFromSeed([2026, 11, 17, 2]);
    const seen = newSeen();
    for (let n = 0; n < 300; n++) {
      // 種からルールを決める。前提を満たさないルール（8切りなしの4止め）は外す
      let rules = STAGE1_RULE_IDS.filter(() => nextInt(rng, 2) === 1) as RuleId[];
      rules = rules.filter((r) => findRequirement(r).every((req) => rules.includes(req)));
      const policy: Policy = n % 2 === 0 ? 'cpu' : 'random';
      const seed: [number, number, number, number] = [n + 1, nextInt(rng, 1 << 30), 3, 300];
      try {
        // 無制限の試合を2ゲームで終える（数を回すため短くする）
        const { state, stats } = runMatch(cfg(rules, null), seed, policy, { keepEvents: true, endUnlimitedAfter: 2 });
        expect(state.phase).toBe('matchResult');
        collect(seen, stats);
      } catch (e) {
        throw new Error(`n=${n} rules=${rules.join(',')} policy=${policy} seed=${seed.join(',')}: ${(e as Error).message}`);
      }
    }
    for (const k of ['turn', 'choice', 'exchangeGive', 'respond:block_flush_with_4', 'respond:spade3_beats_joker']) {
      expect(seen.kinds, k).toContain(k);
    }
    for (const m of ['respond:toDiscard', 'leaderRule:diamond3', 'choice:give_on_7', 'choice:discard_on_10']) {
      expect(seen.marks, m).toContain(m);
    }
    expect(seen.reasons).toContain('flush:triple3_trump');
  }, 120_000);
});
