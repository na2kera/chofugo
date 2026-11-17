// 闇市（decisions §15.7、§19.3、design-4 §2.4、§2.5、§2.7、§2.9、§6.6）。
import { describe, expect, it } from 'vitest';
import { applyAction, eventsFor, viewFor, type Action, type SeatId } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['triple_a_trade'] as const;
const SEATS: SeatId[] = [0, 1, 2, 3];

describe('闇市', () => {
  it('相手を選び、自分の2枚と相手のいちばん強い2枚を交換する。中身は当事者の2人だけに見える', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SA HA DA S3 S4 S5', 'H2 X0 H6', 'D7 D8', 'C9'], turn: 0 }));
    const ev = d.play(0, 'SA HA DA');
    expect(ev[1]).toMatchObject({ type: 'choiceStart', rule: 'triple_a_trade', max: 2, to: null });
    expect(viewFor(d.state, 0).mine).toEqual({ awaitId: d.current().id, kind: 'choice', rule: 'triple_a_trade', max: 2, to: null, targets: [1, 2, 3] });
    const out = d.choose(0, 'S4 S3', { target: 1 });
    expect(out[0]).toEqual(expect.objectContaining({ type: 'trade', from: 0, to: 1, given: cs('S3 S4'), taken: cs('H2 X0') }));
    expect(d.game.hands[0]).toEqual(cs('S5 H2 X0'));
    expect(d.game.hands[1]).toEqual(cs('S3 S4 H6'));
    // 4席それぞれの eventsFor と viewFor
    for (const v of SEATS) {
      const e = eventsFor(out, v)[0];
      const party = v === 0 || v === 1;
      expect(e).toEqual(
        expect.objectContaining({ type: 'trade', from: 0, to: 1, count: 2, given: party ? cs('S3 S4') : null, taken: party ? cs('H2 X0') : null }),
      );
      const text = JSON.stringify({ view: viewFor(d.state, v), ev: eventsFor(d.events, v) });
      if (!party) for (const id of cs('S3 S4 H2 X0')) expect(text).not.toContain(`"${id}"`);
      expect(viewFor(d.state, v).game?.handCounts).toEqual([3, 3, 2, 1]);
    }
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('自分か相手の手札が2枚未満なら、少ないほうの枚数ちょうどで交換する', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SA HA DA S3 S4', 'H2 X0 H6', 'D7 D8', 'C9'], turn: 0 }));
    d.play(0, 'SA HA DA');
    const w = d.current();
    const two = d.try({ type: 'choose', seat: 0, awaitId: w.id, cards: cs('S3 S4'), target: 3 });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error.code).toBe('invalidChoice');
    const ev = d.choose(0, 'S4', { target: 3 });
    expect(ev[0]).toEqual(expect.objectContaining({ type: 'trade', given: cs('S4'), taken: cs('C9') }));
    // 自分の手札が1枚: 上限1
    const e = new Driver(scene({ rules: [...R], hands: ['SA HA DA S3', 'H2 X0 H6', 'D7 D8', 'C9'], turn: 0 }));
    e.play(0, 'SA HA DA');
    expect(e.events.at(-1)).toMatchObject({ type: 'choiceStart', max: 1 });
  });

  it('使わないこともできる（相手を選んでいても）。最後の3枚で出したら選択をはさまない', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SA HA DA S3 S4', 'H2 X0 H6', 'D7 D8', 'C9'], turn: 0 }));
    d.play(0, 'SA HA DA');
    expect(d.choose(0, '', { target: 2 }).map((e) => e.type)).toEqual(['choiceSkip']);
    const b = new Driver(scene({ rules: [...R], hands: ['SA HA DA', 'H2', 'D7', 'C9'], turn: 0 }));
    expect(b.play(0, 'SA HA DA').map((e) => e.type)).toEqual(['play', 'placed']);
  });

  it('相手は、自分以外の残っている席（パス済みを含む）。正しくない相手・形は拒否する', () => {
    const s = scene({ rules: [...R], hands: ['S3 C3 D3 SA HA DA S5 S6', 'H2 X0', '', 'S4 H4 D4 C9'], turn: 0 });
    s.game!.topOrder = [2];
    s.game!.placeReasons[2] = 'finish';
    const d = new Driver(s);
    d.play(0, 'S3 C3 D3');
    d.pass(1);
    d.play(3, 'S4 H4 D4');
    d.play(0, 'SA HA DA');
    expect(d.game.passed[1]).toBe(true);
    const m = viewFor(d.state, 0).mine;
    expect(m).toMatchObject({ kind: 'choice', targets: [1, 3] });
    const w = d.current();
    const bad = (a: Partial<Action> & Record<string, unknown>) => applyAction(d.state, { type: 'choose', seat: 0, awaitId: w.id, cards: cs('S5 S6'), ...a } as Action);
    const codes = [
      bad({ target: 0 }),
      bad({ target: 2 }),
      bad({}),
      bad({ target: 1, ranks: [3] }),
      bad({ target: 7 as SeatId }),
      bad({ target: 1, cards: cs('S5 S5') }),
      bad({ target: 1, cards: cs('H6 S5') }),
    ].map((r) => (r.ok ? 'ok' : r.error.code));
    expect(codes).toEqual(['invalidChoice', 'invalidChoice', 'invalidChoice', 'invalidChoice', 'malformed', 'invalidChoice', 'cardNotInHand']);
    // パス済みの席1と交換できる
    expect(d.choose(0, 'S5 S6', { target: 1 })[0]).toMatchObject({ type: 'trade', to: 1, taken: cs('H2 X0') });
  });

  it('相手の「いちばん強いカード」は、その時点の向きで決める（J バック中は3が強い）', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SA HA DA S5 S6', 'H3 H2 HK', 'D7 D8', 'C9'], turn: 0, tempReverse: true }));
    d.play(0, 'SA HA DA');
    expect(d.choose(0, 'S5 S6', { target: 1 })[0]).toMatchObject({ taken: cs('H3 HK') });
  });

  it('ジョーカー入りの3枚・4枚の A は役にならない', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['SA HA X0 S3', 'H2', 'D7', 'C9'], turn: 0 }));
    expect(a.play(0, 'SA HA X0').map((e) => e.type)).toEqual(['play']);
    const b = new Driver(scene({ rules: [...R], hands: ['SA HA DA CA S3', 'H2', 'D7', 'C9'], turn: 0 }));
    expect(b.play(0, 'SA HA DA CA').map((e) => e.type)).toEqual(['play']);
  });

  it('CPU は乱数で相手を選び、いちばん弱いカードをちょうどの枚数渡す。時間切れは使わない', () => {
    const base = () => scene({ rules: [...R], hands: ['SA HA DA S3 S9 X0', 'H2 X1 H6', 'D7 D8', 'C9'], turn: 0 });
    const a = new Driver(base());
    a.play(0, 'SA HA DA');
    const ev = a.auto('cpu');
    const t = ev[0];
    if (t?.type !== 'trade') throw new Error();
    expect(t.given).toEqual(t.to === 3 ? cs('S3') : cs('S3 S9'));
    const b = new Driver(base());
    b.play(0, 'SA HA DA');
    expect(b.auto('timeout').map((e) => e.type)).toEqual(['choiceSkip']);
  });
});
