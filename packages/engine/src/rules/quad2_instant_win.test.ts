// 大革命（decisions §15.9、§19.1、§19.3、§19.5、design-4 §2.4、§2.9、§6.2、§6.6）。
import { describe, expect, it } from 'vitest';
import { legalPlays } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['quad2_instant_win'] as const;
const QUAD = 'S2 H2 D2 C2';

describe('大革命', () => {
  it('手札が残っていてもその場で上がる。残りの手札は捨て札。革命が起き、場は流れて進行方向で次の人が親', () => {
    const d = new Driver(scene({ rules: [...R], hands: [`${QUAD} S5 S6`, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    const ev = d.play(0, QUAD);
    expect(ev.map((e) => e.type)).toEqual(['play', 'revolution', 'instantWin', 'placed', 'fieldCleared']);
    expect(ev[1]).toEqual(expect.objectContaining({ active: true }));
    expect(ev[2]).toEqual(expect.objectContaining({ seat: 0, discarded: cs('S5 S6') }));
    expect(ev[3]).toEqual(expect.objectContaining({ seat: 0, place: 1, reason: 'finish' }));
    expect(ev[4]).toEqual(expect.objectContaining({ reason: 'quad2_instant_win', leader: 1 }));
    expect(d.game.revolution).toBe(true);
    expect(d.game.discard).toEqual([...cs('S5 S6'), ...cs(QUAD)]);
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('「革命」が ON でも OFF でも、革命の切り替えは1回', () => {
    const d = new Driver(scene({ rules: [...R, 'revolution'], hands: [`${QUAD} S5`, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    expect(d.play(0, QUAD).filter((e) => e.type === 'revolution')).toHaveLength(1);
    expect(d.game.revolution).toBe(true);
  });

  it('禁止上がりにならない（大革命が ON のとき、本物の2の4枚に限る）', () => {
    const d = new Driver(scene({ rules: [...R, 'forbidden_finish'], hands: [QUAD, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    expect(legalPlays(d.state, 0).find((p) => p.cards.length === 4)).toMatchObject({ foul: false });
    d.play(0, QUAD);
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, reason: 'finish' });
    const off = new Driver(scene({ rules: ['forbidden_finish'], hands: [QUAD, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    expect(legalPlays(off.state, 0).find((p) => p.cards.length === 4)).toMatchObject({ foul: true });
  });

  it('前の大富豪以外が大革命で1位になれば都落ちする', () => {
    const d = new Driver(scene({ rules: [...R, 'dethrone'], hands: [`${QUAD} S5`, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0, prevRanks: [2, 3, 1, 4] }));
    const ev = d.play(0, QUAD);
    expect(ev.map((e) => e.type)).toEqual(['play', 'revolution', 'instantWin', 'placed', 'dethrone', 'placed', 'fieldCleared']);
    expect(ev[5]).toMatchObject({ seat: 2, place: 4, reason: 'dethrone' });
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('大富豪が連覇の1位を大革命で取ったときも、相手3人の残り手札の合計で枠を決める', () => {
    const d = new Driver(
      scene({ rules: [...R, 'dethrone'], hands: [`${QUAD} S5`, 'H3 H4 H5 H6 H7', 'D3 D4 D5 D6 D7', 'C3 C4 C5 C6 C7'], turn: 0, prevRanks: [1, 2, 3, 4], abilitiesConfig: true }),
    );
    d.play(0, QUAD);
    expect(d.game.firstPlaceHandCounts).toEqual([0, 5, 5, 5]);
    for (let i = 0; i < 300 && d.state.phase === 'play'; i++) d.auto('cpu');
    expect(d.state.abilityGrant).toEqual({ seat: 0, slots: 2 });
  });

  it('特権のスキップは付けられない', () => {
    const d = new Driver(scene({ rules: [...R], hands: [`${QUAD} S5`, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0, abilities: { holder: 0, chosen: ['skip'] } }));
    expect(legalPlays(d.state, 0).find((p) => p.cards.length === 4)?.canSkip).toBeUndefined();
    const r = d.try({ type: 'play', seat: 0, awaitId: d.current().id, cards: cs(QUAD), withSkip: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cannotSkip');
  });

  it('ジョーカー入りの4枚はふつうの革命（上がらない）', () => {
    const d = new Driver(scene({ rules: [...R, 'revolution'], hands: ['S2 H2 D2 X0 S5', 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0 }));
    expect(d.play(0, 'S2 H2 D2 X0').map((e) => e.type)).toEqual(['play', 'revolution']);
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('残り2人で大革命を出すとゲームが終わる。場は流さない', () => {
    const s = scene({ rules: [...R], hands: [`${QUAD} S5`, '', 'D3 D4', ''], turn: 0 });
    s.game!.topOrder = [1, 3];
    s.game!.placeReasons[1] = 'finish';
    s.game!.placeReasons[3] = 'finish';
    const d = new Driver(s);
    const ev = d.play(0, QUAD);
    expect(ev.map((e) => e.type)).toEqual(['play', 'revolution', 'instantWin', 'placed', 'placed', 'gameEnd']);
    expect(ev[3]).toMatchObject({ seat: 0, place: 3, reason: 'finish' });
    expect(ev[4]).toMatchObject({ seat: 2, place: 4, reason: 'last' });
    expect(d.state.phase).toBe('gameResult');
    expect(d.game.field).toHaveLength(1);
    // 終了後に内部の待ち・保留が残っていない（awaiting(s) は結果のフェーズでいつも空なので直接見る）
    expect(d.game.awaiting).toHaveLength(0);
    expect(d.game.pending).toBeNull();
  });

  it('大革命の1位で都落ちが起き、残り1人が last になってゲームが終わる', () => {
    // 席3は反則で4位に確定済み。席0（前の大富豪ではない）が大革命で1位 → 前の大富豪の席2が都落ちで3位 → 席1が last で2位
    const s = scene({ rules: [...R, 'dethrone'], hands: [`${QUAD} S5`, 'H3 H4', 'D3 D4', ''], turn: 0, prevRanks: [2, 3, 1, 4] });
    s.game!.bottomOrder = [3];
    s.game!.placeReasons[3] = 'foul';
    const d = new Driver(s);
    const ev = d.play(0, QUAD);
    expect(ev.map((e) => e.type)).toEqual(['play', 'revolution', 'instantWin', 'placed', 'dethrone', 'placed', 'placed', 'gameEnd']);
    expect(ev[3]).toMatchObject({ seat: 0, place: 1, reason: 'finish' });
    expect(ev[5]).toMatchObject({ seat: 2, place: 3, reason: 'dethrone' });
    expect(ev[6]).toMatchObject({ seat: 1, place: 2, reason: 'last' });
    expect(d.state.phase).toBe('gameResult');
    expect(d.game.awaiting).toHaveLength(0);
    expect(d.game.pending).toBeNull();
  });

  it('逆回り中の大革命のあとの親は、場の効果を解除したあとの向きで次の人', () => {
    const d = new Driver(
      scene({ rules: [...R, 'reverse_order_on_9'], hands: [`${QUAD} S5`, 'H3 H4', 'D3 D4', 'C3 C4'], turn: 0, orderReversed: true }),
    );
    const ev = d.play(0, QUAD);
    expect(ev.find((e) => e.type === 'orderReverse')).toMatchObject({ active: false });
    expect(ev.at(-1)).toMatchObject({ type: 'fieldCleared', leader: 1 });
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });
});
