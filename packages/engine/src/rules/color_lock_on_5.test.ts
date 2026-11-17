// 5色縛り（decisions §15.2、§19.2、design-4 §2.4、§2.9、§6.6）。
import { describe, expect, it } from 'vitest';
import { legalPlays, viewFor } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

const R = ['color_lock_on_5'] as const;
const cardsOf = (d: Driver, seat: 0 | 1 | 2 | 3) => legalPlays(d.state, seat).map((p) => p.cards.join(' '));

describe('5色縛り', () => {
  it('赤の5を出すと、黒のカードは出せない。ジョーカーはどちらの色としても出せる', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['H5 S9', 'S7 H8 X0', 'D9', 'C9'], turn: 0 }));
    const ev = d.play(0, 'H5');
    expect(ev.map((e) => e.type)).toEqual(['play', 'colorLock']);
    expect(ev[1]).toMatchObject({ color: 'red' });
    expect(d.game.colorLock).toBe('red');
    expect(viewFor(d.state, 2).game?.colorLock).toBe('red');
    const w = d.current();
    const r = d.try({ type: 'play', seat: 1, awaitId: w.id, cards: cs('S7') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'illegalPlay', violation: 'colorLock' });
    expect(cardsOf(d, 1).sort()).toEqual(['heart-8', 'joker-0'].sort());
  });

  it('黒の5の2枚は黒。赤と黒の5の2枚では成立しない。ジョーカーを混ぜた5でも本物の色で成立する', () => {
    const a = new Driver(scene({ rules: [...R], hands: ['S5 C5 H3', 'D9', 'D10', 'C9'], turn: 0 }));
    expect(a.play(0, 'S5 C5').map((e) => e.type)).toEqual(['play', 'colorLock']);
    expect(a.game.colorLock).toBe('black');
    const b = new Driver(scene({ rules: [...R], hands: ['S5 H5 H3', 'D9', 'D10', 'C9'], turn: 0 }));
    expect(b.play(0, 'S5 H5').map((e) => e.type)).toEqual(['play']);
    expect(b.game.colorLock).toBeNull();
    const c = new Driver(scene({ rules: [...R], hands: ['D5 X0 H3', 'D9', 'D10', 'C9'], turn: 0 }));
    expect(c.play(0, 'D5 X0').map((e) => e.type)).toEqual(['play', 'colorLock']);
    expect(c.game.colorLock).toBe('red');
    // ジョーカーだけの手・階段では発動しない
    const e = new Driver(scene({ rules: [...R, 'runs'], hands: ['H3 H4 H5 C3', 'D9', 'D10', 'C9'], turn: 0 }));
    expect(e.play(0, 'H3 H4 H5', { shape: 'run' }).map((x) => x.type)).toEqual(['play']);
    expect(e.game.colorLock).toBeNull();
  });

  it('場が流れると解除される（出来事は出さない）', () => {
    const d = new Driver(scene({ rules: [...R], hands: ['H5 S9', 'S7 S8', 'C3', 'C4'], turn: 0 }));
    d.play(0, 'H5');
    d.pass(1);
    d.pass(2);
    const ev = d.pass(3);
    expect(ev.map((e) => e.type)).toEqual(['pass', 'fieldCleared']);
    expect(d.game.colorLock).toBeNull();
    expect(viewFor(d.state, 0).game?.colorLock).toBeNull();
    expect(cardsOf(d, 0)).toContain('spade-9');
  });

  it('すでに色縛り中なら何も変えない（J バックで5をもう一度出す）', () => {
    const d = new Driver(scene({ rules: [...R, 'temp_reverse_on_j'], hands: ['H5 S9', 'DJ C3', 'D5 C8', 'C9'], turn: 0 }));
    d.play(0, 'H5');
    d.play(1, 'DJ');
    expect(d.play(2, 'D5').map((e) => e.type)).toEqual(['play']);
    expect(d.game.colorLock).toBe('red');
  });

  it('砂嵐・スペ3返し・4止めは、色縛りも無視して出せる', () => {
    // 砂嵐
    const a = new Driver(scene({ rules: [...R, 'triple3_trump'], hands: ['H5 H9', 'S3 C3 H3 C9', 'D9', 'C10'], turn: 0 }));
    a.play(0, 'H5');
    expect(cardsOf(a, 1)).toContain('spade-3 heart-3 club-3');
    a.play(1, 'S3 H3 C3');
    expect(a.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'triple3_trump' });
    // スペ3返し
    const b = new Driver(scene({ rules: [...R, 'spade3_beats_joker'], hands: ['H5 H9', 'X0 H7', 'S3 C9', 'C10'], turn: 0 }));
    b.play(0, 'H5');
    b.play(1, 'X0');
    b.respond(2, 'S3');
    expect(b.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'spade3_beats_joker', leader: 2 });
    // 4止め
    const c = new Driver(scene({ rules: [...R, 'flush_on_8', 'block_flush_with_4'], hands: ['H5 H9', 'H8 H7', 'S4 C4 C9', 'C10'], turn: 0 }));
    c.play(0, 'H5');
    c.play(1, 'H8');
    expect(legalPlays(c.state, 2).map((p) => p.cards.join(' '))).toEqual(['spade-4 club-4']);
    c.respond(2, 'S4 C4');
    expect(c.events.find((e) => e.type === 'respond')).toMatchObject({ seat: 2, toDiscard: true });
  });

  it('マーク縛りとは別々に判定し、両方を満たす必要がある', () => {
    const d = new Driver(scene({ rules: [...R, 'suit_lock'], hands: ['H5 S9', 'H6 C3', 'D7 H7 S8', 'C10'], turn: 0 }));
    d.play(0, 'H5');
    d.play(1, 'H6'); // ハートが続いてマーク縛り
    expect(d.game.suitLock).toEqual(['heart']);
    expect(d.game.colorLock).toBe('red');
    // D7 は赤だがマーク縛りに合わない。S8 は色縛りに合わない
    expect(cardsOf(d, 2)).toEqual(['heart-7']);
  });

  it('色縛り＋激縛り＋ジョーカー: ジョーカーは必要なマーク・数字の代わりになり、色縛りも通る', () => {
    const d = new Driver(scene({ rules: [...R, 'sequence_lock'], hands: ['H5 S9', 'H6 C3', 'X0 S7 H8', 'C10'], turn: 0 }));
    d.play(0, 'H5');
    d.play(1, 'H6');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 6 });
    expect(cardsOf(d, 2)).toEqual(['joker-0']);
    d.play(2, 'X0');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 7 });
  });

  it('色縛り中の返しの一周と独裁: スペードの3が封じられていれば一周を省く。封じられていなければ黒でも返せる', () => {
    const base = () =>
      scene({ rules: [...R, 'spade3_beats_joker'], hands: ['H5 H9 C10', 'X0 H7', 'S3 C9', 'D10'], turn: 0, abilities: { holder: 0, chosen: ['ban'] } });
    const a = new Driver(base());
    a.use(0, 'ban', { rank: 3 });
    a.play(0, 'H5');
    a.play(1, 'X0');
    expect(a.types()).not.toContain('returnRoundStart');
    expect(a.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'jokerUnbeatable', leader: 1 });
    const b = new Driver(base());
    b.play(0, 'H5');
    b.play(1, 'X0');
    expect(b.current()).toMatchObject({ seat: 2, kind: 'respond' });
    expect(legalPlays(b.state, 2).map((p) => p.cards)).toEqual([cs('S3')]);
  });
});
