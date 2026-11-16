// カード交換の選び方（design-client §4.4、§7.1）。役割で分ける。
// 下位：強さで決まっている分（forced）は選択済みで外せない。候補（candidates）から choose 枚を選ぶ。
// 上位：手札から count 枚を自由に選ぶ（出せる手の一覧は使わない）。
// 選べる枚数に達しているときに別のカードを押すと、いちばん前に選んだカードと入れ替える。

import type { CardId, MyAwaiting } from '@chofugo/engine';

export type ExchangeTask = Extract<MyAwaiting, { kind: 'exchangeGive' }>;

export type ExchangeSelection = {
  /** 選択済みとして見せるカード（固定の分を含む）。 */
  shown: CardId[];
  /** 外せない（固定の）カード。 */
  locked: Set<CardId>;
  /** 押して選べる・外せるカード（ここにないカードは暗くする）。 */
  selectable: Set<CardId>;
  /** 「渡す」を押せるか。 */
  ready: boolean;
  /** 送るカード。 */
  cards: CardId[];
  /** 本人が選ぶ枚数（下位は choose、上位は count）。 */
  need: number;
};

function pool(task: ExchangeTask, hand: readonly CardId[]): CardId[] {
  if (task.role === 'lower') return task.candidates.filter((c) => !task.forced.includes(c));
  return hand.slice();
}

export function evaluateExchange(task: ExchangeTask, hand: readonly CardId[], picked: readonly CardId[]): ExchangeSelection {
  const locked = new Set(task.role === 'lower' ? task.forced : []);
  const p = pool(task, hand);
  const need = task.role === 'lower' ? task.choose : task.count;
  const chosen = picked.filter((x) => p.includes(x)).slice(-need);
  const cards = [...locked, ...chosen];
  return { shown: cards, locked, selectable: new Set(p), ready: chosen.length === need, cards, need };
}

/** カードを押したときの選び直し。変えられなければ null。 */
export function toggleExchange(task: ExchangeTask, hand: readonly CardId[], picked: readonly CardId[], card: CardId): CardId[] | null {
  const ev = evaluateExchange(task, hand, picked);
  if (ev.locked.has(card) || !ev.selectable.has(card)) return null;
  const chosen = ev.cards.filter((x) => !ev.locked.has(x));
  if (chosen.includes(card)) return chosen.filter((x) => x !== card);
  if (ev.need === 0) return null;
  const next = [...chosen, card];
  return next.length > ev.need ? next.slice(next.length - ev.need) : next;
}

/** 何を何枚選ぶかの1行。 */
export function exchangePrompt(task: ExchangeTask): string {
  if (task.role === 'lower') return `同じ強さのカードから ${task.choose}枚 選んで渡す`;
  return `渡すカードを ${task.count}枚 選ぶ`;
}
