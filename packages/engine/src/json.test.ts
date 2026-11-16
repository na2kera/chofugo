// 状態を JSON で往復させても、続きの動きが同じこと（design §3.1、§8.1）。
import { describe, expect, it } from 'vitest';
import { applyAction, awaiting, createMatch, IMPLEMENTED_RULE_IDS, type Action, type RuleId } from './index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { assertJsonSafe, cfg, randomAction } from './test/helpers.ts';

describe('JSON 往復', () => {
  it('毎手で JSON 往復した状態に同じ操作を適用すると、結果（状態・出来事）が完全に同じ', () => {
    const rng = rngFromSeed([2, 0, 2, 6]);
    for (let m = 0; m < 10; m++) {
      const created = createMatch(cfg([...IMPLEMENTED_RULE_IDS] as RuleId[], 5), [m + 1, 2, 3, 4]);
      if (!created.ok) throw new Error();
      assertJsonSafe(created.events, 'events');
      let s = created.state;
      while (s.phase !== 'matchResult') {
        const round = JSON.parse(JSON.stringify(s)) as typeof s;
        expect(round).toStrictEqual(s);
        let a: Action;
        if (s.phase === 'gameResult') a = { type: 'nextGame' };
        else if (nextInt(rng, 2) === 0) a = randomAction(s, rng);
        else a = { type: 'auto', awaitId: awaiting(s)[nextInt(rng, awaiting(s).length)]!.id, policy: nextInt(rng, 2) ? 'cpu' : 'timeout' };
        const r1 = applyAction(s, a);
        const r2 = applyAction(round, a);
        expect(r2).toStrictEqual(r1);
        if (!r1.ok) throw new Error(r1.error.message);
        assertJsonSafe(r1.events, 'events');
        s = r1.state;
      }
    }
  }, 60_000);
});
