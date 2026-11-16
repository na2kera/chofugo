import { describe, expect, it } from 'vitest';
import { legalPlays } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

describe('マーク縛り（decisions §6.6、§14.6）', () => {
  it('同じマークが続くと成立し、そのマークしか出せない。場が流れると解除', () => {
    const d = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 S9 H3', 'S7 HQ H4', 'DK SK D3', 'C3 CA'], turn: 0 }));
    d.play(0, 'S5');
    expect(d.game.suitLock).toBeNull();
    d.play(1, 'S7');
    expect(d.game.suitLock).toEqual(['spade']);
    const w = d.current();
    const bad = d.try({ type: 'play', seat: 2, awaitId: w.id, cards: cs('DK') });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.violation).toBe('suitLock');
    d.play(2, 'SK');
    d.pass(3);
    d.pass(0);
    d.pass(1);
    expect(d.game.suitLock).toBeNull();
  });

  it('組はマークの組み合わせが完全に同じときに成立する', () => {
    const d = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 H5 S3', 'S7 H7 H4', 'S9 D9 SK HK', 'C3 CA'], turn: 0 }));
    d.play(0, 'S5 H5');
    d.play(1, 'S7 H7');
    expect(d.game.suitLock).toEqual(['spade', 'heart']);
    const plays = legalPlays(d.state, 2);
    expect(plays.map((p) => p.cards)).toEqual([cs('SK HK')]);
  });

  it('マークが一部だけ同じなら成立しない', () => {
    const d = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 H5 S3', 'S7 D7 H4', 'S9 D9', 'C3 CA'], turn: 0 }));
    d.play(0, 'S5 H5');
    d.play(1, 'S7 D7');
    expect(d.game.suitLock).toBeNull();
  });

  it('ジョーカーは縛り中に足りないマークの代わりになり、その解釈を記録する', () => {
    const d = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 D5 S3', 'S7 D7 H4', 'S9 X0 C9 H3', 'C3 CA'], turn: 0 }));
    d.play(0, 'S5 D5');
    d.play(1, 'S7 D7');
    expect(d.game.suitLock).toEqual(['spade', 'diamond']);
    // ♣9 + ジョーカーは出せない、♠9 + ジョーカーは出せる
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([cs('S9 X0')]);
    d.play(2, 'S9 X0');
    const top = d.game.field[d.game.field.length - 1];
    expect(top?.play.jokers).toEqual([{ card: 'joker-0', rank: 9, suit: 'diamond' }]);
  });

  it('縛り中もジョーカーの1枚出しは出せる', () => {
    const d = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 S3', 'S7 H4', 'X0 H3', 'C3 CA'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'S7');
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([['joker-0']]);
  });

  it('ジョーカーを含む出し方では縛りは新しく成立しない（どちら側でも）', () => {
    const a = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 X0 S3', 'S7 H7 H4', 'S9 D9', 'C3 CA'], turn: 0 }));
    a.play(0, 'S5 X0');
    a.play(1, 'S7 H7');
    expect(a.game.suitLock).toBeNull();
    const b = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 H5 S3', 'S7 X0 H4', 'S9 D9', 'C3 CA'], turn: 0 }));
    b.play(0, 'S5 H5');
    b.play(1, 'S7 X0');
    expect(b.game.suitLock).toBeNull();
  });

  it('同じマークの階段が続くと成立する', () => {
    const d = new Driver(
      scene({ rules: ['suit_lock', 'runs'], hands: ['S3 S4 S5 H3', 'S7 S8 S9 H4', 'DJ DQ DK SJ SQ SK', 'C3 CA'], turn: 0 }),
    );
    d.play(0, 'S3 S4 S5');
    d.play(1, 'S7 S8 S9');
    expect(d.game.suitLock).toEqual(['spade']);
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([cs('SJ SQ SK')]);
  });

  it('OFF なら同じマークが続いても縛られない', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 S9 H3', 'S7 HQ H4', 'DK SK D3', 'C3 CA'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'S7');
    expect(d.game.suitLock).toBeNull();
    d.play(2, 'DK');
  });
});
