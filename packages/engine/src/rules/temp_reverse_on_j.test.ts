import { describe, expect, it } from 'vitest';
import { Driver, scene } from '../test/helpers.ts';

describe('J バック（decisions §6.4）', () => {
  it('J を出すとその場が流れるまで逆になる', () => {
    const d = new Driver(scene({ rules: ['temp_reverse_on_j'], hands: ['SJ S4 S5', 'H10 HQ H6', 'D9 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'SJ');
    expect(d.game.tempReverse).toBe(true);
    // Q は出せない、10 は出せる
    const w = d.current();
    const bad = d.try({ type: 'play', seat: 1, awaitId: w.id, cards: ['heart-12'] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.violation).toBe('notStronger');
    d.play(1, 'H10');
    d.play(2, 'D9');
    d.pass(3);
    d.pass(0);
    d.pass(1);
    expect(d.game.field).toEqual([]);
    expect(d.game.tempReverse).toBe(false);
  });

  it('J バック中にもう一度 J が出ても変わらない', () => {
    const d = new Driver(scene({ rules: ['temp_reverse_on_j'], hands: ['SJ S4', 'H10 HJ', 'D9 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'SJ');
    // 逆なので J の上に J は出せない（同じ強さ）。10 は出せる
    d.play(1, 'H10');
    expect(d.events.filter((e) => e.type === 'tempReverse')).toHaveLength(1);
  });

  it('革命中の J バックは通常の向きになる', () => {
    const d = new Driver(scene({ rules: ['temp_reverse_on_j'], revolution: true, hands: ['SJ S4', 'HQ H10', 'D9 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'SJ');
    expect(d.state.game?.revolution).toBe(true);
    expect(d.game.tempReverse).toBe(true);
    // 両方なので通常: Q が出せる
    d.play(1, 'HQ');
    expect(d.game.field).toHaveLength(2);
  });
});
