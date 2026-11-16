// 基本対戦（decisions §2、§3、spec §11.1）。
import { describe, expect, it } from 'vitest';
import { applyAction, awaiting, createMatch, viewFor, type MatchState } from './index.ts';
import { Driver, allCards, cfg, newMatch, runMatch, scene } from './test/helpers.ts';

describe('配り方（§2.2、spec §11.1）', () => {
  it('54枚が一意に配られ、14・14・13・13枚。14枚の2人は種で変わる', () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 30; i++) {
      const { state, events } = newMatch([], [i, 3, 5, 7]);
      const g = state.game!;
      expect(new Set(allCards(g)).size).toBe(54);
      expect(g.hands.map((h) => h.length).sort()).toEqual([13, 13, 14, 14]);
      seen.add(g.hands.map((h) => h.length).join());
      expect(events.map((e) => e.type)).toEqual(['gameStart', 'deal']);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('同じ種なら同じ配り方・同じ最初の人（再現できる）', () => {
    const a = newMatch(['runs'], [11, 22, 33, 44]).state;
    const b = newMatch(['runs'], [11, 22, 33, 44]).state;
    expect(a).toStrictEqual(b);
  });

  it('初回は交換も特権もなく、ランダムな人から始まる', () => {
    const starters = new Set<number>();
    for (let i = 1; i <= 20; i++) {
      const s = newMatch([], [i, 1, 1, 1]).state;
      expect(s.phase).toBe('play');
      expect(s.game?.exchange).toBeNull();
      const w = awaiting(s);
      expect(w).toHaveLength(1);
      expect(w[0]?.kind).toBe('turn');
      starters.add(w[0]!.seat);
    }
    expect(starters.size).toBeGreaterThan(1);
  });
});

describe('手番と場（§2.3、§2.4、§14.1）', () => {
  it('同じ種類・同じ枚数で、より強いものしか出せない', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 H5 S9', 'S7 H7 D7 C3', 'D4 D10', 'C4 CK'], turn: 0 }));
    d.play(0, 'S5 H5');
    const w = d.current();
    for (const cards of [['spade-7'], ['spade-7', 'heart-7', 'diamond-7'], ['club-3']]) {
      const r = d.try({ type: 'play', seat: 1, awaitId: w.id, cards });
      expect(r.ok).toBe(false);
    }
    d.play(1, 'S7 H7');
  });

  it('パスしたら、その場が流れるまで手番が来ない。誰も出さないまま最後に出した人へ戻ると流れる', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 S9', 'S7 H8', 'D4 D10', 'C4 CK'], turn: 0 }));
    d.play(0, 'S5');
    d.pass(1);
    d.play(2, 'D10');
    d.pass(3);
    // 1 はパス済みなので飛ばされる
    d.pass(0);
    expect(d.game.field).toEqual([]);
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
    expect(d.game.passed).toEqual([false, false, false, false]);
  });

  it('親は出せる手があるときはパスできない（§2.4）', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 S9', 'S7 H8', 'D4 D10', 'C4 CK'], turn: 0 }));
    const r = d.try({ type: 'pass', seat: 0, awaitId: d.current().id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cannotPass');
    expect(viewFor(d.state, 0).mine).toMatchObject({ kind: 'turn', leader: true, canPass: false });
  });

  it('最後に出した人が上がって抜けていても、その席を基準に一周を数え、親は次の残っている人（§14.1）', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 S6', 'SK', 'D4 D10', 'C4 C9'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'SK'); // 1 が上がる
    expect(d.places()?.[1]).toBe(1);
    d.pass(2);
    d.pass(3);
    d.pass(0);
    // 1 の席に着いたので流れる。親は 1 の次の 2
    expect(d.game.field).toEqual([]);
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
  });

  it('上がった人の次の人から手番が続く', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 S6', 'SK', 'D4 DA', 'C4 C9'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'SK');
    d.play(2, 'DA');
    expect(d.current().seat).toBe(3);
  });
});

