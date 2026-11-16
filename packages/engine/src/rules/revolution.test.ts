import { describe, expect, it } from 'vitest';
import { applyAction } from '../index.ts';
import { Driver, scene } from '../test/helpers.ts';

describe('革命（decisions §6.3）', () => {
  it('4枚組で強さが逆になり、場が流れても続く', () => {
    const d = new Driver(scene({ rules: ['revolution'], hands: ['S9 H9 D9 C9 S4', 'S3 H5', 'D4 D10', 'C3 CK'], turn: 0 }));
    d.play(0, 'S9 H9 D9 C9');
    expect(d.game.revolution).toBe(true);
    expect(d.events.find((e) => e.type === 'revolution')).toMatchObject({ active: true });
    d.pass(1);
    d.pass(2);
    d.pass(3);
    expect(d.game.field).toEqual([]);
    expect(d.game.revolution).toBe(true);
    // 逆なので 4 の上に 3 が出せる
    d.play(0, 'S4');
    d.play(1, 'S3');
    expect(d.game.field).toHaveLength(2);
  });

  it('ジョーカーを含む4枚組、4枚以上の階段でも起きる。3枚組では起きない', () => {
    const a = new Driver(scene({ rules: ['revolution'], hands: ['S9 H9 D9 X0 S4', 'S3', 'D4', 'C3'], turn: 0 }));
    a.play(0, 'S9 H9 D9 X0');
    expect(a.game.revolution).toBe(true);
    const b = new Driver(scene({ rules: ['revolution', 'runs'], hands: ['S5 S6 S7 S8 H4', 'S3', 'D4', 'C3'], turn: 0 }));
    b.play(0, 'S5 S6 S7 S8');
    expect(b.game.revolution).toBe(true);
    const c = new Driver(scene({ rules: ['revolution'], hands: ['S9 H9 D9 S4', 'S3', 'D4', 'C3'], turn: 0 }));
    c.play(0, 'S9 H9 D9');
    expect(c.game.revolution).toBe(false);
  });

  it('革命中にもう一度革命が起きると元に戻る', () => {
    const d = new Driver(scene({ rules: ['revolution'], hands: ['S9 H9 D9 C9 S4', 'S5 H5 D5 C5 H6', 'D4 D10', 'C3 CK'], turn: 0, }));
    d.play(0, 'S9 H9 D9 C9');
    d.play(1, 'S5 H5 D5 C5');
    expect(d.game.revolution).toBe(false);
  });

  it('OFF なら4枚組でも何も起きない', () => {
    const d = new Driver(scene({ rules: [], hands: ['S9 H9 D9 C9 S4', 'S3', 'D4', 'C3'], turn: 0 }));
    d.play(0, 'S9 H9 D9 C9');
    expect(d.game.revolution).toBe(false);
  });

  it('次のゲームには持ち越さない', () => {
    const d = new Driver(scene({ rules: ['revolution'], hands: ['S9 H9 D9 C9', 'S3', 'D4', 'C3'], turn: 0 }));
    d.play(0, 'S9 H9 D9 C9'); // 上がり
    expect(d.game.revolution).toBe(true);
    d.pass(1);
    d.pass(2);
    d.pass(3);
    // 親は1。3 枚ずつ出して終わらせる
    d.play(1, 'S3');
    d.pass(2);
    d.pass(3);
    d.play(2, 'D4');
    expect(d.state.phase).toBe('gameResult');
    const r = applyAction(d.state, { type: 'nextGame' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.game?.revolution).toBe(false);
  });
});
