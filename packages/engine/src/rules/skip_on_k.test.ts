import { describe, expect, it } from 'vitest';
import { Driver, scene } from '../test/helpers.ts';

describe('K スキップ（decisions §6.15、§14.8、design-2 §2.4）', () => {
  it('1枚なら1人、2枚なら2人を飛ばす（飛ばされた人はパス扱いにならない）', () => {
    const a = new Driver(scene({ rules: ['skip_on_k'], hands: ['SK S4', 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    const ev = a.play(0, 'SK');
    expect(ev.map((e) => e.type)).toEqual(['play', 'skipped']);
    expect(ev[1]).toMatchObject({ by: 0, seats: [1] });
    expect(a.current()).toMatchObject({ seat: 2, kind: 'turn' });
    expect(a.game.passed).toEqual([false, false, false, false]);
    const b = new Driver(scene({ rules: ['skip_on_k'], hands: ['SK HK S4', 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    b.play(0, 'SK HK');
    expect(b.events.at(-1)).toMatchObject({ type: 'skipped', seats: [1, 2] });
    expect(b.current()).toMatchObject({ seat: 3 });
  });

  it('パス済みの人と上がった人は数えない', () => {
    const d = new Driver(scene({ rules: ['skip_on_k'], hands: ['S4 S9', 'H3 H5', 'D6 D7', 'SK C4'], turn: 0 }));
    d.play(0, 'S4');
    d.pass(1);
    d.play(2, 'D6');
    d.play(3, 'SK');
    // 席0を飛ばし、パス済みの席1は数えずに、席2の手番
    expect(d.events.at(-1)).toMatchObject({ type: 'skipped', by: 3, seats: [0] });
    expect(d.current()).toMatchObject({ seat: 2 });

    const s = scene({ rules: ['skip_on_k'], hands: ['SK S4', '', 'D3 D4', 'C3 C4'], turn: 0 });
    s.game!.topOrder = [1];
    s.game!.placeReasons[1] = 'finish';
    const e = new Driver(s);
    e.play(0, 'SK');
    expect(e.events.at(-1)).toMatchObject({ type: 'skipped', seats: [2] });
    expect(e.current()).toMatchObject({ seat: 3 });
  });

  it('全員を飛ばしたら、場が流れて出した人が親（1人を2回飛ばさない）', () => {
    for (const k of ['SK HK DK', 'SK HK DK CK']) {
      const d = new Driver(scene({ rules: ['skip_on_k'], hands: [`${k} S4`, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
      const ev = d.play(0, k);
      expect(ev.map((e) => e.type)).toEqual(['play', 'skipped', 'fieldCleared']);
      expect(ev[1]).toMatchObject({ seats: [1, 2, 3] });
      expect(ev[2]).toMatchObject({ reason: 'allPassed', leader: 0 });
    }
  });

  it('K で上がったときも効果は起きる', () => {
    const d = new Driver(scene({ rules: ['skip_on_k'], hands: ['SK', 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    const ev = d.play(0, 'SK');
    expect(ev.map((e) => e.type)).toEqual(['play', 'placed', 'skipped']);
    expect(d.current()).toMatchObject({ seat: 2 });
  });

  it('9リバース中は逆回りで飛ばす', () => {
    const d = new Driver(scene({ rules: ['skip_on_k'], orderReversed: true, hands: ['SK S4', 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    d.play(0, 'SK');
    expect(d.events.at(-1)).toMatchObject({ type: 'skipped', seats: [3] });
    expect(d.current()).toMatchObject({ seat: 2 });
  });
});
