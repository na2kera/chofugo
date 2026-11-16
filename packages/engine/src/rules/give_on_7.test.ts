// 7渡し・10捨て（decisions §6.13、§16.4、design-2 §2.2、§6.5）。
import { describe, expect, it } from 'vitest';
import { applyAction, eventsFor, viewFor, type Action } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['give_on_7', 'discard_on_10'] as const;

describe('7渡し', () => {
  it('0枚: 渡さないこともできる。選ぶ人だけが待たれ、ほかの人には誰が選んでいるかが見える', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S7 H5 H6', 'S9', 'D9', 'C9'], turn: 0 }));
    const ev = d.play(0, 'S7');
    expect(ev.map((e) => e.type)).toEqual(['play', 'choiceStart']);
    expect(ev[1]).toMatchObject({ rule: 'give_on_7', seat: 0, max: 1, to: 1 });
    expect(d.current()).toMatchObject({ seat: 0, kind: 'choice', timer: 'choice' });
    expect(viewFor(d.state, 0).mine).toEqual({ awaitId: d.current().id, kind: 'choice', rule: 'give_on_7', max: 1, to: 1 });
    expect(viewFor(d.state, 2).game?.choice).toEqual({ rule: 'give_on_7', seat: 0, to: 1 });
    expect(viewFor(d.state, 2).game?.returnRound).toBeNull();
    d.choose(0, '');
    expect(d.events.at(-1)).toMatchObject({ type: 'choiceSkip', seat: 0, rule: 'give_on_7' });
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
    expect(d.game.hands[0]).toEqual(cs('H5 H6'));
  });

  it('上限まで渡せる。受け取った人の手札は並べ直す。中身は当事者だけに見える', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S7 H7 H5 H6 CA', 'S9 C3', 'D9', 'C9'], turn: 0 }));
    d.play(0, 'S7 H7');
    const w = d.current();
    const over = d.try({ type: 'choose', seat: 0, awaitId: w.id, cards: cs('H5 H6 CA') });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('invalidChoice');
    const ev = d.choose(0, 'CA H5');
    expect(ev[0]).toEqual(expect.objectContaining({ type: 'give', from: 0, to: 1, cards: cs('H5 CA') }));
    expect(d.game.hands[1]).toEqual(cs('C3 H5 S9 CA'));
    expect(d.game.hands[0]).toEqual(cs('H6'));
    for (const seat of [0, 1] as const) expect(eventsFor(ev, seat)[0]).toMatchObject({ count: 2, cards: cs('H5 CA') });
    for (const seat of [2, 3] as const) expect(eventsFor(ev, seat)[0]).toMatchObject({ type: 'give', from: 0, to: 1, count: 2, cards: null });
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('手札が上限より少ない: 残りをすべて渡して上がる。ジョーカーを混ぜた7の組でも反則にならない', () => {
    const d = new Driver(scene({ rules: [...R, 'forbidden_finish'], hands: ['S7 X0 H5', 'S9 C3', 'D9', 'C9'], turn: 0 }));
    const ev = d.play(0, 'S7 X0');
    expect(ev[0]).toMatchObject({ type: 'play', foul: false, play: { rank: 7 } });
    expect(ev[1]).toMatchObject({ type: 'choiceStart', max: 2 });
    d.choose(0, 'H5');
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, place: 1, reason: 'finish' });
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('7を出して手札が0枚なら、選択をはさまずに上がる', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S7', 'S9 C3', 'D9', 'C9'], turn: 0 }));
    d.play(0, 'S7');
    expect(d.types()).toEqual(['play', 'placed']);
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('4枚の7: 革命が先、そのあと7渡し（上限4）', () => {
    const d = new Driver(scene({ rules: [...R, 'revolution'], hands: ['S7 H7 D7 C7 H5', 'S9 C3', 'D9', 'C9'], turn: 0 }));
    d.play(0, 'S7 H7 D7 C7');
    expect(d.types()).toEqual(['play', 'revolution', 'choiceStart']);
    expect(d.events.at(-1)).toMatchObject({ max: 4 });
  });

  it('渡す相手は、進行方向で次の、まだ上がっていない人（パス済みでもよい）', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S4 S7 H5', 'S3 C3', 'D3 D10', 'S5 C9'], turn: 0 }));
    d.play(0, 'S4');
    d.pass(1);
    d.pass(2);
    d.play(3, 'S5');
    d.play(0, 'S7');
    expect(d.game.passed[1]).toBe(true);
    expect(d.events.at(-1)).toMatchObject({ type: 'choiceStart', to: 1 });
  });

  it('まだ上がっていない人を探す', () => {
    const s = scene({ rules: [...R], hands: ['S7 H5', '', 'D3 D10', 'S5 C9'], turn: 0 });
    s.game!.topOrder = [1];
    s.game!.placeReasons[1] = 'finish';
    const d = new Driver(s);
    d.play(0, 'S7');
    expect(d.events.at(-1)).toMatchObject({ type: 'choiceStart', to: 2 });
  });

  it('9リバース中は逆回りの次の人に渡す', () => {
    const d = new Driver(
      scene({ rules: [...R, 'reverse_order_on_9', 'temp_reverse_on_j'], tempReverse: true, hands: ['S9 H5', 'S3', 'D3', 'H7 C9'], turn: 0 }),
    );
    d.play(0, 'S9');
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
    d.play(3, 'H7');
    expect(d.events.at(-1)).toMatchObject({ type: 'choiceStart', seat: 3, to: 2 });
    d.choose(3, 'C9');
    expect(d.game.hands[2]).toEqual(cs('D3 C9'));
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
  });

  it('CPU はいちばん弱いカードから上限まで渡す（ジョーカーは最後）。時間切れは渡さない', () => {
    const base = () => scene({ rules: [...R], hands: ['S7 H7 X0 S5 HA', 'S9', 'D9', 'C9'], turn: 0 });
    const a = new Driver(base());
    a.play(0, 'S7 H7');
    a.apply({ type: 'auto', awaitId: a.current().id, policy: 'cpu' });
    expect(a.events.at(-1)).toMatchObject({ type: 'give', cards: cs('S5 HA') });
    const b = new Driver(scene({ rules: [...R], hands: ['S7 H7 X0 S4 S9 SA', 'H9', 'D9', 'C9'], turn: 0, revolution: true }));
    b.play(0, 'S7 H7');
    b.apply({ type: 'auto', awaitId: b.current().id, policy: 'cpu' });
    // 逆の向きでは A と 9 が弱い（4 がいちばん強い）
    expect(b.events.at(-1)).toMatchObject({ type: 'give', cards: cs('S9 SA') });
    const c = new Driver(base());
    c.play(0, 'S7 H7');
    c.apply({ type: 'auto', awaitId: c.current().id, policy: 'timeout' });
    expect(c.events.at(-1)).toMatchObject({ type: 'choiceSkip' });
  });
});

