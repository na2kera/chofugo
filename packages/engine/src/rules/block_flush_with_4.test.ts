import { describe, expect, it } from 'vitest';
import { legalPlays, viewFor } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['flush_on_8', 'block_flush_with_4'] as const;

describe('4止め（decisions §6.2、§16.2）', () => {
  it('成立: 4の2枚は捨て札に入り、8は場に残る。8を出した人の次から続き、一周したら8を出した人が親', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S8 S5 S6', 'H4 D4 H9', 'C9 CJ', 'D10 DQ'], turn: 0 }));
    d.play(0, 'S8');
    expect(d.events.at(-1)).toMatchObject({ type: 'returnRoundStart', rule: 'block_flush_with_4', source: 0, participants: [1, 2, 3] });
    expect(legalPlays(d.state, 1).map((p) => p.cards)).toEqual([cs('H4 D4')]);
    const ev = d.respond(1, 'H4 D4');
    expect(ev[0]).toMatchObject({ type: 'respond', seat: 1, toDiscard: true, play: { cards: cs('H4 D4'), rank: 4 } });
    expect(ev.map((e) => e.type)).toEqual(['respond', 'returnRoundEnd']);
    expect(d.game.field.map((fp) => fp.play.cards)).toEqual([cs('S8')]);
    expect(d.game.lastPlayer).toBe(0);
    expect(d.game.discard).toEqual(cs('H4 D4'));
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
    // 8はふつうのカードとして場に残る（9が出せる）
    expect(legalPlays(d.state, 1).map((p) => p.cards)).toEqual([cs('H9')]);
    d.pass(1);
    d.pass(2);
    d.pass(3);
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'allPassed', leader: 0 });
  });

  it('不成立なら、ふつうに8切りで場が流れる', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S8 S5 S6', 'H4 D4 H9', 'C9 CJ', 'D10 DQ'], turn: 0 }));
    d.play(0, 'S8');
    d.respond(1, null);
    d.respond(2, null);
    d.respond(3, null);
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'flush_on_8', leader: 0 });
    expect(d.game.discard).toEqual(cs('S8'));
  });

  it('返せるカードがない人も聞かれる。4を3枚持っていれば、どの2枚で返すかを選べる。ジョーカーは使えない', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S8 S5', 'H4 D4 C4 X0', 'S4 X1', 'D10 DQ'], turn: 0 }));
    d.play(0, 'S8');
    expect(legalPlays(d.state, 1).map((p) => p.cards)).toEqual([cs('H4 D4'), cs('H4 C4'), cs('D4 C4')]);
    const bad = d.try({ type: 'respond', seat: 1, awaitId: d.current().id, cards: cs('H4 X0') });
    expect(bad.ok).toBe(false);
    d.respond(1, null);
    expect(legalPlays(d.state, 2)).toEqual([]);
    expect(viewFor(d.state, 2).mine).toMatchObject({ kind: 'respond', rule: 'block_flush_with_4', plays: [] });
  });

  it('省く条件: 本物の4が捨て札と場に合わせて3枚以上見えていれば、一周を行わない', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['S8 S5', 'C4 H9', 'C9 CJ', 'D10 DQ'], turn: 0, discard: 'S4 H4 D4' }));
    a.play(0, 'S8');
    expect(a.types()).toEqual(['play', 'fieldCleared']);
    // 場に出ている4も数える（§16.2）
    const b = new Driver(scene({ rules: [...R], hands: ['D4 S5', 'S8 C4 H9', 'C9 CJ', 'D10 DQ'], turn: 0, discard: 'S4 H4' }));
    b.play(0, 'D4');
    b.play(1, 'S8');
    expect(b.types()).toEqual(['play', 'play', 'fieldCleared']);
    // 2枚だけ見えているときは行う
    const c = new Driver(scene({ rules: [...R], hands: ['S8 S5', 'C4 D4 H9', 'C9 CJ', 'D10 DQ'], turn: 0, discard: 'S4 H4' }));
    c.play(0, 'S8');
    expect(c.types()).toEqual(['play', 'returnRoundStart']);
  });

  it('その場でパスした人も返せる。パスの状態はそのまま', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S5 SJ', 'H6 HQ', 'C4 D4 C2', 'S8 DK'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'H6');
    d.pass(2);
    d.play(3, 'S8');
    d.respond(0, null);
    d.respond(1, null);
    d.respond(2, 'C4 D4');
    expect(d.game.passed).toEqual([false, false, true, false]);
    expect(d.current()).toMatchObject({ seat: 0, kind: 'turn' });
  });

  it('4の2枚で手札が0枚になった人は、そこで上がる（反則ではない）', () => {
    const d = new Driver(
      scene({ rules: [...R, 'forbidden_finish'], hands: ['S8 S5', 'H4 D4', 'C9 CJ', 'D10 DQ'], turn: 0 }),
    );
    d.play(0, 'S8');
    d.respond(1, 'H4 D4');
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 1, place: 1, reason: 'finish' });
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
    expect(d.game.field.map((fp) => fp.play.cards)).toEqual([cs('S8')]);
  });

  it('8で上がった人の8も止められる。一周したら、8を出した人の席から進行方向で次の人が親', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S8', 'H4 D4 H9', 'C9 CJ', 'D10 DQ'], turn: 0 }));
    d.play(0, 'S8');
    expect(d.types()).toEqual(['play', 'placed', 'returnRoundStart']);
    d.respond(1, 'H4 D4');
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
    d.pass(1);
    d.pass(2);
    d.pass(3);
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'allPassed', leader: 1 });
  });

  it('マーク縛り・激縛り中でも返せる', () => {
    const d = new Driver(
      scene({ rules: [...R, 'suit_lock', 'sequence_lock'], hands: ['H6 S5', 'H7 C5', 'H8 C9', 'S4 D4 DQ'], turn: 0 }),
    );
    d.play(0, 'H6');
    d.play(1, 'H7');
    expect(d.game.suitLock).toEqual(['heart']);
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 7 });
    d.play(2, 'H8');
    d.respond(3, 'S4 D4');
    expect(d.events.at(-2)).toMatchObject({ type: 'respond', toDiscard: true });
  });
});
