import { describe, expect, it } from 'vitest';
import { viewFor } from '../index.ts';
import { Driver, scene } from '../test/helpers.ts';

describe('9リバース（decisions §6.14、§14.8）', () => {
  it('9を出した直後から逆回り。場が流れると元に戻る', () => {
    const d = new Driver(scene({ rules: ['reverse_order_on_9'], hands: ['S9 S4', 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    const ev = d.play(0, 'S9');
    expect(ev.map((e) => e.type)).toEqual(['play', 'orderReverse']);
    expect(ev[1]).toMatchObject({ active: true });
    expect(d.game.direction).toBe(-1);
    expect(viewFor(d.state, 1).game).toMatchObject({ orderReversed: true, direction: -1 });
    expect(d.current()).toMatchObject({ seat: 3 });
    d.pass(3);
    d.pass(2);
    d.pass(1);
    expect(d.events.slice(-2)).toEqual([
      expect.objectContaining({ type: 'orderReverse', active: false }),
      expect.objectContaining({ type: 'fieldCleared', reason: 'allPassed', leader: 0 }),
    ]);
    expect(d.game.orderReversed).toBe(false);
    d.play(0, 'S4');
    expect(d.current()).toMatchObject({ seat: 1 });
  });

  it('流れたあとの親は、解除後の（元の）向きで探す', () => {
    const d = new Driver(scene({ rules: ['reverse_order_on_9'], hands: ['S9', 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    d.play(0, 'S9'); // 上がる
    expect(d.current()).toMatchObject({ seat: 3 });
    d.pass(3);
    d.pass(2);
    d.pass(1);
    // 出した人（席0）はもういないので、元の向きで次の席1が親（逆回りのままなら席3）
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', leader: 1 });
  });

  it('逆回り中にもう一度9が出ても何も変わらない', () => {
    const d = new Driver(
      scene({ rules: ['reverse_order_on_9', 'temp_reverse_on_j'], hands: ['S9 S4', 'H9 H4', 'D10 D4', 'HJ C4'], turn: 0 }),
    );
    d.play(0, 'S9');
    d.play(3, 'HJ'); // J バックで強さが逆に
    d.play(2, 'D10');
    const ev = d.play(1, 'H9');
    expect(ev.map((e) => e.type)).toEqual(['play']);
    expect(d.game.orderReversed).toBe(true);
    expect(d.current()).toMatchObject({ seat: 0 });
  });
});
