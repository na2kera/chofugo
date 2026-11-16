// カード交換（decisions §3.2、§14.5、spec §11.1）。
import { describe, expect, it } from 'vitest';
import { applyAction, awaiting, eventsFor, viewFor, type MatchState, type SeatId } from './index.ts';
import { lowerGiveSplit, startExchange } from './exchange.ts';
import { makeCtx } from './game.ts';
import { deepClone } from './clone.ts';
import { rngFromSeed } from './rng.ts';
import { cfg, cs, runMatch, scene, type Setup } from './test/helpers.ts';

function exchangeScene(s: Omit<Setup, 'turn'> & { prevRanks: (1 | 2 | 3 | 4)[] }) {
  const base = deepClone(scene({ ...s, turn: 0 }));
  const lowest = s.prevRanks.indexOf(4) as SeatId;
  base.game!.starter = lowest;
  base.game!.awaiting = [];
  const c = makeCtx(base);
  startExchange(c, s.prevRanks);
  return { state: base, events: c.events };
}

describe('下位が渡すカードの決め方', () => {
  it('強さで決まるときは選択の余地がない', () => {
    expect(lowerGiveSplit(cs('S3 S2 H2 SA'), 2)).toEqual({ forced: cs('S2 H2'), candidates: [], choose: 0 });
  });
  it('同じ強さで決まらない分だけ候補になる（ジョーカー ＞ 2 ＞ A …）', () => {
    expect(lowerGiveSplit(cs('X0 S2 H2 SA'), 2)).toEqual({ forced: cs('X0'), candidates: cs('S2 H2'), choose: 1 });
    expect(lowerGiveSplit(cs('S2 SA HA DA'), 2)).toEqual({ forced: cs('S2'), candidates: cs('SA HA DA'), choose: 1 });
    expect(lowerGiveSplit(cs('SA HA C5'), 1)).toEqual({ forced: [], candidates: cs('SA HA'), choose: 1 });
  });
  it('ジョーカー同士は区別しないので自動で決める', () => {
    expect(lowerGiveSplit(cs('X0 X1 S2'), 1)).toEqual({ forced: ['joker-0'], candidates: [], choose: 0 });
  });
});

