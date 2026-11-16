// レビュー指摘の回帰テスト（decisions §14.14）。
import { describe, expect, it } from 'vitest';
import { applyAction, createMatch, validateConfig } from './index.ts';
import { Driver, cs, scene } from './test/helpers.ts';

describe('返しの一周を省く判定は、一周を始める直前の状態で行う', () => {
  it('A の最後のジョーカーで1位 → ♠3を持つ前の大富豪 C が都落ち → B・D への返し待ちは始まらない', () => {
    // A=0, B=1, C=2（前の大富豪、♠3を持つ）, D=3。禁止上がりは OFF
    const d = new Driver(
      scene({ rules: ['spade3_beats_joker', 'dethrone'], prevRanks: [2, 3, 1, 4], hands: ['X0', 'H5 H6', 'S3 D9', 'C8 C7'], turn: 0 }),
    );
    d.play(0, 'X0');
    expect(d.types()).toEqual(['play', 'placed', 'dethrone', 'placed', 'fieldCleared']);
    expect(d.events.at(-1)).toMatchObject({ reason: 'jokerUnbeatable', leader: 1 });
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
    expect(d.game.pending).toBeNull();
  });
});

describe('ジョーカーだけの手はすぐ流す', () => {
  it('ジョーカー2枚の組を出すと、スペ3返しが OFF でもすぐ場が流れる', () => {
    const e = new Driver(scene({ rules: [], hands: ['S9 H9 C4', 'X0 X1 H6', 'D7 D8', 'C3 CK'], turn: 0 }));
    e.play(0, 'S9 H9');
    e.play(1, 'X0 X1');
    expect(e.game.field).toEqual([]);
    expect(e.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'jokerUnbeatable', leader: 1 });
    expect(e.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });
});

describe('CPU の並べ方（ジョーカーを使わない手を先に）', () => {
  it('親: 3＋ジョーカーの組より、3の1枚出しを選ぶ', () => {
    const d = new Driver(scene({ rules: [], hands: ['S3 X0 S9', 'H6', 'D4', 'C4'], turn: 0 }));
    const ev = d.apply({ type: 'auto', awaitId: d.current().id, policy: 'cpu' });
    expect(ev[0]).toMatchObject({ type: 'play', play: { cards: cs('S3') } });
  });
  it('親でない: 6＋ジョーカーより、ジョーカーを使わない9の組を選ぶ', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 H5 C4', 'S6 X0 S9 H9', 'D4', 'C4'], turn: 0 }));
    d.play(0, 'S5 H5');
    const ev = d.apply({ type: 'auto', awaitId: d.current().id, policy: 'cpu' });
    expect(ev[0]).toMatchObject({ type: 'play', play: { cards: cs('S9 H9') } });
  });
  it('ジョーカーを使う手しかなければ、それを出す', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 H5 C4', 'S6 X0 C3', 'D4', 'C4'], turn: 0 }));
    d.play(0, 'S5 H5');
    const ev = d.apply({ type: 'auto', awaitId: d.current().id, policy: 'cpu' });
    expect(ev[0]).toMatchObject({ type: 'play', play: { cards: cs('S6 X0') } });
  });
});

describe('壊れた入力で例外を投げない', () => {
  const garbage: unknown[] = [
    null,
    0,
    -1,
    1e300,
    'x',
    '',
    true,
    [],
    [null],
    {},
    { toString: null },
    [{ toString: null }],
    { a: { b: { c: [1, { d: null }] } } },
    Array.from({ length: 100_000 }, (_, i) => i),
    Array.from({ length: 1000 }, () => ({ toString: null })),
  ];

  it('validateConfig / createMatch', () => {
    const configs: unknown[] = [
      ...garbage,
      { matchId: 'x', rules: [{ toString: null }], gameCount: 5 },
      ...garbage.map((g) => ({ matchId: 'x', rules: g, gameCount: 5 })),
      ...garbage.map((g) => ({ matchId: 'x', rules: [g], gameCount: 5 })),
      ...garbage.map((g) => ({ matchId: g, rules: [], gameCount: 5 })),
      ...garbage.map((g) => ({ matchId: 'x', rules: [], gameCount: g })),
    ];
    for (const config of configs) {
      expect(() => validateConfig(config)).not.toThrow();
      for (const seed of [[1, 2, 3, 4], ...garbage]) {
        expect(() => createMatch(config as never, seed as never)).not.toThrow();
      }
    }
    expect(validateConfig({ matchId: 'x', rules: [{ toString: null }], gameCount: 5 })).toMatchObject({ code: 'unknownRule' });
    for (const seed of garbage) {
      const r = createMatch({ matchId: 'x', rules: [], gameCount: 5 }, seed as never);
      expect(r.ok).toBe(false);
    }
  });

  it('applyAction', () => {
    const s = scene({ rules: ['runs', 'spade3_beats_joker'], hands: ['S5 S6 S7 X0', 'H6 H7', 'D4 D10', 'C4 CK'], turn: 0 });
    const before = JSON.stringify(s);
    const fields = ['seat', 'awaitId', 'cards', 'shape', 'confirmFoul', 'policy'];
    const actions: unknown[] = [...garbage];
    for (const type of ['play', 'pass', 'respond', 'exchangeGive', 'auto', 'nextGame', 'endMatch', 'bogus', ...garbage]) {
      actions.push({ type });
      for (const f of fields) for (const g of garbage) actions.push({ type, seat: 0, awaitId: 100, cards: ['spade-5'], [f]: g });
    }
    for (const a of actions) {
      expect(() => applyAction(s, a as never)).not.toThrow();
    }
    expect(JSON.stringify(s)).toBe(before);
  });
});
