// その3（超富豪モード）の関数のテスト（design-3 §4.7、§6.8）。

import { describe, expect, it } from 'vitest';
import type { LegalPlay, MyAwaiting, Play, SeatId, VisibleEvent } from '@chofugo/engine';
import {
  abilityButtons,
  abilityPlate,
  banButtons,
  CANNOT_SKIP_TEXT,
  draftRowState,
  peekLabels,
  playWithSkip,
  selectingLine,
  selectPrompt,
  toggleDraft,
  toggleStealCard,
} from './abilities.ts';
import { eventLines, eventMessage } from './events.ts';
import { errorText } from './errors.ts';
import { pendingAfter } from './pending.ts';
import { dimReason, DIM_REASON_TEXT, scopedValue, selectionKey, type Scoped } from './selection.ts';
import { FULL_MS } from './timer.ts';
import { ABILITY_TEXT } from '../abilities-text.ts';

type TurnMine = Extract<MyAwaiting, { kind: 'turn' }>;

const g = (cards: string[], rank: number | null): Play => ({ shape: 'group', cards, rank: rank as never, jokers: [] });
const lp = (cards: string[], rank: number, extra: Partial<LegalPlay> = {}): LegalPlay => ({ cards, shape: 'group', play: g(cards, rank), foul: false, ...extra });
const ev = (body: Record<string, unknown>, seq = 1): VisibleEvent => ({ seq, gameNo: 2, ...body }) as unknown as VisibleEvent;
const NAMES = ['あなた', 'たろう', 'ゆい', 'CPU 4'];
const nameOf = (s: SeatId) => NAMES[s]!;

function turn(over: Partial<TurnMine> = {}): TurnMine {
  return { awaitId: 5, kind: 'turn', leader: false, canPass: true, plays: [], abilities: [], skipAvailable: false, ...over };
}

describe('特権の選択（design-3 §4.2、§6.2）', () => {
  it('押すと外す・足す。枠を超えては選べない。並びは ALL_ABILITY_IDS の順', () => {
    expect(toggleDraft({ draft: [], slots: 2 }, 'skip')).toEqual(['skip']);
    expect(toggleDraft({ draft: ['skip'], slots: 2 }, 'peek')).toEqual(['peek', 'skip']);
    expect(toggleDraft({ draft: ['peek', 'skip'], slots: 2 }, 'ban')).toBe(null);
    expect(toggleDraft({ draft: ['peek', 'skip'], slots: 2 }, 'peek')).toEqual(['skip']);
    expect(toggleDraft({ draft: ['ban'], slots: 1 }, 'ban')).toEqual([]);
  });

  it('行の見え方は届いた draft だけで決まる', () => {
    expect(draftRowState({ draft: ['steal'], slots: 2 }, 'steal')).toBe('sel');
    expect(draftRowState({ draft: ['steal'], slots: 2 }, 'peek')).toBe('normal');
    expect(draftRowState({ draft: ['steal', 'ban'], slots: 2 }, 'peek')).toBe('full');
  });

  it('メッセージ', () => {
    expect(selectPrompt(2)).toBe('特権を 2個 選べます');
    expect(selectingLine('たろう', 3)).toBe('たろう が 特権を選んでいます（3個）');
  });

  it('途中の保存の送信中は、返事か3秒で押せる状態に戻る（その1の決まり）', () => {
    const p = { reqId: 7, what: 'abilityDraft', sentAt: 1000 };
    expect(pendingAfter(p, { type: 'tick', now: 2000 })).toBe(p);
    expect(pendingAfter(p, { type: 'state' })).toBe(null);
    expect(pendingAfter(p, { type: 'tick', now: 4000 })).toBe(null);
    expect(FULL_MS.abilitySelect).toBe(60_000);
  });
});

