// 第2段階の自動対戦テスト（design-4 §2.9、§6.5）。
// 24種すべて ON（特権あり・なし）と、前提を満たすランダムな組み合わせを、CPU の決まり・でたらめ・時間切れで最後まで回す。
// 毎手の検査は helpers.ts の checkInvariants（54枚、待たれている席に選べる操作がある など）。
// 新しい出来事（colorLock・purge・salvage・trade・callDiscard・instantWin、rule 付きの revolution・tempReverse）が1回以上出ることも確かめる。
import { describe, expect, it } from 'vitest';
import { ALL_RULE_IDS, RULE_MODULES, type GameEvent, type MatchConfig, type RuleId } from './index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { cfg, runMatch, type Policy } from './test/helpers.ts';

/** 出来事の種類（新しい分岐は印を付けて区別する）。 */
function marksOf(e: GameEvent): string[] {
  const out: string[] = [e.type];
  if (e.type === 'revolution' && e.rule !== undefined) out.push(`revolution:${e.rule}`);
  if (e.type === 'tempReverse' && e.rule !== undefined) out.push(`tempReverse:${e.rule}`);
  if (e.type === 'choiceStart') out.push(`choice:${e.rule}`);
  if (e.type === 'choiceSkip') out.push(`choiceSkip:${e.rule}`);
  if (e.type === 'fieldCleared') out.push(`flush:${e.reason}`);
  if (e.type === 'placed') out.push(`placed:${e.reason}`);
  if (e.type === 'purge' && e.discards.length === 0) out.push('purge:none');
  return out;
}

const NEW_MARKS = [
  'colorLock',
  'purge',
  'salvage',
  'trade',
  'callDiscard',
  'instantWin',
  'revolution:triple6_revolution',
  'tempReverse:cancel_reverse_on_6',
  'choice:triple9_salvage',
  'choice:triple_a_trade',
  'choice:call_discard_on_q',
  'choiceSkip:triple9_salvage',
  'choiceSkip:triple_a_trade',
  'choiceSkip:call_discard_on_q',
  'flush:quad2_instant_win',
];

function findRequirement(id: RuleId): readonly RuleId[] {
  return RULE_MODULES.find((m) => m.id === id)?.requires ?? [];
}

describe('自動対戦（24種すべて ON）', () => {
  const seen = new Set<string>();
  for (const abilities of [false, true]) {
    for (const policy of ['cpu', 'random', 'timeout'] as Policy[]) {
      it(`${abilities ? '特権あり' : '特権なし'} / ${policy}: 種を変えた試合が最後まで進み、不変条件が保たれる`, () => {
        const config: MatchConfig = { matchId: 'm-s4', rules: [...ALL_RULE_IDS], gameCount: 5, abilities };
        for (let i = 0; i < 25; i++) {
          const seed: [number, number, number, number] = [i * 7919 + 5, 24, abilities ? 1 : 0, ['cpu', 'random', 'timeout'].indexOf(policy) + 11];
          try {
            const { state, stats } = runMatch(config, seed, policy, { keepEvents: true });
            expect(state.phase).toBe('matchResult');
            for (const e of stats.events ?? []) for (const m of marksOf(e)) seen.add(m);
          } catch (e) {
            throw new Error(`abilities=${abilities} policy=${policy} seed=${seed.join(',')}: ${(e as Error).message}`);
          }
        }
      }, 120_000);
    }
  }

  // 大革命（本物の2の4枚を1人が持ち、まとめて出す）は出にくいので、起きると分かっている種を足す（design-4 §6.5）
  it('cpu / 特権なし: 大革命が起きる種を含めて最後まで進む', () => {
    const config: MatchConfig = { matchId: 'm-s4', rules: [...ALL_RULE_IDS], gameCount: 5 };
    for (let i = 0; i < 6; i++) {
      const { state, stats } = runMatch(config, [i * 7919 + 5, 24, 0, 99], 'cpu', { keepEvents: true });
      expect(state.phase).toBe('matchResult');
      for (const e of stats.events ?? []) for (const m of marksOf(e)) seen.add(m);
    }
  }, 120_000);

  it('新しい出来事がそれぞれ1回以上出ている', () => {
    for (const m of NEW_MARKS) expect(seen, m).toContain(m);
  });
});

describe('自動対戦（24種から前提を満たすランダムな組み合わせ）', () => {
  it('200通りの組み合わせを、CPU とでたらめで最後まで回す', () => {
    const rng = rngFromSeed([2026, 11, 18, 4]);
    for (let n = 0; n < 200; n++) {
      // 前提を満たさないルール（8切りなしの4止め、J バックなしの6戻し）は外す
      let rules = ALL_RULE_IDS.filter(() => nextInt(rng, 2) === 1) as RuleId[];
      rules = rules.filter((r) => findRequirement(r).every((req) => rules.includes(req)));
      const policy: Policy = n % 2 === 0 ? 'cpu' : 'random';
      const abilities = n % 3 === 0 && rules.includes('dethrone');
      const seed: [number, number, number, number] = [n + 1, nextInt(rng, 1 << 30), 4, 200];
      try {
        const { state } = runMatch({ ...cfg(rules, null), abilities }, seed, policy, { endUnlimitedAfter: 2 });
        expect(state.phase).toBe('matchResult');
      } catch (e) {
        throw new Error(`n=${n} rules=${rules.join(',')} policy=${policy} seed=${seed.join(',')}: ${(e as Error).message}`);
      }
    }
  }, 120_000);
});
