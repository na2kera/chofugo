// オーメン（decisions §15.4、§19.1、design-4 §2.4、§2.9）。
import { describe, expect, it } from 'vitest';
import { Driver, scene } from '../test/helpers.ts';
import { isTurnRole } from './roles.ts';

describe('オーメン', () => {
  it('6の本物3枚で革命が起きる。「革命」が OFF でも単独で働き、出来事に rule が載る', () => {
    const d = new Driver(scene({ rules: ['triple6_revolution'], hands: ['S6 H6 D6 S3', 'H9', 'D9', 'C9'], turn: 0 }));
    const ev = d.play(0, 'S6 H6 D6');
    expect(ev.map((e) => e.type)).toEqual(['play', 'revolution']);
    expect(ev[1]).toEqual(expect.objectContaining({ active: true, rule: 'triple6_revolution' }));
    expect(d.game.revolution).toBe(true);
    expect(d.game.revolutionBy).toBe(0);
  });

  it('固定しない: 革命中にもう一度のオーメンで革命返し', () => {
    const d = new Driver(scene({ rules: ['triple6_revolution'], hands: ['S6 H6 D6 S3', 'H9', 'D9', 'C9'], turn: 0, revolution: true }));
    d.play(0, 'S6 H6 D6');
    expect(d.game.revolution).toBe(false);
  });

  it('ジョーカー入りの3枚・4枚の6は役にならない（4枚は「革命」が ON ならふつうの革命）', () => {
    const a = new Driver(scene({ rules: ['triple6_revolution'], hands: ['S6 H6 X0 S3', 'H9', 'D9', 'C9'], turn: 0 }));
    expect(a.play(0, 'S6 H6 X0').map((e) => e.type)).toEqual(['play']);
    const b = new Driver(scene({ rules: ['triple6_revolution'], hands: ['S6 H6 D6 C6 S3', 'H9', 'D9', 'C9'], turn: 0 }));
    expect(b.play(0, 'S6 H6 D6 C6').map((e) => e.type)).toEqual(['play']);
    const c = new Driver(scene({ rules: ['triple6_revolution', 'revolution'], hands: ['S6 H6 D6 C6 S3', 'H9', 'D9', 'C9'], turn: 0 }));
    const ev = c.play(0, 'S6 H6 D6 C6');
    expect(ev.map((e) => e.type)).toEqual(['play', 'revolution']);
    expect(ev[1]).not.toHaveProperty('rule');
  });

  it('J バック中の6の3枚は「オーメンの革命 → 6戻し」の順', () => {
    const d = new Driver(
      scene({ rules: ['temp_reverse_on_j', 'cancel_reverse_on_6', 'triple6_revolution'], hands: ['SJ HJ DJ S3', 'S6 H6 D6 H9', 'D9', 'C9'], turn: 0 }),
    );
    d.play(0, 'SJ HJ DJ');
    const ev = d.play(1, 'S6 H6 D6');
    expect(ev.map((e) => e.type)).toEqual(['play', 'revolution', 'tempReverse']);
    expect(ev[1]).toEqual(expect.objectContaining({ active: true, rule: 'triple6_revolution' }));
    expect(ev[2]).toEqual(expect.objectContaining({ active: false, rule: 'cancel_reverse_on_6' }));
    expect(d.game.revolution).toBe(true);
    expect(d.game.tempReverse).toBe(false);
  });

  it('役は手番で出した手だけ（返しの一周の手では発動しない）', () => {
    const play = { shape: 'group' as const, cards: ['spade-6', 'heart-6', 'diamond-6'], rank: 6 as const, jokers: [] };
    expect(isTurnRole({ seat: 0, play, via: 'turn' }, 6, 3)).toBe(true);
    expect(isTurnRole({ seat: 0, play, via: 'respond' }, 6, 3)).toBe(false);
  });
});