describe('特権のボタンと選択の枠（design-3 §4.3、§6.1、§6.3）', () => {
  it('自分の番で未使用の特権があるときだけ並ぶ。スキップは最後', () => {
    expect(abilityButtons(null)).toEqual([]);
    expect(abilityButtons(turn())).toEqual([]);
    expect(abilityButtons({ awaitId: 1, kind: 'respond', rule: 'spade3_beats_joker', plays: [] })).toEqual([]);
    const m = turn({ abilities: [{ id: 'peek', usable: true, targets: [1] }, { id: 'forceFlush', usable: false }], skipAvailable: true });
    expect(abilityButtons(m)).toEqual([
      { id: 'peek', usable: true },
      { id: 'forceFlush', usable: false },
      { id: 'skip', usable: true },
    ]);
  });

  it('強奪のカード選び：渡せるカードから1枚だけ、もう一度押すと外れる', () => {
    const cards = ['club-3', 'spade-9'];
    expect(toggleStealCard(cards, null, 'club-3')).toBe('club-3');
    expect(toggleStealCard(cards, 'club-3', 'spade-9')).toBe('spade-9');
    expect(toggleStealCard(cards, 'spade-9', 'spade-9')).toBe(null);
    // 渡せないカード（ダイヤの3の義務）は変えない
    expect(toggleStealCard(cards, 'club-3', 'diamond-3')).toBe(undefined);
  });

  it('独裁の数字は13個。指定できない数字は押せない', () => {
    const b = banButtons([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(b.length).toBe(13);
    expect(b[0]).toEqual({ rank: 3, usable: false });
    expect(b.filter((x) => x.usable).length).toBe(12);
  });

  it('スキップの ON/OFF と送る内容', () => {
    expect(playWithSkip(lp(['spade-5'], 5), false)).toEqual({ ok: true, withSkip: false });
    expect(playWithSkip(lp(['spade-5'], 5, { canSkip: true }), true)).toEqual({ ok: true, withSkip: true });
    expect(playWithSkip(lp(['spade-8'], 8), true)).toEqual({ ok: false, line: CANNOT_SKIP_TEXT });
    expect(CANNOT_SKIP_TEXT).toBe('この手には スキップを付けられません');
  });

  it('特権を使って待ちの番号が変わると、選択・確認・選択の枠・強奪のカード・スキップの ON はすべて捨てられる', () => {
    const before = selectionKey('m1', 3, 40);
    const after = selectionKey('m1', 3, 41); // useAbility のあとの新しい番号（continues: 40）
    const sel: Scoped<string[]> = { key: before, value: ['spade-6', 'heart-6'] };
    const panel: Scoped<string | null> = { key: before, value: 'steal' };
    const steal: Scoped<string | null> = { key: before, value: 'club-3' };
    const skip: Scoped<boolean> = { key: before, value: true };
    const step: Scoped<{ kind: string }> = { key: before, value: { kind: 'confirmFoul' } };
    expect(scopedValue(sel, after, [])).toEqual([]);
    expect(scopedValue(panel, after, null)).toBe(null);
    expect(scopedValue(steal, after, null)).toBe(null);
    expect(scopedValue(skip, after, false)).toBe(false);
    expect(scopedValue(step, after, { kind: 'none' })).toEqual({ kind: 'none' });
    // 同じ番号の間は残る
    expect(scopedValue(skip, before, false)).toBe(true);
  });
});

describe('表示（design-3 §4.4）', () => {
  it('特権の残りの札は1個以上のときだけ', () => {
    expect(abilityPlate(2)).toBe('特権 2');
    expect(abilityPlate(0)).toBe(null);
    expect(abilityPlate(null)).toBe(null);
  });

  it('透視で見たカードの表記（10 を含む、ジョーカー）', () => {
    expect(peekLabels(['spade-13', 'heart-3', 'diamond-10', 'joker-0'])).toEqual(['♠K', '♥3', '♦10', 'ジョーカー']);
  });

  it('暗いカードの理由に「独裁で封じられている」', () => {
    const m = turn({ plays: [lp(['spade-9'], 9)] });
    expect(dimReason(m, m.plays, [], 'heart-7', null, { ban: 7 as never })).toBe('ban');
    expect(DIM_REASON_TEXT.ban).toBe('独裁で封じられている');
    // 封じられていない数字はその2までと同じ
    expect(dimReason(m, m.plays, [], 'heart-5', null, { ban: 7 as never })).toBe('weaker');
    // 特権の選択中は自分の番ではない
    expect(dimReason({ awaitId: 1, kind: 'abilitySelect', slots: 1, draft: [] }, [], [], 'heart-5', null)).toBe('notYourTurn');
  });

  it('特権の名前と説明の表は6種', () => {
    expect(Object.keys(ABILITY_TEXT).sort()).toEqual(['ban', 'forceFlush', 'peek', 'revolution', 'skip', 'steal']);
    expect(ABILITY_TEXT.forceFlush.name).toBe('強制流し');
  });
});

describe('メッセージ（design-3 §4.5）', () => {
  it('特権の確定と使用', () => {
    expect(eventMessage(ev({ type: 'abilitySelectStart', seat: 1, slots: 2 }), nameOf, 0)).toBe(null);
    expect(eventMessage(ev({ type: 'abilitiesChosen', seat: 1, count: 2, abilities: null }), nameOf, 0)).toBe('たろう が 特権を 2個 選んだ');
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'peek', target: 2 }), nameOf, 0)).toBe('たろう が ゆい に 透視を使った');
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'peek', target: 0, cards: ['spade-3', 'heart-9'] }), nameOf, 0)).toBe('たろう に 2枚 見られた');
    expect(eventMessage(ev({ type: 'ability', seat: 0, ability: 'peek', target: 2, cards: ['spade-3', 'heart-9', 'club-4'] }), nameOf, 0)).toBe('あなた が ゆい に 透視を使った');
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'steal', target: 2 }), nameOf, 0)).toBe('たろう が ゆい に 強奪を使った');
    expect(eventMessage(ev({ type: 'ability', seat: 0, ability: 'steal', target: 2, given: 'spade-3', taken: 'heart-13' }), nameOf, 0)).toBe('♠3 を渡して ♥K を受け取った');
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'steal', target: 0, given: 'spade-3', taken: 'heart-13' }), nameOf, 0)).toBe('♥K を取られて ♠3 を受け取った');
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'forceFlush' }), nameOf, 0)).toBe('強制流し！');
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'ban', rank: 7 }), nameOf, 0)).toBe('独裁！ 7 は出せない');
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'ban', rank: 15 }), nameOf, 0)).toBe('独裁！ 2 は出せない');
    // 革命は続く revolution の出来事で出す（二重にしない）
    expect(eventMessage(ev({ type: 'ability', seat: 1, ability: 'revolution' }), nameOf, 0)).toBe(null);
    // 強制流しのあとの場の流れは「強制流し！」と重ねない
    expect(eventMessage(ev({ type: 'fieldCleared', reason: 'forceFlush', leader: 1 }), nameOf, 0)).toBe(null);
  });

  it('1回の state の列：革命は1行、強制流しは1行、スキップは「スキップ！ △△ を飛ばした」の1行', () => {
    const rev = eventLines([ev({ type: 'ability', seat: 1, ability: 'revolution' }, 1), ev({ type: 'revolution', active: true }, 2)], nameOf, 0);
    expect(rev).toEqual(['革命！']);
    const ff = eventLines([ev({ type: 'ability', seat: 1, ability: 'forceFlush' }, 1), ev({ type: 'fieldCleared', reason: 'forceFlush', leader: 1 }, 2)], nameOf, 0);
    expect(ff).toEqual(['強制流し！']);
    const sk = eventLines(
      [
        ev({ type: 'play', seat: 1, play: g(['spade-5'], 5), foul: false }, 1),
        ev({ type: 'ability', seat: 1, ability: 'skip' }, 2),
        ev({ type: 'skipped', by: 1, seats: [2] }, 3),
      ],
      nameOf,
      0,
    );
    expect(sk).toEqual(['たろう が 5を1枚 出した', 'スキップ！ ゆい を飛ばした']);
    // K スキップだけなら、その2のまま
    expect(eventLines([ev({ type: 'skipped', by: 1, seats: [2, 3] }, 1)], nameOf, 0)).toEqual(['K スキップ！ ゆい・CPU 4 を飛ばした']);
    // 飛ばす人がいなかったスキップ
    expect(eventLines([ev({ type: 'ability', seat: 1, ability: 'skip' }, 1)], nameOf, 0)).toEqual(['スキップ！']);
  });

  it('拒否の文言', () => {
    expect(errorText({ code: 'actionRejected', engineError: 'cannotSkip' })).toBe('この手には スキップを付けられません');
    expect(errorText({ code: 'actionRejected', engineError: 'abilityNotUsable' })).toBe('いまは その特権を使えない');
    expect(errorText({ code: 'actionRejected', engineError: 'invalidAbility' })).toBe('その特権は使えない');
  });
});
