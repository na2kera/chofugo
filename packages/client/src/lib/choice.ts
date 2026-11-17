// 選択の待ち（choice）の選び方。7渡し・10捨て（design-2 §4.2）、銀河鉄道・闇市・Q ボンバー（design-4 §4.2）。
// 受け取ったカードの強調（7渡し design-2 §6.3、銀河鉄道・闇市 design-4 §4.2）もここに置く。
// - 7渡し・10捨て・銀河鉄道：手札のどのカードでも、上限まで。0枚でもよい（渡さない・捨てない・交換しない）。
// - 闇市：相手を選び、ちょうど min(上限, 相手の手札) 枚を選ぶ。使わないこともできる。
// - Q ボンバー：カードは選ばない。数字（3〜2 とジョーカー）を上限の個数まで選ぶ。

import { RANKS, RULE_MODULES, type CallRank, type CardId, type ChoiceKind, type MyAwaiting, type RuleId, type SeatId, type VisibleEvent } from '@chofugo/engine';
import { rankKey } from './cards.ts';

export type ChoiceTask = Extract<MyAwaiting, { kind: 'choice' }>;

/** 選択の種類（engine のモジュールの choiceKind。見つからなければ10捨てと同じ扱い）。 */
export function choiceKindOf(rule: RuleId): ChoiceKind {
  return RULE_MODULES.find((m) => m.id === rule)?.choiceKind ?? 'discard';
}

