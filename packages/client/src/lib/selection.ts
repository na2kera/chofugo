// 手の選び方（design-client §4.6、§7.1、§7.5）。
// 出せる手の判定はしない。サーバーから届いた `view.mine.plays`（出せる手の一覧）だけを使う。

import type { CardId, LegalPlay, MyAwaiting, Rank, Suit } from '@chofugo/engine';
import { faceOf } from './cards.ts';

function sameSet(a: readonly CardId[], b: readonly CardId[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function containsAll(play: LegalPlay, cards: readonly CardId[]): boolean {
  const s = new Set(play.cards);
  return cards.every((x) => s.has(x));
}

export type HandSelection = {
  /** 押して選べるカード（選び中のカードは外せるので含む）。 */
  selectable: Set<CardId>;
  /** 選んだカードとちょうど一致する出せる手（組と階段の両方に読めるときは2つ）。 */
  matches: LegalPlay[];
};

/**
 * 選んだカードから、選べるカードと一致する手を決める。
 * 選べるのは「選んだカードにそれを足しても、すべてを含む出せる手が1つでも残る」カード。
 */
export function evaluateSelection(hand: readonly CardId[], plays: readonly LegalPlay[], selected: readonly CardId[]): HandSelection {
  const selectable = new Set<CardId>();
  const alive = plays.filter((p) => containsAll(p, selected));
  for (const id of hand) {
    if (selected.includes(id)) {
      selectable.add(id);
      continue;
    }
    if (alive.some((p) => p.cards.includes(id))) selectable.add(id);
  }
  const matches = selected.length === 0 ? [] : plays.filter((p) => sameSet(p.cards, selected));
  return { selectable, matches };
}

/** カードを押したときの選択。選べないカードなら null（選択は変えない）。 */
export function toggleCard(
  hand: readonly CardId[],
  plays: readonly LegalPlay[],
  selected: readonly CardId[],
  card: CardId,
): CardId[] | null {
  if (selected.includes(card)) return selected.filter((x) => x !== card);
  const { selectable } = evaluateSelection(hand, plays, selected);
  if (!selectable.has(card)) return null;
  return [...selected, card];
}

/** 「出す」を押したあとに必要な手順。 */
export type PlayStep =
  | { kind: 'none' }
  | { kind: 'send'; play: LegalPlay }
  | { kind: 'chooseShape'; options: LegalPlay[] }
  | { kind: 'confirmFoul'; play: LegalPlay };

/** 一致する手から、次に何をするかを決める。形を先に選び、そのあとで反則の確認をする。 */
export function nextPlayStep(matches: readonly LegalPlay[]): PlayStep {
  if (matches.length === 0) return { kind: 'none' };
  const shapes = new Set(matches.map((m) => m.shape));
  if (shapes.size > 1) return { kind: 'chooseShape', options: matches.slice() };
  const play = matches[0]!;
  if (play.foul) return { kind: 'confirmFoul', play };
  return { kind: 'send', play };
}

/** 形を選んだあと。 */
export function afterShapeChosen(play: LegalPlay): PlayStep {
  return play.foul ? { kind: 'confirmFoul', play } : { kind: 'send', play };
}

export type DimReason = 'notYourTurn' | 'suitLock' | 'seqLock' | 'opening' | 'ban' | 'cannotCombine' | 'weaker';

export const DIM_REASON_TEXT: Record<DimReason, string> = {
  notYourTurn: 'いまは自分の番ではない',
  suitLock: '縛りのマークに合わない',
  seqLock: '激縛りの続きに合わない',
  opening: '最初の1手にはダイヤの3が必要',
  ban: '独裁で封じられている',
  cannotCombine: '選んだカードと組み合わせられない',
  weaker: '場のカードより弱いか、枚数・種類が合わない',
};

/**
 * 暗いカードを押したときの理由（design-client §7.5）。画面の側で大まかに決める。
 * - 自分の待ちがない → 自分の番ではない
 * - 何か選んでいて、そのカード単独なら出せる手に含まれる → 組み合わせられない
 * - 手番で、ダイヤの3の義務がある → 最初の1手にはダイヤの3が必要（design-2 §4.5）
 * - 独裁で封じられた数字のカード → 独裁で封じられている（design-3 §4.4。返しの一周でも同じ）
 * - 手番で、激縛りが発動している → 激縛りの続きに合わない（design-2 §4.5）
 * - 縛りがあり、そのカードのマークが縛りのマークにない → 縛りに合わない
 * - それ以外 → 弱いか、枚数・種類が合わない
 * extra はその2で足した状態（省略すると、その1と同じ判定）。
 */
export function dimReason(
  mine: MyAwaiting | null,
  plays: readonly LegalPlay[],
  selected: readonly CardId[],
  card: CardId,
  suitLock: readonly Suit[] | null,
  extra: { seqLock?: { suits: Suit[]; rank: Rank } | null; openingCard?: CardId | null; ban?: Rank | null } = {},
): DimReason {
  if (mine === null || mine.kind === 'exchangeGive' || mine.kind === 'choice' || mine.kind === 'abilitySelect') return 'notYourTurn';
  if (selected.length > 0 && plays.some((p) => p.cards.includes(card))) return 'cannotCombine';
  if (mine.kind === 'turn' && (extra.openingCard ?? null) !== null && card !== extra.openingCard) return 'opening';
  const f = faceOf(card);
  if ((extra.ban ?? null) !== null && f !== null && f.kind === 'normal' && f.rank === extra.ban) return 'ban';
  if (mine.kind === 'turn' && (extra.seqLock ?? null) !== null) return 'seqLock';
  // 4止めの返しは縛りを無視するので、縛りを理由にしない
  if (mine.kind === 'respond' && mine.rule === 'block_flush_with_4') return 'weaker';
  if (suitLock !== null && f !== null && f.kind === 'normal' && !suitLock.includes(f.suit)) return 'suitLock';
  return 'weaker';
}

/**
 * 返しの一周の最初の選択（design-2 §4.3）。返せる組み合わせが1つだけなら、はじめから選んだ状態にする。
 * 2つ以上（4を3枚以上持っている4止め）なら、手札の4から2枚を選ばせる（空から始める）。
 */
export function initialRespondSelection(mine: MyAwaiting | null): CardId[] {
  if (mine === null || mine.kind !== 'respond' || mine.plays.length !== 1) return [];
  return mine.plays[0]!.cards.slice();
}

/** 選択と確認の寿命の鍵（design-client §7.1）。試合・ゲーム・待ちのどれかが変わったら別の鍵になる。 */
export function selectionKey(matchId: string | null, gameNo: number | null, awaitId: number | null): string {
  return `${matchId ?? '-'}:${gameNo ?? '-'}:${awaitId ?? '-'}`;
}

export type Scoped<T> = { key: string; value: T };

/** 鍵が変わっていたら初期値に戻す。 */
export function scopedValue<T>(s: Scoped<T>, key: string, initial: T): T {
  return s.key === key ? s.value : initial;
}
