import { describe, expect, it } from 'vitest';
import { Driver, scene } from '../test/helpers.ts';

describe('8切り（decisions §6.1、§6.0.1）', () => {
  it('8の組を出すと場が流れ、出した人が親になる', () => {
    const d = new Driver(scene({ rules: ['flush_on_8'], hands: ['S5 H6', 'S8 C9', 'D4 D10', 'C3 CK'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'S8');
    expect(d.game.field).toEqual([]);
    expect(d.game.discard).toEqual(expect.arrayContaining(['spade-5', 'spade-8']));
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
    expect(d.events.find((e) => e.type === 'fieldCleared')).toMatchObject({ reason: 'flush_on_8', leader: 1 });
  });

  it('ジョーカーを混ぜた8の組でも流れる', () => {
    const d = new Driver(scene({ rules: ['flush_on_8'], hands: ['S5 H5 H6', 'S8 X0 C9', 'D4 D10', 'C3 CK'], turn: 0 }));
    d.play(0, 'S5 H5');
    d.play(1, 'S8 X0');
    expect(d.game.field).toEqual([]);
    expect(d.current().seat).toBe(1);
  });

  it('階段に含まれる8では流れない', () => {
    const d = new Driver(scene({ rules: ['flush_on_8', 'runs'], hands: ['S6 S7 S8 H3', 'C9 C10 CJ C3', 'D4 D10', 'H4 HK'], turn: 0 }));
    d.play(0, 'S6 S7 S8');
    expect(d.game.field).toHaveLength(1);
    expect(d.current().seat).toBe(1);
  });

  it('OFF なら8を出しても流れない', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5 H6', 'S8 C9', 'D4 D10', 'C3 CK'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'S8');
    expect(d.game.field).toHaveLength(2);
    expect(d.current().seat).toBe(2);
  });

  it('8で上がったとき、親は次の残っている人になる', () => {
    const d = new Driver(scene({ rules: ['flush_on_8'], hands: ['S5 H6', 'S8', 'D4 D10', 'C3 CK'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'S8');
    expect(d.places()?.[1]).toBe(1);
    expect(d.current().seat).toBe(2);
  });
});