/** 7渡しか。 */
export function isGive(task: Pick<ChoiceTask, 'rule'>): boolean {
  return choiceKindOf(task.rule) === 'give';
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

/**
 * 選ぶ人のメッセージの欄の1行。null なら案内を出さない（直前のメッセージのまま）。
 * 闇市は相手を選んだあと（tradeCount が決まったあと）だけ「渡すカードを◯枚選んでください」。
 * 闇市で相手を選ぶ前と Q ボンバーは、場の位置の枠の見出しで分かるので出さない（client-assumptions J5）。
 */
export function choicePrompt(task: Pick<ChoiceTask, 'rule' | 'max'>, tradeN: number | null = null): string | null {
  switch (choiceKindOf(task.rule)) {
    case 'give':
      return `次の人に渡すカードを${task.max}枚まで選べます`;
    case 'discard':
      return `捨てるカードを${task.max}枚まで選べます`;
    case 'salvage':
      // 設計の「捨て札と交換するカードを◯枚まで選べます」は幅 360px のメッセージの欄（1行）に入らないので「捨て札と」を省く（client-assumptions J4）
      return `交換するカードを${task.max}枚まで選べます`;
    case 'trade':
      return tradeN === null ? null : `渡すカードを${tradeN}枚選んでください`;
    case 'call':
      return null;
  }
}

/**
 * ボタンの文言。左は「渡さない」「捨てない」「交換しない」「使わない」「宣言しない」、
 * 右は「◯枚を渡す」「◯枚を捨てる」「◯枚を交換」「宣言する」（0枚のときは枚数を出さない）。
 */
export function choiceButtons(task: Pick<ChoiceTask, 'rule'>, count: number): { skip: string; send: string } {
  switch (choiceKindOf(task.rule)) {
    case 'give':
      return { skip: '渡さない', send: count > 0 ? `${count}枚を渡す` : '渡す' };
    case 'discard':
      return { skip: '捨てない', send: count > 0 ? `${count}枚を捨てる` : '捨てる' };
    case 'salvage':
      return { skip: '交換しない', send: count > 0 ? `${count}枚を交換` : '交換' };
    case 'trade':
      return { skip: '使わない', send: count > 0 ? `${count}枚を交換` : '交換' };
    case 'call':
      return { skip: '宣言しない', send: '宣言する' };
  }
}

// ---------- 闇市（design-4 §4.2） ----------

/** 渡す枚数（ちょうど）。相手を選ぶまでは null。上限（min(2, 自分の手札)）と相手の手札の少ないほう。 */
export function tradeCount(task: Pick<ChoiceTask, 'max'>, handCounts: readonly number[], target: SeatId | null): number | null {
  if (target === null) return null;
  return Math.max(0, Math.min(task.max, handCounts[target] ?? 0));
}

/** 闇市の枠の見出し。 */
export const TRADE_PROMPT = '闇市：相手を選ぶ';

/** 相手のボタンの残り枚数の表記。 */
export function tradeTargetCount(n: number): string {
  return `${n}枚`;
}

/**
 * 相手を選んだ（変えた）ときの、選んでいるカード。枚数が減ったら、あとから選んだカードを残す。
 * 相手を外したとき（null）はそのまま。
 */
export function trimForTrade(picked: readonly CardId[], n: number | null): CardId[] {
  if (n === null) return picked.slice();
  return n <= 0 ? [] : picked.slice(Math.max(0, picked.length - n));
}

/** 相手を選び、手札にあるカードをちょうど n 枚選んでいるか（「◯枚を交換」を押せるか）。 */
export function tradeReady(task: Pick<ChoiceTask, 'max'>, hand: readonly CardId[], picked: readonly CardId[], handCounts: readonly number[], target: SeatId | null): boolean {
  const n = tradeCount(task, handCounts, target);
  if (n === null || n <= 0) return false;
  return picked.filter((x) => hand.includes(x)).length === n;
}

/**
 * 闇市の相手・Q ボンバーの数字のボタンの枠。選んでいるときは金の塗り（「N枚を出す」と同じ `btn`）、
 * ふだんは金の線の枠（`btn2`）。特権のスキップの ON（abilityBarFrame）と同じ見分け方（client-assumptions J5・J6）。
 */
export function pickFrame(on: boolean): 'btn' | 'btn2' {
  return on ? 'btn' : 'btn2';
}

// ---------- Q ボンバー（design-4 §4.2） ----------

/** 宣言できるもの（3〜2 の13個とジョーカー）の並び。 */
export const CALL_RANKS: readonly CallRank[] = [...RANKS, 'joker'];

/** ボタン・メッセージの表記（数字は「7」「K」、ジョーカーは「JOKER」）。 */
export function callLabel(r: CallRank): string {
  return r === 'joker' ? 'JOKER' : rankKey(r);
}

/** Q ボンバーの枠の見出し。 */
export function callPrompt(max: number): string {
  return `Q ボンバー：数字を${max}個まで宣言`;
}

/** 数字を押したとき。選んでいれば外す。上限を超えたら、いちばん前に選んだものと入れ替える。上限が0なら変えない。 */
export function toggleCall(max: number, picked: readonly CallRank[], r: CallRank): CallRank[] {
  if (picked.includes(r)) return picked.filter((x) => x !== r);
  if (max <= 0) return picked.slice();
  const next = [...picked, r];
  return next.length > max ? next.slice(next.length - max) : next;
}

// ---------- 送る内容 ----------

export type ChooseBody = { cards: CardId[]; target?: SeatId; ranks?: CallRank[] };

export type ChooseInput = {
  hand: readonly CardId[];
  /** 選んでいるカード（Q ボンバーでは使わない）。 */
  picked: readonly CardId[];
  handCounts: readonly number[];
  /** 闇市の相手。 */
  target: SeatId | null;
  /** Q ボンバーで選んだ数字。 */
  ranks: readonly CallRank[];
};

/**
 * 右のボタンで送る内容。押せないとき（0枚・0個・闇市の枚数が合わない）は null。
 * engine は種類に合わない項目を拒否するので、Q ボンバーは cards を空にして ranks だけ、闇市だけ target を付ける。
 */
export function chooseBody(task: Pick<ChoiceTask, 'rule' | 'max'>, x: ChooseInput): ChooseBody | null {
  switch (choiceKindOf(task.rule)) {
    case 'call': {
      const ranks = x.ranks.slice(0, Math.max(0, task.max));
      return ranks.length === 0 ? null : { cards: [], ranks };
    }
    case 'trade': {
      if (x.target === null || !tradeReady(task, x.hand, x.picked, x.handCounts, x.target)) return null;
      return { cards: x.picked.filter((c) => x.hand.includes(c)), target: x.target };
    }
    default: {
      const cards = choiceCards(task, x.hand, x.picked);
      return cards.length === 0 ? null : { cards };
    }
  }
}

/** 左のボタン（選ばない）で送る内容。どの種類でも cards は空、target・ranks は付けない。 */
export const SKIP_CHOOSE_BODY: ChooseBody = { cards: [] };

// ---------- 受け取ったカードの強調（7渡し design-2 §6.3、銀河鉄道・闇市 design-4 §4.2） ----------

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
 * - 銀河鉄道（salvage）で自分が引いたカード（took）、闇市（trade）で自分が受け取ったカード
 *   （使った側は taken、相手の側は given）も同じく足す。使った本人は自分の操作が受理された state で届くが、
 *   消すのを先に、足すのをあとにするので残る。
 * - 消す：自分の操作が受理された、ゲーム（試合）が変わった、復帰した直後（eventsFull。復元しない）。
 * - 強調中のカードが手札からなくなったら、そのカードを外す。
 * - 拒否されたとき・時間切れで自動的に進んだときは消さない（その state では ownActionAccepted が偽）。
 */
export function nextGift(prev: Gift, x: GiftInput): Gift {
  let cards = prev !== null && prev.matchId === x.matchId && prev.gameNo === x.gameNo ? prev.cards : [];
  if (x.eventsFull || x.ownActionAccepted) cards = [];
  if (!x.eventsFull && x.me !== null) {
    for (const e of x.fresh) {
      if (e.gameNo !== x.gameNo) continue;
      let got: readonly CardId[] | null = null;
      if (e.type === 'give' && e.to === x.me) got = e.cards;
      else if (e.type === 'salvage' && e.seat === x.me) got = e.took;
      else if (e.type === 'trade' && e.from === x.me) got = e.taken;
      else if (e.type === 'trade' && e.to === x.me) got = e.given;
      if (got !== null) {
        const add = got;
        cards = [...cards, ...add.filter((c) => !cards.includes(c))];
      }
    }
  }
  cards = cards.filter((c) => x.hand.includes(c));
  if (cards.length === 0) return null;
  return { matchId: x.matchId, gameNo: x.gameNo, cards };
}
