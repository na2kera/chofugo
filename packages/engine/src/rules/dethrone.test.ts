import { describe, expect, it } from 'vitest';
import { viewFor } from '../index.ts';
import { Driver, scene } from '../test/helpers.ts';

describe('都落ち（decisions §4.1、§4.2、§14.2）', () => {
  it('前の大富豪以外が1位になった瞬間、前の大富豪は最下位になり、手札は捨て札として全員に公開される', () => {
    const d = new Driver(
      scene({ rules: ['dethrone'], prevRanks: [2, 1, 3, 4], hands: ['S5', 'H4 H9 HK', 'D4 D6', 'C4 C7'], turn: 0 }),
    );
    d.play(0, 'S5');
    expect(d.events.find((e) => e.type === 'dethrone')).toMatchObject({ seat: 1, discarded: ['heart-4', 'heart-9', 'heart-13'] });
    expect(d.places()).toEqual([1, 4, null, null]);
    expect(viewFor(d.state, 2).game?.discard).toEqual(expect.arrayContaining(['heart-4', 'heart-9', 'heart-13']));
    expect(d.game.hands[1]).toEqual([]);
    // 抜けた人の手番は来ない
    expect(d.current().seat).toBe(2);
  });

  it('前の大富豪が1位なら都落ちしない', () => {
    const d = new Driver(scene({ rules: ['dethrone'], prevRanks: [1, 2, 3, 4], hands: ['S5', 'H4 H9', 'D4 D6', 'C4 C7'], turn: 0 }));
    d.play(0, 'S5');
    expect(d.types()).not.toContain('dethrone');
  });

  it('OFF なら都落ちしない', () => {
    const d = new Driver(scene({ rules: [], prevRanks: [2, 1, 3, 4], hands: ['S5', 'H4 H9', 'D4 D6', 'C4 C7'], turn: 0 }));
    d.play(0, 'S5');
    expect(d.types()).not.toContain('dethrone');
    expect(d.places()).toEqual([1, null, null, null]);
  });

  it('先に反則で4位が出ていれば、都落ちした人は3位（§4.2、§14.2）', () => {
    const d = new Driver(
      scene({
        rules: ['dethrone', 'forbidden_finish'],
        prevRanks: [2, 1, 3, 4],
        hands: ['X0', 'H4 H9 HK', 'D5 D6', 'C4 C7'],
        turn: 0,
      }),
    );
    d.play(0, 'X0', { confirmFoul: true }); // 0 が反則で4位
    // 1→2→3 の順。2 が D5 を出して… 先に 2 を上がらせる
    d.play(1, 'H4');
    d.play(2, 'D5');
    d.play(3, 'C7');
    d.pass(1);
    d.pass(2);
    // 3 が親
    d.play(3, 'C4'); // 3 が上がって1位
    expect(d.events.filter((e) => e.type === 'placed').map((e) => e.type === 'placed' && e.reason)).toEqual([
      'foul',
      'finish',
      'dethrone',
      'last',
    ]);
    expect(d.state.phase).toBe('gameResult');
    expect(d.places()).toEqual([4, 3, 2, 1]);
  });

  it('すでに順位が確定している前の大富豪は対象にならない', () => {
    const d = new Driver(
      scene({ rules: ['dethrone', 'forbidden_finish'], prevRanks: [1, 2, 3, 4], hands: ['X0', 'H4 H9', 'D5', 'C4 C7'], turn: 0 }),
    );
    d.play(0, 'X0', { confirmFoul: true }); // 前の大富豪 0 が反則で4位
    d.play(1, 'H4');
    d.play(2, 'D5'); // 2 が1位
    expect(d.types()).not.toContain('dethrone');
    expect(d.places()).toEqual([4, null, 1, null]);
  });
});
