// 銀河鉄道（decisions §15.6、§19.3、design-4 §2.4、§2.9）。
import { describe, expect, it } from 'vitest';
import { sortCardIds } from '../cards.ts';
import { viewFor } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['triple9_salvage'] as const;

describe('銀河鉄道', () => {
  it('手札を2枚まで捨て札に置き、同じ枚数を置く前の捨て札からランダムに受け取る。全員に見える', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S9 H9 D9 C4 C5 C6', 'HK', 'D7', 'C3'], turn: 0, discard: 'S3 H3 D3' }));
    const ev = d.play(0, 'S9 H9 D9');
    expect(ev.map((e) => e.type)).toEqual(['play', 'choiceStart']);
    expect(ev[1]).toMatchObject({ rule: 'triple9_salvage', seat: 0, max: 2, to: null });
    expect(viewFor(d.state, 0).mine).toEqual({ awaitId: d.current().id, kind: 'choice', rule: 'triple9_salvage', max: 2, to: null });
    const before = d.state.rng.slice();
    const out = d.choose(0, 'C5 C4');
    const sv = out[0];
    if (sv?.type !== 'salvage') throw new Error();
    expect(sv.put).toEqual(cs('C4 C5'));
    expect(sv.took).toHaveLength(2);
    for (const id of sv.took) expect(cs('S3 H3 D3')).toContain(id);
    expect(d.state.rng).not.toEqual(before);
    expect(d.game.hands[0]).toEqual(sortCardIds([...sv.took, 'club-6']));
    expect(d.game.discard).toHaveLength(3);
    expect(d.game.discard).toEqual(expect.arrayContaining(cs('C4 C5')));
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('捨て札が1枚なら1枚まで。自分がいま置いたカードと場のカードは引かない', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S5 H5 D5 C4', 'S9 H9 D9 C6 C7', 'D7', 'C3'], turn: 0, discard: 'S3' }));
    d.play(0, 'S5 H5 D5');
    d.play(1, 'S9 H9 D9');
    expect(d.events.at(-1)).toMatchObject({ type: 'choiceStart', max: 1 });
    const w = d.current();
    const over = d.try({ type: 'choose', seat: 1, awaitId: w.id, cards: cs('C6 C7') });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('invalidChoice');
    const ev = d.choose(1, 'C7');
    expect(ev[0]).toEqual(expect.objectContaining({ type: 'salvage', seat: 1, put: cs('C7'), took: cs('S3') }));
    expect(d.game.discard).toEqual(cs('C7'));
    expect(d.game.hands[1]).toEqual(cs('S3 C6'));
    expect(d.game.field.flatMap((fp) => fp.play.cards)).toEqual([...cs('S5 H5 D5'), ...cs('S9 H9 D9')]);
  });

  it('捨て札が0枚なら選択をはさまない。最後の3枚で出したときも選択なしで上がる', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['S9 H9 D9 C4', 'HK', 'D7', 'C3'], turn: 0 }));
    expect(a.play(0, 'S9 H9 D9').map((e) => e.type)).toEqual(['play']);
    expect(a.current()).toMatchObject({ seat: 1, kind: 'turn' });
    const b = new Driver(scene({ rules: [...R], hands: ['S9 H9 D9', 'HK', 'D7', 'C3'], turn: 0, discard: 'S3' }));
    expect(b.play(0, 'S9 H9 D9').map((e) => e.type)).toEqual(['play', 'placed']);
  });

  it('交換しないこともできる。9リバースが先に起きる', () => {
    const d = new Driver(scene({ rules: ['reverse_order_on_9', ...R], hands: ['S9 H9 D9 C4', 'HK', 'D7', 'C3'], turn: 0, discard: 'S3' }));
    expect(d.play(0, 'S9 H9 D9').map((e) => e.type)).toEqual(['play', 'orderReverse', 'choiceStart']);
    expect(d.choose(0, '').map((e) => e.type)).toEqual(['choiceSkip']);
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
  });

  it('ジョーカー入りの3枚・4枚の9は役にならない', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['S9 H9 X0 C4', 'HK', 'D7', 'C3'], turn: 0, discard: 'S3' }));
    expect(d.play(0, 'S9 H9 X0').map((e) => e.type)).toEqual(['play']);
    const b = new Driver(scene({ rules: [...R], hands: ['S9 H9 D9 C9 C4', 'HK', 'D7', 'C3'], turn: 0, discard: 'S3' }));
    expect(b.play(0, 'S9 H9 D9 C9').map((e) => e.type)).toEqual(['play']);
  });
});
