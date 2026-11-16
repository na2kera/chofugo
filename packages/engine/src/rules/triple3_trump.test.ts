import { describe, expect, it } from 'vitest';
import { legalPlays } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const SAND = cs('S3 H3 D3').join(' ');

describe('砂嵐（decisions §6.12、§14.8、§16.3）', () => {
  it('1枚出しの場に出せて、すぐ場が流れ、出した人が親', () => {
    const d = new Driver(scene({ rules: ['triple3_trump'], hands: ['S2 S9', 'S3 H3 D3 C9', 'D7', 'C4'], turn: 0 }));
    d.play(0, 'S2');
    expect(legalPlays(d.state, 1).map((p) => p.cards.join(' '))).toContain(SAND);
    d.play(1, 'S3 H3 D3');
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'triple3_trump', leader: 1 });
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('階段の場にも出せる', () => {
    const d = new Driver(scene({ rules: ['triple3_trump', 'runs'], hands: ['S5 S6 S7 S9', 'S3 H3 D3 C9', 'D7', 'C4'], turn: 0 }));
    d.play(0, 'S5 S6 S7');
    expect(legalPlays(d.state, 1).map((p) => p.cards.join(' '))).toEqual([SAND]);
    d.play(1, 'S3 H3 D3');
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'triple3_trump' });
  });

  it('マーク縛り中・激縛り中にも出せる', () => {
    const a = new Driver(scene({ rules: ['triple3_trump', 'suit_lock'], hands: ['S5 S9', 'S6 S8', 'S3 H3 D3 C9', 'C4'], turn: 0 }));
    a.play(0, 'S5');
    a.play(1, 'S6');
    expect(a.game.suitLock).toEqual(['spade']);
    a.play(2, 'S3 H3 D3');
    const b = new Driver(scene({ rules: ['triple3_trump', 'sequence_lock'], hands: ['H5 S9', 'H6 S8', 'S3 H3 D3 C9', 'C4'], turn: 0 }));
    b.play(0, 'H5');
    b.play(1, 'H6');
    expect(b.game.seqLock).not.toBeNull();
    expect(legalPlays(b.state, 2).map((p) => p.cards.join(' '))).toEqual([SAND]);
    b.play(2, 'S3 H3 D3');
    expect(b.game.seqLock).toBeNull();
  });

  it('空の場で出しても流れる。ジョーカーを3の代わりにはできない', () => {
    const d = new Driver(scene({ rules: ['triple3_trump'], hands: ['S3 H3 D3 C9', 'S5', 'D7', 'C4'], turn: 0 }));
    d.play(0, 'S3 H3 D3');
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'triple3_trump', leader: 0 });
    const e = new Driver(scene({ rules: ['triple3_trump'], hands: ['S2 S9', 'S3 H3 X0 C9', 'D7', 'C4'], turn: 0 }));
    e.play(0, 'S2');
    expect(legalPlays(e.state, 1).map((p) => p.cards.length)).toEqual([1]); // ジョーカーの1枚出しだけ
  });

  it('強さが逆のときに砂嵐で上がっても反則にならない（OFF なら3の3枚組は反則）', () => {
    const on = new Driver(
      scene({ rules: ['triple3_trump', 'forbidden_finish'], revolution: true, hands: ['S3 H3 D3', 'S5', 'D7', 'C4'], turn: 0 }),
    );
    expect(legalPlays(on.state, 0)[0]).toMatchObject({ foul: false });
    on.play(0, 'S3 H3 D3');
    expect(on.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, reason: 'finish' });
    const off = new Driver(scene({ rules: ['forbidden_finish'], revolution: true, hands: ['S3 H3 D3', 'S5', 'D7', 'C4'], turn: 0 }));
    off.play(0, 'S3 H3 D3', { confirmFoul: true });
    expect(off.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, reason: 'foul' });
  });

  it('3の4枚組は砂嵐ではなく革命', () => {
    const d = new Driver(scene({ rules: ['triple3_trump', 'revolution'], hands: ['S3 H3 D3 C3 C9', 'S5', 'D7', 'C4'], turn: 0 }));
    d.play(0, 'S3 H3 D3 C3');
    expect(d.types()).toEqual(['play', 'revolution']);
    expect(d.game.field).toHaveLength(1);
  });
});
