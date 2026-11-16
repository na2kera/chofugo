// 不正な操作（design §3.9、spec §11.1）。エラーになり、入力の状態は変わらない（乱数も進まない）。
import { describe, expect, it } from 'vitest';
import { applyAction, awaiting, createMatch, IMPLEMENTED_RULE_IDS, type Action, type MatchState, type RuleId } from './index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { Driver, cfg, randomAction, scene } from './test/helpers.ts';

function expectRejected(s: MatchState, a: Action, code?: string) {
  const before = JSON.stringify(s);
  const r = applyAction(s, a);
  expect(r.ok, JSON.stringify(a)).toBe(false);
  if (!r.ok && code !== undefined) expect(r.error.code).toBe(code);
  expect(JSON.stringify(s)).toBe(before);
}

describe('不正な操作', () => {
  const s0 = scene({ rules: ['runs'], hands: ['S5 S6 S7 H9', 'H6 H7', 'D4 D10', 'C4 CK'], turn: 0 });
  const id = 100;

  it('他人の手番・持っていないカード・古い待ち番号・フェーズ違い', () => {
    expectRejected(s0, { type: 'play', seat: 1, awaitId: id, cards: ['heart-6'] }, 'notYourAwait');
    expectRejected(s0, { type: 'play', seat: 0, awaitId: id, cards: ['heart-6'] }, 'cardNotInHand');
    expectRejected(s0, { type: 'play', seat: 0, awaitId: 99, cards: ['spade-5'] }, 'staleAwait');
    expectRejected(s0, { type: 'auto', awaitId: 99, policy: 'cpu' }, 'staleAwait');
    expectRejected(s0, { type: 'exchangeGive', seat: 0, awaitId: id, cards: ['spade-5'] }, 'wrongAwaitKind');
    expectRejected(s0, { type: 'respond', seat: 0, awaitId: id, cards: null }, 'wrongAwaitKind');
    expectRejected(s0, { type: 'nextGame' }, 'wrongPhase');
    expectRejected(s0, { type: 'endMatch' }, 'wrongPhase');
  });

  it('形の誤り・組み合わせの誤り・重複', () => {
    expectRejected(s0, { type: 'play', seat: 0, awaitId: id, cards: [] }, 'malformed');
    expectRejected(s0, { type: 'play', seat: 0, awaitId: id, cards: ['spade-5', 'spade-5'] }, 'malformed');
    expectRejected(s0, { type: 'play', seat: 0, awaitId: id, cards: ['spade-5', 'heart-9'] }, 'invalidCombination');
    expectRejected(s0, { type: 'play', seat: 0, awaitId: id, cards: ['bogus'] }, 'cardNotInHand');
    expectRejected(s0, { type: 'play', seat: 7, awaitId: id, cards: ['spade-5'] } as never, 'malformed');
    expectRejected(s0, { type: 'play', seat: 0, awaitId: id, cards: 'spade-5' } as never, 'malformed');
    expectRejected(s0, { type: 'play', seat: 0, awaitId: id, cards: ['spade-5'], shape: 'x' } as never, 'malformed');
    expectRejected(s0, { type: 'what' } as never, 'malformed');
    expectRejected(s0, null as never, 'malformed');
    expectRejected(s0, { type: 'auto', awaitId: id, policy: 'smart' } as never, 'malformed');
  });

  it('使い終わった待ち番号は、本人の操作も auto も受け付けない', () => {
    const d = new Driver(s0);
    d.play(0, 'S5');
    expectRejected(d.state, { type: 'pass', seat: 0, awaitId: id }, 'staleAwait');
    expectRejected(d.state, { type: 'auto', awaitId: id, policy: 'timeout' }, 'staleAwait');
    // 同じ人の手番が続く場合も、新しい手番は新しい番号
    const d2 = new Driver(scene({ rules: [], hands: ['S5 S6', 'H4', 'D4', 'C4'], turn: 0 }));
    d2.play(0, 'S5');
    d2.pass(1);
    d2.pass(2);
    d2.pass(3);
    const w = d2.current();
    expect(w.seat).toBe(0);
    expect(w.id).not.toBe(id);
    expectRejected(d2.state, { type: 'play', seat: 0, awaitId: id, cards: ['spade-6'] }, 'staleAwait');
  });

  it('パス後・抜けたあとの席の操作は拒否される', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 S9', 'H6 H8', 'D7 D10', 'C4 CK'], turn: 0 }));
    d.play(0, 'S5');
    const w1 = d.current();
    d.pass(1);
    expectRejected(d.state, { type: 'play', seat: 1, awaitId: w1.id, cards: ['heart-8'] }, 'staleAwait');
    const w2 = d.current();
    expectRejected(d.state, { type: 'play', seat: 1, awaitId: w2.id, cards: ['heart-8'] }, 'notYourAwait');
  });

  it('でたらめな対戦の途中に不正な操作を混ぜても、常に拒否され状態は変わらない', () => {
    const rng = rngFromSeed([42, 42, 42, 42]);
    for (let m = 0; m < 12; m++) {
      const rules = IMPLEMENTED_RULE_IDS.filter(() => nextInt(rng, 2) === 1) as RuleId[];
      const created = createMatch(cfg(rules, 5), [m + 1, 9, 9, 9]);
      if (!created.ok) throw new Error();
      let s = created.state;
      let steps = 0;
      while (s.phase !== 'matchResult' && steps < 3000) {
        steps++;
        if (s.phase === 'gameResult') {
          expectRejected(s, { type: 'play', seat: 0, awaitId: s.nextAwaitId - 1, cards: ['spade-3'] });
          const r = applyAction(s, { type: 'nextGame' });
          if (!r.ok) throw new Error();
          s = r.state;
          continue;
        }
        const ws = awaiting(s);
        const w = ws[0]!;
        const g = s.game!;
        const other = ([0, 1, 2, 3] as const).find((x) => !ws.some((a) => a.seat === x))!;
        const foreign = g.hands.find((h, i) => i !== w.seat && h.length > 0)?.[0] ?? 'nope';
        const kindType = w.kind === 'turn' ? 'play' : w.kind === 'respond' ? 'respond' : 'exchangeGive';
        const bad: Action[] = [
          { type: kindType, seat: other, awaitId: w.id, cards: g.hands[other]?.slice(0, 1) ?? [] } as Action,
          { type: kindType, seat: w.seat, awaitId: w.id, cards: [foreign] } as Action,
          { type: 'pass', seat: w.seat, awaitId: w.id - 1000 },
          { type: 'auto', awaitId: s.nextAwaitId, policy: 'cpu' },
          { type: 'nextGame' },
        ];
        if (s.phase === 'exchange') bad.push({ type: 'play', seat: w.seat, awaitId: w.id, cards: g.hands[w.seat]!.slice(0, 1) });
        else bad.push({ type: 'exchangeGive', seat: w.seat, awaitId: w.id, cards: [] });
        for (const a of bad) expectRejected(s, a);
        const r = applyAction(s, randomAction(s, rng));
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
      }
      expect(s.phase).toBe('matchResult');
    }
  }, 60_000);
});