describe('10捨て', () => {
  it('出した枚数まで捨てられ、捨てたカードは全員に見える', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S10 H10 H5 H6 CA', 'S9', 'D9', 'C9'], turn: 0 }));
    d.play(0, 'S10 H10');
    expect(d.events.at(-1)).toMatchObject({ type: 'choiceStart', rule: 'discard_on_10', max: 2, to: null });
    const ev = d.choose(0, 'H5 H6');
    expect(ev[0]).toEqual(expect.objectContaining({ type: 'discard', seat: 0, rule: 'discard_on_10', cards: cs('H5 H6') }));
    for (const seat of [1, 2, 3] as const) expect(eventsFor(ev, seat)[0]).toMatchObject({ cards: cs('H5 H6') });
    expect(d.game.discard).toEqual(cs('H5 H6'));
    expect(d.game.field).toHaveLength(1);
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('捨てて上がる', () => {
    const d = new Driver(scene({ rules: [...R, 'forbidden_finish'], hands: ['S10 S2', 'S9', 'D9', 'C9'], turn: 0 }));
    d.play(0, 'S10');
    d.choose(0, 'S2');
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, reason: 'finish' });
  });
});

describe('choose の拒否（design-2 §6.5）', () => {
  it('古い待ち番号・他人の席・重複・上限超え・手札にないカード・違う待ちの種類は拒否し、状態を変えない', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S7 H7 H5 H6', 'S9 C3', 'D9', 'C9'], turn: 0 }));
    const turnId = d.current().id;
    expect(d.try({ type: 'choose', seat: 0, awaitId: turnId, cards: [] })).toMatchObject({ ok: false, error: { code: 'wrongAwaitKind' } });
    d.play(0, 'S7 H7');
    const w = d.current();
    const before = JSON.stringify(d.state);
    const cases: [Action, string][] = [
      [{ type: 'choose', seat: 0, awaitId: turnId, cards: [] }, 'staleAwait'],
      [{ type: 'choose', seat: 1, awaitId: w.id, cards: [] }, 'notYourAwait'],
      [{ type: 'choose', seat: 0, awaitId: w.id, cards: cs('H5 H5') }, 'invalidChoice'],
      [{ type: 'choose', seat: 0, awaitId: w.id, cards: cs('H5 H6 S7') }, 'invalidChoice'],
      [{ type: 'choose', seat: 0, awaitId: w.id, cards: cs('S9') }, 'cardNotInHand'],
      [{ type: 'choose', seat: 0, awaitId: w.id, cards: ['nope'] }, 'cardNotInHand'],
      [{ type: 'choose', seat: 0, awaitId: w.id, cards: 'x' as never }, 'malformed'],
      [{ type: 'play', seat: 0, awaitId: w.id, cards: cs('H5') }, 'wrongAwaitKind'],
      [{ type: 'pass', seat: 0, awaitId: w.id }, 'wrongAwaitKind'],
    ];
    for (const [a, code] of cases) {
      const r = applyAction(d.state, a);
      expect(r.ok, code).toBe(false);
      if (!r.ok) expect(r.error.code, JSON.stringify(a)).toBe(code);
    }
    expect(JSON.stringify(d.state)).toBe(before);
  });
});
