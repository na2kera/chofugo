// Q ボンバー（decisions §15.8、§19.2、§19.3、§19.4、design-4 §2.4、§2.5、§2.9、§6.6）。
import { describe, expect, it } from 'vitest';
import { applyAction, viewFor, type Action, type CallRank } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['call_discard_on_q'] as const;

describe('Q ボンバー', () => {
  it('宣言した数字の本物のカードを、出した本人を含む全員が捨てる（出した人から進行方向の順）。ジョーカーは残る', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S7 H7 SQ SK', 'D7 D9 X0', 'C7 CK', 'C3'], turn: 0 }));
    const ev = d.play(0, 'SQ');
    expect(ev[1]).toMatchObject({ type: 'choiceStart', rule: 'call_discard_on_q', max: 1, to: null });
    expect(viewFor(d.state, 0).mine).toEqual({ awaitId: d.current().id, kind: 'choice', rule: 'call_discard_on_q', max: 1, to: null });
    const out = d.choose(0, '', { ranks: [7] });
    expect(out[0]).toEqual(
      expect.objectContaining({
        type: 'callDiscard',
        seat: 0,
        ranks: [7],
        discards: [
          { seat: 0, cards: cs('S7 H7') },
          { seat: 1, cards: cs('D7') },
          { seat: 2, cards: cs('C7') },
        ],
      }),
    );
    expect(d.game.hands).toEqual([cs('SK'), cs('D9 X0'), cs('CK'), cs('C3')]);
    expect(d.game.discard).toEqual(cs('S7 H7 D7 C7'));
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('出した枚数まで別々の数字を宣言できる。ジョーカーの宣言では全員のジョーカーを捨てる。場の Q は対象外', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SQ HQ X0 S5', 'DQ X1 D9', 'C9 CK', 'CQ C3'], turn: 0 }));
    d.play(0, 'SQ HQ');
    expect(d.events.at(-1)).toMatchObject({ max: 2 });
    const out = d.choose(0, '', { ranks: [12, 'joker'] });
    expect(out[0]).toMatchObject({
      ranks: [12, 'joker'],
      discards: [
        { seat: 0, cards: cs('X0') },
        { seat: 1, cards: cs('DQ X1') },
        { seat: 3, cards: cs('CQ') },
      ],
    });
    expect(d.game.field[0]!.play.cards).toEqual(cs('SQ HQ'));
  });

  it('宣言の検査: 上限・重複・値・cards・target・形', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SQ HQ S5', 'D9', 'C9', 'C3'], turn: 0 }));
    d.play(0, 'SQ HQ');
    const w = d.current();
    const t = (a: Record<string, unknown>) => {
      const r = applyAction(d.state, { type: 'choose', seat: 0, awaitId: w.id, cards: [], ...a } as Action);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(t({ ranks: [3, 4, 5] })).toBe('invalidChoice');
    expect(t({ ranks: [3, 3] })).toBe('invalidChoice');
    expect(t({ ranks: [16] })).toBe('invalidChoice');
    expect(t({ ranks: ['7'] })).toBe('invalidChoice');
    expect(t({ ranks: [7], cards: cs('S5') })).toBe('invalidChoice');
    expect(t({ ranks: [7], target: 1 })).toBe('invalidChoice');
    expect(t({ ranks: 7 })).toBe('malformed');
    // eslint-disable-next-line no-sparse-arrays
    expect(t({ ranks: [, 7] })).toBe('malformed');
    expect(t({ ranks: [15, 'joker'] })).toBe('ok');
    expect(t({ ranks: [] })).toBe('ok');
    expect(t({})).toBe('ok');
    // 宣言しない
    expect(d.choose(0, '').map((e) => e.type)).toEqual(['choiceSkip']);
  });

  it('手札が0枚でも宣言でき、効果で0枚になった人は出した人から進行方向の順に上がる', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SQ', 'D7', 'C7 C8', 'C3 C4'], turn: 0 }));
    expect(d.play(0, 'SQ').map((e) => e.type)).toEqual(['play', 'choiceStart']);
    d.choose(0, '', { ranks: [7] });
    expect(d.events.filter((e) => e.type === 'placed')).toEqual([
      expect.objectContaining({ seat: 0, place: 1, reason: 'finish' }),
      expect.objectContaining({ seat: 1, place: 2, reason: 'finish' }),
    ]);
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
  });

  it('効果で全員が同時に0枚になったとき、最後に残った1人は last（順位は出した人から進行方向の順）', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SQ', 'D7', 'C7', 'H7'], turn: 0 }));
    d.play(0, 'SQ');
    d.choose(0, '', { ranks: [7] });
    const tail = d.events.slice(d.events.findIndex((e) => e.type === 'callDiscard') + 1);
    expect(tail.map((e) => e.type)).toEqual(['placed', 'placed', 'placed', 'placed', 'gameEnd']);
    expect(tail.slice(0, 4).map((e) => (e.type === 'placed' ? [e.seat, e.place, e.reason] : null))).toEqual([
      [0, 1, 'finish'],
      [1, 2, 'finish'],
      [2, 3, 'finish'],
      [3, 4, 'last'],
    ]);
    expect(d.state.phase).toBe('gameResult');
  });

  it('前の大富豪が同時に0枚になっていても、先にほかの人が1位になれば都落ちする', () => {
    const d = new Driver(scene({ rules: [...R, 'dethrone'], hands: ['SQ S5 S6', 'D7', 'C7', 'C3 C4'], turn: 0, prevRanks: [2, 3, 1, 4] }));
    d.play(0, 'SQ');
    d.choose(0, '', { ranks: [7] });
    const tail = d.events.slice(d.events.findIndex((e) => e.type === 'callDiscard') + 1);
    expect(tail.map((e) => e.type)).toEqual(['placed', 'dethrone', 'placed']);
    expect(tail[0]).toMatchObject({ seat: 1, place: 1, reason: 'finish' });
    expect(tail[2]).toMatchObject({ seat: 2, place: 4, reason: 'dethrone' });
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
  });

  it('最後のジョーカー入りの Q で反則になり、ほかの席も同時に0枚になる', () => {
    const d = new Driver(scene({ rules: [...R, 'forbidden_finish'], hands: ['SQ X0', 'D7', 'C7 C8', 'C3'], turn: 0 }));
    const ev = d.play(0, 'SQ X0', { confirmFoul: true });
    expect(ev[0]).toMatchObject({ type: 'play', foul: true });
    expect(ev[1]).toMatchObject({ type: 'choiceStart', max: 2 });
    d.choose(0, '', { ranks: [7] });
    expect(d.events.filter((e) => e.type === 'placed')).toEqual([
      expect.objectContaining({ seat: 0, place: 4, reason: 'foul' }),
      expect.objectContaining({ seat: 1, place: 1, reason: 'finish' }),
    ]);
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
  });

  it('効果で出した本人が上がる手に、特権のスキップを付けた', () => {
    const d = new Driver(
      scene({ rules: [...R, 'dethrone'], hands: ['SQ S7 H7', 'D9 D10', 'C9 C10', 'H9 H10'], turn: 0, abilities: { holder: 0, chosen: ['skip'] } }),
    );
    d.play(0, 'SQ', { withSkip: true });
    d.choose(0, '', { ranks: [7] });
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, place: 1, reason: 'finish' });
    expect(d.events.find((e) => e.type === 'skipped')).toMatchObject({ by: 0, seats: [1] });
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
  });

  it('連覇の特権枠は、効果をすべて処理し終えたあとの枚数で決める（閾値をまたぐ）', () => {
    // 相手3人の合計は効果の前に15枚（2個）、7を捨てたあとに14枚（1個）
    const s = scene({
      rules: [...R, 'dethrone'],
      hands: ['SQ', 'D7 D3 D4 D5 D6', 'C8 C3 C4 C5 C6', 'H8 H3 H4 H5 H6'],
      turn: 0,
      prevRanks: [1, 2, 3, 4],
      abilitiesConfig: true,
    });
    const d = new Driver(s);
    d.play(0, 'SQ');
    d.choose(0, '', { ranks: [7] });
    expect(d.game.firstPlaceHandCounts).toEqual([0, 4, 5, 5]);
    for (let i = 0; i < 200 && d.state.phase === 'play'; i++) d.auto('cpu');
    expect(d.state.phase).toBe('gameResult');
    expect(d.state.abilityGrant).toEqual({ seat: 0, slots: 1 });
  });

  it('CPU はいちばん枚数の多い数字を1つ宣言する（同じ枚数ならその時点の向きで弱い数字、ジョーカーは数えない）。時間切れは宣言しない', () => {
    const mk = (hand: string, rev = false) => {
      const d = new Driver(scene({ rules: [...R], hands: [hand, 'D9', 'C9', 'C3'], turn: 0, revolution: rev }));
      d.play(0, rev ? 'SQ' : 'SQ');
      return d;
    };
    const cpuRanks = (d: Driver): CallRank[] | null => {
      const ev = d.auto('cpu')[0];
      return ev?.type === 'callDiscard' ? ev.ranks : null;
    };
    expect(cpuRanks(mk('SQ HQ DQ S7 H7 SK H9 D9 C9'))).toEqual([9]);
    expect(cpuRanks(mk('SQ S7 H7 SK HK'))).toEqual([7]);
    expect(cpuRanks(mk('SQ S7 H7 SK HK', true))).toEqual([13]);
    expect(cpuRanks(mk('SQ X0 X1'))).toBeNull();
    expect(mk('SQ S7').auto('timeout').map((e) => e.type)).toEqual(['choiceSkip']);
  });

  it('ジョーカーを混ぜた Q でも発動し、ジョーカーだけの手・階段では発動しない', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['SQ X0 S5', 'D9', 'C9', 'C3'], turn: 0 }));
    expect(a.play(0, 'SQ X0').map((e) => e.type)).toEqual(['play', 'choiceStart']);
    const b = new Driver(scene({ rules: [...R, 'runs'], hands: ['SJ SQ SK S5', 'D9', 'C9', 'C3'], turn: 0 }));
    expect(b.play(0, 'SJ SQ SK').map((e) => e.type)).toEqual(['play']);
  });
});