describe('交換の進み方', () => {
  const hands = ['SK S4 S5', 'X0 S2 C3 C4', 'HA DA C5 C6', 'D3 D4 D7']; // 0:大富豪 1:大貧民 2:貧民 3:富豪
  const prevRanks: (1 | 2 | 3 | 4)[] = [1, 4, 3, 2];

  it('選択の余地がない下位は待たずに渡し、上位は受け取ってから選ぶ。2組は並行', () => {
    const { state, events } = exchangeScene({ rules: [], hands, prevRanks });
    expect(state.phase).toBe('exchange');
    // 大貧民(1) → 大富豪(0): ジョーカーと2 は自動
    expect(events.find((e) => e.type === 'exchange')).toMatchObject({ from: 1, to: 0, cards: cs('S2 X0') });
    expect(state.game!.hands[0]).toEqual(cs('S4 S5 SK S2 X0'));
    const w = awaiting(state);
    expect(w.map((x) => [x.seat, x.kind, x.timer])).toEqual([
      [0, 'exchangeGive', 'exchange'],
      [2, 'exchangeGive', 'exchange'],
    ]);
    expect(viewFor(state, 2).mine).toMatchObject({ kind: 'exchangeGive', role: 'lower', candidates: cs('HA DA'), choose: 1 });
    expect(viewFor(state, 0).mine).toMatchObject({ kind: 'exchangeGive', role: 'upper', count: 2 });
  });

  it('候補にないカード・枚数違いは拒否し、受け取ったカードをそのまま返してもよい', () => {
    const { state } = exchangeScene({ rules: [], hands, prevRanks });
    const w2 = awaiting(state).find((x) => x.seat === 2)!;
    for (const cards of [cs('C5'), cs('HA DA'), cs('S2')]) {
      const r = applyAction(state, { type: 'exchangeGive', seat: 2, awaitId: w2.id, cards });
      expect(r.ok).toBe(false);
    }
    let s: MatchState = state;
    const step = (seat: SeatId, cards: string[]) => {
      const w = awaiting(s).find((x) => x.seat === seat)!;
      const r = applyAction(s, { type: 'exchangeGive', seat, awaitId: w.id, cards });
      if (!r.ok) throw new Error(r.error.message);
      s = r.state;
      return r.events;
    };
    step(2, cs('DA'));
    expect(awaiting(s).map((x) => x.seat)).toEqual([0, 3]);
    step(0, cs('S2 X0')); // 受け取ったカードをそのまま返す
    const ev = step(3, cs('D3'));
    expect(ev.map((e) => e.type)).toEqual(['exchange', 'exchangeDone']);
    expect(s.phase).toBe('play');
    // 最初の人は前のゲームの大貧民
    expect(awaiting(s)).toEqual([expect.objectContaining({ seat: 1, kind: 'turn' })]);
    expect(s.game!.hands[1]).toEqual(cs('C3 C4 S2 X0'));
  });

  it('時間切れ: 上位はいちばん弱いカードから（同じ強さならマーク順）、下位は候補からランダム', () => {
    const h = ['S3 H3 D3 SK', 'X0 S2 C9 C4', 'HA DA C5 C6', 'C3 D4 D7'];
    const { state } = exchangeScene({ rules: [], hands: h, prevRanks });
    const w0 = awaiting(state).find((x) => x.seat === 0)!;
    const r = applyAction(state, { type: 'auto', awaitId: w0.id, policy: 'timeout' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events[0]).toMatchObject({ type: 'exchange', from: 0, to: 1, cards: cs('S3 H3') });
    const picks = new Set<string>();
    for (let i = 1; i <= 20; i++) {
      const st = deepClone(state);
      st.rng = rngFromSeed([i, 2, 3, 4]);
      const w2 = awaiting(st).find((x) => x.seat === 2)!;
      const r2 = applyAction(st, { type: 'auto', awaitId: w2.id, policy: 'timeout' });
      if (!r2.ok) throw new Error(r2.error.message);
      const ev = r2.events[0];
      if (ev?.type === 'exchange') picks.add(ev.cards.join());
    }
    expect([...picks].sort()).toEqual(['diamond-14', 'heart-14']);
  });

  it('渡したカードの中身は、渡した人と受け取った人にだけ見える', () => {
    const { events } = exchangeScene({ rules: [], hands, prevRanks });
    const ex = events.filter((e) => e.type === 'exchange');
    expect(eventsFor(ex, 1)[0]).toMatchObject({ count: 2, cards: cs('S2 X0') });
    expect(eventsFor(ex, 0)[0]).toMatchObject({ count: 2, cards: cs('S2 X0') });
    expect(eventsFor(ex, 2)[0]).toMatchObject({ count: 2, cards: null });
    expect(eventsFor(ex, 3)[0]).toMatchObject({ count: 2, cards: null });
  });

  it('2ゲーム目から階級に沿って2枚・1枚の交換がある（spec §11.1）', () => {
    const { state } = runMatch(cfg([], 5), [6, 6, 6, 6], 'cpu', { maxActions: 100000 });
    // 試合を最後まで進めた結果から、各ゲームの交換の出来事を数え直す代わりに、2ゲーム目の開始を作り直す
    const g1 = state.results[0]!;
    const r = applyAction({ ...deepClone(state), phase: 'gameResult', prevRanks: null, gameNo: 1, results: [g1] }, { type: 'nextGame' });
    if (!r.ok) throw new Error(r.error.message);
    const start = r.events.find((e) => e.type === 'exchangeStart');
    expect(start).toMatchObject({ pairs: [{ count: 2 }, { count: 1 }] });
    if (start?.type === 'exchangeStart') {
      expect(start.pairs[0]).toMatchObject({ lower: g1.places.indexOf(4), upper: g1.places.indexOf(1) });
      expect(start.pairs[1]).toMatchObject({ lower: g1.places.indexOf(3), upper: g1.places.indexOf(2) });
    }
    const cards = r.state.game!.hands.flat();
    expect(new Set(cards).size).toBe(54);
  });
});
