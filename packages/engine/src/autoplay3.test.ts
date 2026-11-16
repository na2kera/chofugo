// その3の自動対戦テスト（design-3 §2.8）。
// abilities: true・16種すべて ON の試合を、CPU の決まり・でたらめ・時間切れで最後まで回す。
// 毎手の検査は helpers.ts の checkInvariants（54枚、待たれている席に選べる操作がある など）に加えて、
// 1種類の特権が2回使われないこと、特権の選択の待ちで選べる操作があること、特権の状態が正しい形であること。
import { describe, expect, it } from 'vitest';
import {
  ALL_ABILITY_IDS,
  ALL_RULE_IDS,
  applyAction,
  awaiting,
  createMatch,
  eventsFor,
  legalPlays,
  viewFor,
  type Action,
  type GameEvent,
  type MatchConfig,
  type MatchState,
} from './index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { checkInvariants, randomAction, type Policy } from './test/helpers.ts';

const CHOFUGO: MatchConfig = { matchId: 'm-s3', rules: [...ALL_RULE_IDS], gameCount: 10, abilities: true };

type Seen = { abilities: Set<string>; kinds: Set<string>; marks: Set<string> };

function checkAbilities(s: MatchState): void {
  const g = s.game;
  if (g === null || g.abilities === null) return;
  const a = g.abilities;
  if (new Set(a.used).size !== a.used.length) throw new Error(`ability used twice: ${a.used.join(',')}`);
  if (a.chosen !== null) {
    if (a.chosen.length > a.slots) throw new Error('chosen exceeds slots');
    if (!a.used.every((id) => a.chosen!.includes(id))) throw new Error('used an ability not chosen');
  }
  if (a.slots < 1 || a.slots > 3) throw new Error(`slots ${a.slots}`);
  if (s.phase === 'ability') {
    const ws = awaiting(s);
    if (ws.length !== 1 || ws[0]!.kind !== 'abilitySelect' || ws[0]!.seat !== a.holder) throw new Error('ability phase await');
    const m = viewFor(s, a.holder).mine;
    if (m === null || m.kind !== 'abilitySelect') throw new Error('abilitySelect without options');
  }
  if (g.peek !== null) {
    const hand = g.hands[g.peek.target] ?? [];
    if (!g.peek.cards.every((id) => hand.includes(id))) throw new Error('peek keeps a card that left the hand');
  }
}

function run(seed: [number, number, number, number], policy: Policy, seen: Seen): MatchState {
  const created = createMatch(CHOFUGO, seed);
  if (!created.ok) throw new Error(created.error.message);
  let s = created.state;
  const rng = rngFromSeed([seed[3] ^ 0x1234567, seed[2], seed[1] ^ 0x55aa, seed[0] + 1].map((x) => x >>> 0) as [number, number, number, number]);
  let steps = 0;
  const note = (events: readonly GameEvent[]) => {
    for (const e of events) {
      if (e.type === 'ability') seen.abilities.add(e.ability);
      if (e.type === 'abilitySelectStart') seen.marks.add(`slots:${e.slots}`);
      if (e.type === 'fieldCleared') seen.marks.add(`flush:${e.reason}`);
    }
  };
  note(created.events);
  for (;;) {
    checkInvariants(s);
    checkAbilities(s);
    if (s.phase === 'matchResult') break;
    for (const w of awaiting(s)) {
      seen.kinds.add(w.kind);
      if (w.continues !== undefined) seen.marks.add('continues');
    }
    let a: Action;
    if (s.phase === 'gameResult') a = { type: 'nextGame' };
    else if (policy === 'random') a = randomAction(s, rng);
    else {
      const ws = awaiting(s);
      a = { type: 'auto', awaitId: ws[nextInt(rng, ws.length)]!.id, policy };
    }
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`#${steps} ${JSON.stringify(a)} -> ${r.error.code} ${r.error.message}`);
    s = r.state;
    note(r.events);
    if (++steps > 8000) throw new Error('match did not finish');
  }
  return s;
}

describe('自動対戦（超富豪モード：特権あり・16種すべて ON）', () => {
  const seen: Seen = { abilities: new Set(), kinds: new Set(), marks: new Set() };
  for (const policy of ['cpu', 'random', 'timeout'] as Policy[]) {
    it(`${policy}: 種を変えた試合が最後まで進み、不変条件が保たれる`, () => {
      for (let i = 0; i < 15; i++) {
        const seed: [number, number, number, number] = [i * 7919 + 5, 33, 0xbeef, ['cpu', 'random', 'timeout'].indexOf(policy) + 7];
        try {
          const s = run(seed, policy, seen);
          expect(s.phase).toBe('matchResult');
        } catch (e) {
          throw new Error(`policy=${policy} seed=${seed.join(',')}: ${(e as Error).message}`);
        }
      }
    }, 120_000);
  }

  it('特権の分岐を通っている', () => {
    // でたらめの側は6種すべてを使う。CPU は透視以外を使う
    for (const id of ALL_ABILITY_IDS) expect(seen.abilities, id).toContain(id);
    for (const k of ['abilitySelect', 'turn', 'exchangeGive', 'respond', 'choice']) expect(seen.kinds, k).toContain(k);
    for (const m of ['continues', 'slots:1', 'slots:2', 'flush:forceFlush']) expect(seen.marks, m).toContain(m);
  });
});

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

describe('超富豪モードの JSON 往復と、入力の状態を変えないこと', () => {
  it('毎手で JSON 往復した状態に同じ操作を適用すると結果が同じ。凍結した状態でも viewFor などが落ちない', () => {
    const rng = rngFromSeed([4, 4, 2, 2]);
    for (let m = 0; m < 6; m++) {
      const created = createMatch(CHOFUGO, [m + 61, 3, 1, 4]);
      if (!created.ok) throw new Error();
      let s: MatchState = deepFreeze(created.state);
      let steps = 0;
      while (s.phase !== 'matchResult' && steps++ < 8000) {
        for (const seat of [0, 1, 2, 3] as const) {
          viewFor(s, seat);
          legalPlays(s, seat);
        }
        const round = JSON.parse(JSON.stringify(s)) as MatchState;
        expect(round).toStrictEqual(s);
        let a: Action;
        if (s.phase === 'gameResult') a = { type: 'nextGame' };
        else if (nextInt(rng, 2) === 0) a = randomAction(s, rng);
        else a = { type: 'auto', awaitId: awaiting(s)[0]!.id, policy: nextInt(rng, 2) ? 'cpu' : 'timeout' };
        const r1 = applyAction(s, a);
        const r2 = applyAction(round, a);
        expect(r2).toStrictEqual(r1);
        if (!r1.ok) throw new Error(r1.error.message);
        const events = deepFreeze(r1.events);
        for (const seat of [0, 1, 2, 3] as const) eventsFor(events, seat);
        s = deepFreeze(r1.state);
      }
      expect(s.phase).toBe('matchResult');
    }
  }, 60_000);
});
