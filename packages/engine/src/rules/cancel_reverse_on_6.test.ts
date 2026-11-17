// 6戻し（decisions §15.3、§19.2、design-4 §2.4、§2.9）。
import { describe, expect, it } from 'vitest';
import { createMatch, legalPlays } from '../index.ts';
import { Driver, cfg, scene } from '../test/helpers.ts';

const R = ['temp_reverse_on_j', 'cancel_reverse_on_6'] as const;
const cardsOf = (d: Driver, seat: 0 | 1 | 2 | 3) => legalPlays(d.state, seat).map((p) => p.cards.join(' '));

describe('6戻し', () => {
  it('J バック中に6を出すと解除され、次の人は解除後の向きで6より強いカードを出す', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SJ S3', 'H6 HQ', 'D5 D7', 'C9'], turn: 0 }));
    d.play(0, 'SJ');
    expect(d.game.tempReverse).toBe(true);
    // 6自体は、出す時点の向き（J バック中）で J より強い（弱い数字）ので出せる
    expect(cardsOf(d, 1)).toEqual(['heart-6']);
    const ev = d.play(1, 'H6');
    expect(ev.map((e) => e.type)).toEqual(['play', 'tempReverse']);
    expect(ev[1]).toEqual(expect.objectContaining({ type: 'tempReverse', active: false, rule: 'cancel_reverse_on_6' }));
    expect(d.game.tempReverse).toBe(false);
    expect(cardsOf(d, 2)).toEqual(['diamond-7']);
  });

  it('解除したあと、同じ場でもう一度 J が出れば、また J バックになる（場が流れたときの解除には rule が載らない）', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['SJ S3', 'H6 H9', 'DJ D7', 'C9'], turn: 0 }));
    d.play(0, 'SJ');
    d.play(1, 'H6');
    const ev = d.play(2, 'DJ');
    expect(ev[1]).toEqual(expect.objectContaining({ type: 'tempReverse', active: true }));
    expect(ev[1]).not.toHaveProperty('rule');
    d.pass(3);
    d.pass(0);
    const fl = d.pass(1);
    const off = fl.find((e) => e.type === 'tempReverse');
    expect(off).toEqual(expect.objectContaining({ active: false }));
    expect(off).not.toHaveProperty('rule');
  });

  it('J バック中でなければ何も起きない。革命には影響しない。ジョーカーを混ぜた6でも発動する', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['S6 S3', 'H9', 'D9', 'C9'], turn: 0 }));
    expect(a.play(0, 'S6').map((e) => e.type)).toEqual(['play']);
    const b = new Driver(scene({ rules: [...R], hands: ['S6 X0 S3', 'H9', 'D9', 'C9'], turn: 0, revolution: true, tempReverse: true }));
    const ev = b.play(0, 'S6 X0', { confirmFoul: true });
    expect(ev.map((e) => e.type)).toEqual(['play', 'tempReverse']);
    expect(b.game.revolution).toBe(true);
    expect(b.game.tempReverse).toBe(false);
  });

  it('J バックがないと選べない（missingRequirement）', () => {
    const r = createMatch(cfg(['cancel_reverse_on_6']), [1, 2, 3, 4]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'missingRequirement', rule: 'cancel_reverse_on_6' });
  });
});
