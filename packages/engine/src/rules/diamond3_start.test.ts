import { describe, expect, it } from 'vitest';
import { applyAction, awaiting, createMatch, legalPlays, viewFor, type MatchState, type SeatId } from '../index.ts';
import { Driver, cfg, cs, scene } from '../test/helpers.ts';

function holder(s: MatchState): SeatId {
  return ([0, 1, 2, 3] as SeatId[]).find((x) => s.game!.hands[x]!.includes('diamond-3'))!;
}

describe('ダイヤの3スタート（decisions §6.11、§16.3）', () => {
  it('1ゲーム目: ダイヤの3を持つ人が親。乱数は ON でも OFF でも同じだけ引く', () => {
    for (let i = 0; i < 8; i++) {
      const seed: [number, number, number, number] = [i + 1, 3, 5, 7];
      const on = createMatch(cfg(['diamond3_start']), seed);
      const off = createMatch(cfg([]), seed);
      if (!on.ok || !off.ok) throw new Error();
      expect(on.state.rng).toEqual(off.state.rng);
      expect(on.state.game!.hands).toEqual(off.state.game!.hands);
      expect(on.events[0]).toMatchObject({ type: 'gameStart', leaderRule: 'diamond3' });
      const h = holder(on.state);
      expect(on.state.game!.starter).toBe(h);
      expect(awaiting(on.state)).toEqual([expect.objectContaining({ seat: h, kind: 'turn' })]);
      expect(viewFor(on.state, 0).game?.openingCard).toBe('diamond-3');
      const mine = viewFor(on.state, h).mine;
      // 親はパスできない。出せる手はすべてダイヤの3を含む
      expect(mine).toMatchObject({ kind: 'turn', leader: true, canPass: false });
      const plays = legalPlays(on.state, h);
      expect(plays.length).toBeGreaterThan(0);
      for (const p of plays) expect(p.cards).toContain('diamond-3');
    }
  });

  it('交換でダイヤの3が動いたあとは、交換が終わった時点で持っている人が親', () => {
    let moved = 0;
    for (let i = 0; i < 40 && moved < 3; i++) {
      const created = createMatch(cfg(['diamond3_start']), [i + 100, 1, 2, 3]);
      if (!created.ok) throw new Error();
      let s = created.state;
      // 1ゲーム目を CPU で最後まで進める
      while (s.phase === 'play') {
        const r = applyAction(s, { type: 'auto', awaitId: awaiting(s)[0]!.id, policy: 'cpu' });
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
      }
      const r = applyAction(s, { type: 'nextGame' });
      if (!r.ok) throw new Error();
      s = r.state;
      expect(s.phase).toBe('exchange');
      expect(r.events[0]).toMatchObject({ type: 'gameStart', leaderRule: 'diamond3' });
      const before = holder(s);
      // 交換が終わるまでの starter は仮の値（その時点でダイヤの3を持つ席）
      expect(s.game!.starter).toBe(before);
      while (s.phase === 'exchange') {
        const x = applyAction(s, { type: 'auto', awaitId: awaiting(s)[0]!.id, policy: 'cpu' });
        if (!x.ok) throw new Error(x.error.message);
        s = x.state;
      }
      const after = holder(s);
      expect(s.game!.starter).toBe(after);
      expect(awaiting(s)).toEqual([expect.objectContaining({ seat: after, kind: 'turn' })]);
      expect(s.game!.openingCard).toBe('diamond-3');
      if (before !== after) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('最初の1手で義務が外れる。組・階段・砂嵐にダイヤの3を含めてもよい', () => {
    const base = () =>
      scene({
        rules: ['diamond3_start', 'runs', 'triple3_trump'],
        hands: ['D3 S3 H3 D4 D5 C9', 'H6 H9', 'D7 D8', 'C4 CK'],
        turn: 0,
        openingCard: 'diamond-3',
      });
    const keys = legalPlays(base(), 0).map((p) => p.cards.join(' '));
    for (const k of [cs('D3'), cs('S3 D3'), cs('S3 H3 D3'), cs('D3 D4 D5')]) expect(keys).toContain(k.join(' '));
    for (const k of [cs('S3'), cs('C9'), cs('S3 H3'), cs('D4')]) expect(keys).not.toContain(k.join(' '));
    const d = new Driver(base());
    const bad = d.try({ type: 'play', seat: 0, awaitId: d.current().id, cards: cs('C9') });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.violation).toBe('openingCard');
    d.play(0, 'D3 D4 D5');
    expect(d.game.openingCard).toBeNull();
    expect(legalPlays(d.state, 1)).toEqual([]);
    d.pass(1);
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([]);
  });

  it('砂嵐でもダイヤの3を含まなければ最初の1手にできない', () => {
    const d = new Driver(
      scene({ rules: ['diamond3_start', 'triple3_trump'], hands: ['D3 S3 H3 C3 C9', 'H6', 'D7', 'C4'], turn: 0, openingCard: 'diamond-3' }),
    );
    const bad = d.try({ type: 'play', seat: 0, awaitId: d.current().id, cards: cs('S3 H3 C3') });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.violation).toBe('openingCard');
    d.play(0, 'S3 H3 D3');
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'triple3_trump', leader: 0 });
  });

  it('親の時間切れはダイヤの3の1枚出し', () => {
    const d = new Driver(
      scene({ rules: ['diamond3_start', 'runs'], hands: ['D3 D4 D5 S3 C9', 'H6', 'D7', 'C4'], turn: 0, openingCard: 'diamond-3' }),
    );
    const ev = d.apply({ type: 'auto', awaitId: d.current().id, policy: 'timeout' });
    expect(ev[0]).toMatchObject({ type: 'play', seat: 0, play: { cards: cs('D3') } });
  });
});
