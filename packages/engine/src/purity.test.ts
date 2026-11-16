// 読み取りの関数と applyAction が、入力の状態を変更しないこと（凍結した状態で回して、書き込みがあれば TypeError で落ちる）。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  awaiting,
  createMatch,
  eventsFor,
  IMPLEMENTED_RULE_IDS,
  legalPlays,
  viewFor,
  type Action,
  type MatchState,
  type RuleId,
  type SeatId,
} from './index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { cfg, randomAction } from './test/helpers.ts';

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

describe('入力の状態を変えない', () => {
  it('凍結した状態に対して viewFor / legalPlays / awaiting / eventsFor / applyAction を呼んでも落ちない', () => {
    const rng = rngFromSeed([1, 9, 8, 4]);
    for (let m = 0; m < 6; m++) {
      const created = createMatch(cfg([...IMPLEMENTED_RULE_IDS] as RuleId[], 5), [m + 1, 4, 4, 4]);
      if (!created.ok) throw new Error();
      let s: MatchState = deepFreeze(created.state);
      while (s.phase !== 'matchResult') {
        for (const seat of [0, 1, 2, 3] as SeatId[]) {
          viewFor(s, seat);
          legalPlays(s, seat);
        }
        awaiting(s);
        let a: Action;
        if (s.phase === 'gameResult') a = { type: 'nextGame' };
        else if (nextInt(rng, 2) === 0) a = randomAction(s, rng);
        else a = { type: 'auto', awaitId: awaiting(s)[0]!.id, policy: nextInt(rng, 2) ? 'cpu' : 'timeout' };
        const r = applyAction(s, a);
        expect(r.ok).toBe(true);
        if (!r.ok) throw new Error(r.error.message);
        const events = deepFreeze(r.events);
        for (const seat of [0, 1, 2, 3] as SeatId[]) eventsFor(events, seat);
        s = deepFreeze(r.state);
      }
    }
  }, 60_000);
});
