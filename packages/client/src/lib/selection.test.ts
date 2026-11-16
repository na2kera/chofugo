import { describe, expect, it } from 'vitest';
import type { LegalPlay, Play } from '@chofugo/engine';
import {
  afterShapeChosen,
  dimReason,
  evaluateSelection,
  nextPlayStep,
  scopedValue,
  selectionKey,
  toggleCard,
} from './selection.ts';

function g(cards: string[], rank: number | null, foul = false): LegalPlay {
  const play: Play = { shape: 'group', cards, rank: rank as never, jokers: [] };
  return { cards, shape: 'group', play, foul };
}
function r(cards: string[], low: number, high: number, foul = false): LegalPlay {
  const play: Play = { shape: 'run', cards, suit: 'spade', low: low as never, high: high as never, jokers: [] };
  return { cards, shape: 'run', play, foul };
}

const HAND = ['spade-5', 'spade-6', 'heart-6', 'spade-7', 'club-9', 'joker-0', 'joker-1'];
const PLAYS: LegalPlay[] = [
  g(['spade-6', 'heart-6'], 6),
  g(['spade-6', 'joker-0'], 6),
  r(['spade-5', 'spade-6', 'spade-7'], 5, 7),
  // 組にも階段にも読める手
  g(['spade-5', 'joker-0', 'joker-1'], 5),
  r(['spade-5', 'joker-0', 'joker-1'], 5, 7),
  // 反則になる手
  g(['joker-0'], null, true),
];

describe('手の選び方', () => {
  it('何も選んでいないときは、出せる手に含まれるカードだけ選べる', () => {
    const ev = evaluateSelection(HAND, PLAYS, []);
    expect([...ev.selectable].sort()).toEqual(['heart-6', 'joker-0', 'joker-1', 'spade-5', 'spade-6', 'spade-7'].sort());
    expect(ev.selectable.has('club-9')).toBe(false);
    expect(ev.matches).toEqual([]);
  });

  it('選んだカードをすべて含む出せる手が残るカードだけ選べる', () => {
    const ev = evaluateSelection(HAND, PLAYS, ['heart-6']);
    expect([...ev.selectable].sort()).toEqual(['heart-6', 'spade-6']);
  });

  it('ちょうど一致したら出せる', () => {
    const ev = evaluateSelection(HAND, PLAYS, ['spade-6', 'heart-6']);
    expect(ev.matches).toHaveLength(1);
    expect(nextPlayStep(ev.matches)).toEqual({ kind: 'send', play: PLAYS[0] });
  });

  it('選ぶ順番が違っても同じ結果になる', () => {
    const a = evaluateSelection(HAND, PLAYS, ['spade-7', 'spade-5', 'spade-6']);
    const b = evaluateSelection(HAND, PLAYS, ['spade-5', 'spade-6', 'spade-7']);
    expect(a.matches).toEqual(b.matches);
    expect(a.matches[0]?.shape).toBe('run');
    let sel: string[] = [];
    for (const c of ['spade-7', 'spade-6', 'spade-5']) sel = toggleCard(HAND, PLAYS, sel, c)!;
    expect(evaluateSelection(HAND, PLAYS, sel).matches).toHaveLength(1);
  });

  it('選択を外せる（外したら、また選べるカードが広がる）', () => {
    const s1 = toggleCard(HAND, PLAYS, [], 'heart-6')!;
    expect(s1).toEqual(['heart-6']);
    expect(toggleCard(HAND, PLAYS, s1, 'spade-7')).toBeNull();
    const s0 = toggleCard(HAND, PLAYS, s1, 'heart-6')!;
    expect(s0).toEqual([]);
    expect(toggleCard(HAND, PLAYS, s0, 'spade-7')).toEqual(['spade-7']);
  });

  it('選べないカードを押しても選択は変わらない', () => {
    expect(toggleCard(HAND, PLAYS, [], 'club-9')).toBeNull();
  });

  it('組にも階段にも読める手は、形の2択になる', () => {
    const ev = evaluateSelection(HAND, PLAYS, ['spade-5', 'joker-0', 'joker-1']);
    expect(ev.matches).toHaveLength(2);
    const step = nextPlayStep(ev.matches);
    expect(step.kind).toBe('chooseShape');
    if (step.kind === 'chooseShape') expect(step.options.map((o) => o.shape).sort()).toEqual(['group', 'run']);
  });

  it('反則になる手も選べ、出す前に確認になる', () => {
    const ev = evaluateSelection(HAND, PLAYS, ['joker-0']);
    expect(ev.selectable.has('joker-0')).toBe(true);
    expect(ev.matches).toHaveLength(1);
    expect(nextPlayStep(ev.matches)).toEqual({ kind: 'confirmFoul', play: PLAYS[5] });
  });

  it('形を選んだあと、反則なら確認、そうでなければ送る', () => {
    expect(afterShapeChosen(g(['joker-0', 'joker-1'], null, true)).kind).toBe('confirmFoul');
    expect(afterShapeChosen(PLAYS[3]!).kind).toBe('send');
  });

  it('出せる手がない（相手の番など）ときは何も選べない', () => {
    const ev = evaluateSelection(HAND, [], []);
    expect(ev.selectable.size).toBe(0);
    expect(nextPlayStep(ev.matches)).toEqual({ kind: 'none' });
  });
});

describe('出せない理由', () => {
  const turn = { awaitId: 1, kind: 'turn' as const, leader: false, plays: PLAYS, canPass: true };
  it('自分の番でない', () => {
    expect(dimReason(null, [], [], 'club-9', null)).toBe('notYourTurn');
  });
  it('選んだカードと組み合わせられない', () => {
    expect(dimReason(turn, PLAYS, ['heart-6'], 'spade-7', null)).toBe('cannotCombine');
  });
  it('縛りのマークに合わない', () => {
    expect(dimReason(turn, PLAYS, [], 'club-9', ['spade', 'heart'])).toBe('suitLock');
  });
  it('それ以外は弱いか枚数・種類が合わない', () => {
    expect(dimReason(turn, PLAYS, [], 'club-9', null)).toBe('weaker');
  });
});

describe('選択の寿命', () => {
  it('待ちが変わったら選択は捨てられる', () => {
    const k1 = selectionKey('m1', 3, 10);
    const k2 = selectionKey('m1', 3, 11);
    const stored = { key: k1, value: ['spade-6'] };
    expect(scopedValue(stored, k1, [])).toEqual(['spade-6']);
    expect(scopedValue(stored, k2, [])).toEqual([]);
  });
  it('試合やゲームが変われば別の鍵になる', () => {
    expect(selectionKey('m1', 3, 10)).not.toBe(selectionKey('m2', 3, 10));
    expect(selectionKey('m1', 3, 10)).not.toBe(selectionKey('m1', 4, 10));
    expect(selectionKey(null, null, null)).toBe('-:-:-');
  });
});
