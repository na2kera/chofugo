// 7渡し・10捨ての選び方（design-2 §4.2）と、7渡しで受け取ったカードの強調（design-2 §6.3）。
// 選べるのは手札のどのカードでも、上限（出した枚数）まで。0枚でもよい（渡さない・捨てない）。

import type { CardId, MyAwaiting, SeatId, VisibleEvent } from '@chofugo/engine';

export type ChoiceTask = Extract<MyAwaiting, { kind: 'choice' }>;

/** 7渡しか（それ以外は10捨て）。 */
export function isGive(task: Pick<ChoiceTask, 'rule'>): boolean {
  return task.rule === 'give_on_7';
}

/**
 * カードを押したときの選び直し。選んでいれば外す。上限に達しているときに別のカードを押すと、
 * いちばん前に選んだカードと入れ替える（交換の選び方と同じ、client-assumptions C2）。手札にないカードは null。
 */
export function toggleChoice(task: Pick<ChoiceTask, 'max'>, hand: readonly CardId[], picked: readonly CardId[], card: CardId): CardId[] | null {
  if (!hand.includes(card)) return null;
  const cur = picked.filter((x) => hand.includes(x));
  if (cur.includes(card)) return cur.filter((x) => x !== card);
  if (task.max <= 0) return null;
  const next = [...cur, card];
  return next.length > task.max ? next.slice(next.length - task.max) : next;
}

/** 送るカード（手札にあるものだけ、上限まで）。 */
export function choiceCards(task: Pick<ChoiceTask, 'max'>, hand: readonly CardId[], picked: readonly CardId[]): CardId[] {
  return picked.filter((x) => hand.includes(x)).slice(0, Math.max(0, task.max));
}

/** 選ぶ人のメッセージの欄の1行。 */
export function choicePrompt(task: Pick<ChoiceTask, 'rule' | 'max'>): string {
  return isGive(task) ? `次の人に渡すカードを${task.max}枚まで選べます` : `捨てるカードを${task.max}枚まで選べます`;
}

/** ボタンの文言。左は「渡さない」「捨てない」、右は「◯枚を渡す」「◯枚を捨てる」（0枚のときは押せない）。 */
export function choiceButtons(task: Pick<ChoiceTask, 'rule'>, count: number): { skip: string; send: string } {
  const verb = isGive(task) ? '渡す' : '捨てる';
  return { skip: isGive(task) ? '渡さない' : '捨てない', send: count > 0 ? `${count}枚を${verb}` : verb };
}

// ---------- 7渡しで受け取ったカードの強調（design-2 §6.3） ----------

/** 強調しているカード。交換で受け取ったカード（myExchange.received）とは別に持つ。 */
export type Gift = { matchId: string | null; gameNo: number | null; cards: CardId[] } | null;

export type GiftInput = {
  matchId: string | null;
  gameNo: number | null;
  me: SeatId | null;
  /** 新しく届いた出来事（eventsFull のときは空）。 */
  fresh: readonly VisibleEvent[];
  eventsFull: boolean;
  /** 届いた state の自分の手札。 */
  hand: readonly CardId[];
  /** 自分が送った操作の返事を待っている間に、この state が届いた（＝操作が受理された）。 */
  ownActionAccepted: boolean;
};

/**
 * 次の強調。
 * - 自分が受け取る側の give を受け取ったら、そのカードを足す（複数回なら足していく）。
 * - 消す：自分の操作が受理された、ゲーム（試合）が変わった、復帰した直後（eventsFull。復元しない）。
 * - 強調中のカードが手札からなくなったら、そのカードを外す。
 * - 拒否されたとき・時間切れで自動的に進んだときは消さない（その state では ownActionAccepted が偽）。
 */
export function nextGift(prev: Gift, x: GiftInput): Gift {
  let cards = prev !== null && prev.matchId === x.matchId && prev.gameNo === x.gameNo ? prev.cards : [];
  if (x.eventsFull || x.ownActionAccepted) cards = [];
  if (!x.eventsFull && x.me !== null) {
    for (const e of x.fresh) {
      if (e.type === 'give' && e.to === x.me && e.cards !== null && e.gameNo === x.gameNo) cards = [...cards, ...e.cards.filter((c) => !cards.includes(c))];
    }
  }
  cards = cards.filter((c) => x.hand.includes(c));
  if (cards.length === 0) return null;
  return { matchId: x.matchId, gameNo: x.gameNo, cards };
}
