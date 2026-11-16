import { describe, expect, it } from 'vitest';
import { legalPlays, viewFor } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

describe('激縛り（decisions §6.7、§14.8、§16.1、design-2 §6.1）', () => {
  it('成立: 同じマークで1つ強い組が続くと成立し、続きの数字しか出せない。連番の更新では出来事を出さない', () => {
    const d = new Driver(scene({ rules: ['sequence_lock'], hands: ['H6 S3', 'H7 S4', 'H8 H9 HJ S9 D8', 'H10 CK'], turn: 0 }));
    d.play(0, 'H6');
    expect(d.game.seqLock).toBeNull();
    d.play(1, 'H7');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 7 });
    expect(d.events.filter((e) => e.type === 'seqLock')).toEqual([expect.objectContaining({ suits: ['heart'] })]);
    expect(viewFor(d.state, 3).game?.seqLock).toEqual({ suits: ['heart'], rank: 7 });
    // ♥9・♥J・♠9・♦8 は出せない
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([cs('H8')]);
    const bad = d.try({ type: 'play', seat: 2, awaitId: d.current().id, cards: cs('D8') });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.violation).toBe('sequenceLock');
    d.play(2, 'H8');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 8 });
    expect(d.events.filter((e) => e.type === 'seqLock')).toHaveLength(1);
    // 場が流れると解除
    d.pass(3);
    d.pass(0);
    d.pass(1);
    expect(d.game.seqLock).toBeNull();
  });

  it('成立しない: 数字が2つ以上離れている、マークが違う、ジョーカーを含む', () => {
    const a = new Driver(scene({ rules: ['sequence_lock'], hands: ['H6 S3', 'H8 S4', 'D9', 'C4'], turn: 0 }));
    a.play(0, 'H6');
    a.play(1, 'H8');
    expect(a.game.seqLock).toBeNull();
    const b = new Driver(scene({ rules: ['sequence_lock'], hands: ['H6 S3', 'S7 S4', 'D9', 'C4'], turn: 0 }));
    b.play(0, 'H6');
    b.play(1, 'S7');
    expect(b.game.seqLock).toBeNull();
    const c = new Driver(scene({ rules: ['sequence_lock'], hands: ['H6 S6 S3', 'H7 X0 S4', 'D9', 'C4'], turn: 0 }));
    c.play(0, 'H6 S6');
    c.play(1, 'H7 X0');
    expect(c.game.seqLock).toBeNull();
  });

  it('組はマークの組み合わせが同じときに成立し、同じ組み合わせしか出せない', () => {
    const d = new Driver(scene({ rules: ['sequence_lock'], hands: ['H6 S6 S3', 'H7 S7 S4', 'S8 H8 D8 C8 C3', 'C4'], turn: 0 }));
    d.play(0, 'H6 S6');
    d.play(1, 'H7 S7');
    expect(d.game.seqLock).toEqual({ suits: ['spade', 'heart'], rank: 7 });
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([cs('S8 H8')]);
  });

  it('強さが逆のとき: 成立も続きも、その向きで1つ強い数字（数字が下がる）', () => {
    const d = new Driver(scene({ rules: ['sequence_lock'], revolution: true, hands: ['H8 S3', 'H7 S4', 'H6 H5 S9', 'C4'], turn: 0 }));
    d.play(0, 'H8');
    d.play(1, 'H7');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 7 });
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([cs('H6')]);
  });

  it('J バックで向きが変わった直後: 成立は出す直前の向きで判定し、続きは変わったあとの向きで1つ強い数字', () => {
    const d = new Driver(
      scene({ rules: ['sequence_lock', 'temp_reverse_on_j'], hands: ['H10 S3', 'HJ S4', 'HQ X0 D10', 'C4'], turn: 0 }),
    );
    d.play(0, 'H10');
    d.play(1, 'HJ');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 11 });
    expect(d.game.tempReverse).toBe(true);
    // 逆の向きで J より1つ強いのは10。♥10 は出ているので、ジョーカーを♥10の代わりにするしかない
    const plays = legalPlays(d.state, 2);
    expect(plays.map((p) => p.cards)).toEqual([['joker-0']]);
    expect(plays[0]?.play).toMatchObject({ rank: null, jokers: [{ card: 'joker-0', rank: 10, suit: 'heart' }] });
  });

  it('ジョーカーの代わり: ♥6 → ♥7（成立）→ ジョーカー（♥8 の代わり）→ ♥9。8切りが ON でも場は流れない', () => {
    const d = new Driver(
      scene({ rules: ['sequence_lock', 'flush_on_8', 'spade3_beats_joker'], hands: ['H6 S3', 'H7 S4', 'X0 D5', 'H9 CK'], turn: 0 }),
    );
    d.play(0, 'H6');
    d.play(1, 'H7');
    const ev = d.play(2, 'X0');
    // 数字の効果も返しの一周も「すぐ流す」も起きない
    expect(ev.map((e) => e.type)).toEqual(['play']);
    expect(ev[0]).toMatchObject({ play: { rank: null, jokers: [{ card: 'joker-0', rank: 8, suit: 'heart' }] } });
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 8 });
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
    expect(legalPlays(d.state, 3).map((p) => p.cards)).toEqual([cs('H9')]);
    d.play(3, 'H9');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 9 });
  });

  it('2枚組でも同じ: ジョーカー2枚の組を♠8・♥8の代わりに出せ、すぐには流れない', () => {
    const d = new Driver(
      scene({ rules: ['sequence_lock', 'flush_on_8'], hands: ['H6 S6 S3', 'H7 S7 S4', 'X0 X1 D5', 'H9 S9 CK'], turn: 0 }),
    );
    d.play(0, 'H6 S6');
    d.play(1, 'H7 S7');
    const ev = d.play(2, 'X0 X1');
    expect(ev.map((e) => e.type)).toEqual(['play']);
    expect(ev[0]).toMatchObject({
      play: {
        rank: null,
        jokers: [
          { card: 'joker-0', rank: 8, suit: 'spade' },
          { card: 'joker-1', rank: 8, suit: 'heart' },
        ],
      },
    });
    d.play(3, 'H9 S9');
  });

  it('ジョーカーを混ぜた組も代わりに出せる（足りないマークの代わり）', () => {
    const d = new Driver(scene({ rules: ['sequence_lock'], hands: ['H6 S6 S3', 'H7 S7 S4', 'S8 X0 D8', 'C4'], turn: 0 }));
    d.play(0, 'H6 S6');
    d.play(1, 'H7 S7');
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([cs('S8 X0')]);
    const ev = d.play(2, 'S8 X0');
    expect(ev[0]).toMatchObject({ play: { rank: 8, jokers: [{ card: 'joker-0', rank: 8, suit: 'heart' }] } });
  });

  it('いちばん上の数字（通常は2）のあとは、ジョーカーも含めて何も出せない', () => {
    const d = new Driver(scene({ rules: ['sequence_lock'], hands: ['HA S3', 'H2 S4', 'X0 X1 D5', 'C4'], turn: 0 }));
    d.play(0, 'HA');
    d.play(1, 'H2');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 15 });
    expect(legalPlays(d.state, 2)).toEqual([]);
    d.pass(2);
  });

  it('階段には掛からない', () => {
    const d = new Driver(scene({ rules: ['sequence_lock', 'runs'], hands: ['H3 H4 H5 S3', 'H6 H7 H8 S4', 'D9', 'C4'], turn: 0 }));
    d.play(0, 'H3 H4 H5');
    d.play(1, 'H6 H7 H8');
    expect(d.game.seqLock).toBeNull();
  });

  it('マーク縛りと両方 ON のときは、どちらも満たす', () => {
    const d = new Driver(
      scene({ rules: ['sequence_lock', 'suit_lock'], hands: ['H6 S3', 'H7 S4', 'H8 H9 D8 X0', 'C4'], turn: 0 }),
    );
    d.play(0, 'H6');
    d.play(1, 'H7');
    expect(d.game.suitLock).toEqual(['heart']);
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 7 });
    expect(legalPlays(d.state, 2).map((p) => p.cards)).toEqual([cs('H8'), ['joker-0']]);
  });
});