describe('順位と得点（§3.3、§14.2）', () => {
  it('手札が0になった順に順位が決まり、残り1人になったら手札が残っていても確定する', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5', 'S6', 'S7', 'S8 S9'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'S6');
    d.play(2, 'S7');
    expect(d.places()).toEqual([1, 2, 3, 4]);
    expect(d.state.phase).toBe('gameResult');
    expect(d.game.hands[3]).toEqual(['spade-8', 'spade-9']);
    expect(d.state.scores).toEqual([2, 1, -1, -2]);
    expect(d.events.filter((e) => e.type === 'placed').map((e) => e.type === 'placed' && e.reason)).toEqual([
      'finish',
      'finish',
      'finish',
      'last',
    ]);
  });

  it('3人が続けて反則上がりをしたら、残った1人が1位（§14.2）', () => {
    const d = new Driver(scene({ rules: ['forbidden_finish'], hands: ['X0', 'X1', 'S2', 'S8 S9'], turn: 0 }));
    d.play(0, 'X0', { confirmFoul: true }); // 4位
    // ジョーカーで場が流れ、0 は抜けたので 1 が親
    d.play(1, 'X1', { confirmFoul: true }); // 3位
    d.play(2, 'S2', { confirmFoul: true }); // 2位
    expect(d.places()).toEqual([4, 3, 2, 1]);
    expect(d.state.phase).toBe('gameResult');
  });
});

describe('試合の区切り（§3.3、§14.12）', () => {
  it('5ゲームで終わり、合計点で総合順位（同点は同じ順位）', () => {
    const { state } = runMatch(cfg(['runs'], 5), [3, 1, 4, 1], 'cpu');
    expect(state.phase).toBe('matchResult');
    expect(state.results).toHaveLength(5);
    const v = viewFor(state, 0);
    expect(v.standings).toHaveLength(4);
    const st = v.standings!;
    for (const r of st) expect(r.rank).toBe(1 + st.filter((o) => o.score > r.score).length);
    expect(state.scores.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('10ゲームで終わる', () => {
    const { state } = runMatch(cfg([], 10), [2, 7, 1, 8], 'cpu');
    expect(state.results).toHaveLength(10);
  });

  it('無制限は endMatch で終わる。回数つきの試合や、ゲームの途中では終えられない', () => {
    const { state } = runMatch(cfg([], null), [5, 5, 5, 5], 'cpu', { endUnlimitedAfter: 7 });
    expect(state.phase).toBe('matchResult');
    expect(state.results).toHaveLength(7);
    const mid = newMatch([], [1, 2, 3, 4], null).state;
    const r = applyAction(mid, { type: 'endMatch' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('wrongPhase');
    const limited = runMatch(cfg([], 5), [1, 1, 2, 2], 'cpu', { maxActions: 100000 });
    const r2 = applyAction({ ...limited.state, phase: 'gameResult' } as MatchState, { type: 'endMatch' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('notUnlimited');
  });

  it('最終ゲームのあとは nextGame できない', () => {
    const { state } = runMatch(cfg([], 5), [8, 8, 8, 8], 'cpu');
    const r = applyAction(state, { type: 'nextGame' });
    expect(r.ok).toBe(false);
  });

  it('2ゲーム目の最初の人は前のゲームの大貧民', () => {
    const created = createMatch(cfg([], 5), [4, 4, 4, 4]);
    if (!created.ok) throw new Error();
    let s = created.state;
    while (s.phase !== 'gameResult') {
      const w = awaiting(s)[0]!;
      const r = applyAction(s, { type: 'auto', awaitId: w.id, policy: 'cpu' });
      if (!r.ok) throw new Error(r.error.message);
      s = r.state;
    }
    const lowest = s.results[0]!.places.indexOf(4);
    const r = applyAction(s, { type: 'nextGame' });
    if (!r.ok) throw new Error();
    expect(r.state.game?.starter).toBe(lowest);
    expect(r.state.prevRanks).toEqual(s.results[0]!.places);
  });
});
