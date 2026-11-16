// 自動対戦テスト（design §3.9、§8.3）。ルール ON/OFF の全256通りを、CPU・時間切れ・でたらめの動きで最後まで回す。
// 毎手で不変条件（helpers.ts の checkInvariants）を確かめる。

import { describe, expect, it } from 'vitest';
import { DAIFUGO_MODE_RULE_IDS, IMPLEMENTED_RULE_IDS, type RuleId } from './index.ts';
import { cfg, runMatch, type Policy } from './test/helpers.ts';

function rulesOf(mask: number): RuleId[] {
  // 列挙の元は定番8種に固定する（実装済みが16種になっても、定番8種の検査のまま。design-2 §6.4）
  return DAIFUGO_MODE_RULE_IDS.filter((_, i) => (mask & (1 << i)) !== 0);
}

describe('自動対戦（全256通り）', () => {
  const covered = new Set<string>();
  const reasons = new Set<string>();
  const policies: Policy[] = ['cpu', 'random', 'timeout'];

  for (const policy of policies) {
    it(`${policy}: 256通りすべてで試合が最後まで進み、不変条件が保たれる`, () => {
      for (let mask = 0; mask < 256; mask++) {
        const seed: [number, number, number, number] = [mask + 1, 0x1234 + policies.indexOf(policy), 77, 2026];
        const gameCount = mask % 3 === 0 ? null : 5;
        try {
          const { state, stats } = runMatch(cfg(rulesOf(mask), gameCount), seed, policy, {
            keepEvents: true,
            endUnlimitedAfter: 3,
          });
          expect(state.phase).toBe('matchResult');
          for (const t of stats.types) covered.add(t);
          for (const e of stats.events ?? []) {
            if (e.type === 'placed') reasons.add(e.reason);
            if (e.type === 'fieldCleared') reasons.add(`flush:${e.reason}`);
          }
        } catch (e) {
          throw new Error(`mask=${mask} policy=${policy} seed=${seed.join(',')}: ${(e as Error).message}`);
        }
      }
    }, 120_000);
  }

  it('分岐を通っている（返し、反則上がり、都落ち、最後の1人、各種の流れ）', () => {
    for (const t of ['respond', 'respondSkip', 'returnRoundStart', 'dethrone', 'revolution', 'tempReverse', 'suitLock', 'exchange']) {
      expect(covered, t).toContain(t);
    }
    for (const r of ['finish', 'foul', 'dethrone', 'last', 'flush:allPassed', 'flush:flush_on_8', 'flush:spade3_beats_joker', 'flush:returnFailed', 'flush:jokerUnbeatable']) {
      expect(reasons, r).toContain(r);
    }
  });
});

describe('自動対戦（種を変えた多数の試合）', () => {
  it('全ルール ON で種を変えて CPU とでたらめを各40試合', () => {
    const all = [...IMPLEMENTED_RULE_IDS] as RuleId[];
    for (let i = 0; i < 40; i++) {
      for (const policy of ['cpu', 'random'] as const) {
        const seed: [number, number, number, number] = [i * 7919 + 1, i, 0xdeadbeef, policy === 'cpu' ? 1 : 2];
        const { state } = runMatch(cfg(all, 10), seed, policy);
        expect(state.phase).toBe('matchResult');
        expect(state.results).toHaveLength(10);
      }
    }
  }, 120_000);
});
