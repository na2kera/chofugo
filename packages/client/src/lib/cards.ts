// カードの表示用の道具（読み上げの名前、数字の表記、手の短い説明）。
// ゲームの判定はしない。engine の型と cardOf だけを使う。

import { cardOf, type CardId, type Play, type Rank, type Suit } from '@chofugo/engine';

export type RankKey = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/** engine の数字（3〜15）から表示の文字へ。 */
export function rankKey(rank: Rank): RankKey {
  switch (rank) {
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    case 14:
      return 'A';
    case 15:
      return '2';
    default:
      return String(rank) as RankKey;
  }
}

export const SUIT_NAME: Record<Suit, string> = {
  spade: 'スペード',
  heart: 'ハート',
  diamond: 'ダイヤ',
  club: 'クラブ',
};

export const SUIT_MARK: Record<Suit, string> = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
};

export function isRedSuit(suit: Suit): boolean {
  return suit === 'heart' || suit === 'diamond';
}

export type CardFace =
  | { kind: 'normal'; suit: Suit; rank: Rank; key: RankKey }
  | { kind: 'joker' };

export function faceOf(id: CardId): CardFace | null {
  const c = cardOf(id);
  if (c === null) return null;
  if (c.kind === 'joker') return { kind: 'joker' };
  return { kind: 'normal', suit: c.suit, rank: c.rank, key: rankKey(c.rank) };
}

/** 読み上げ用の名前（「スペードの9」「ジョーカー」）。 */
export function cardLabel(id: CardId): string {
  const f = faceOf(id);
  if (f === null) return 'カード';
  if (f.kind === 'joker') return 'ジョーカー';
  return `${SUIT_NAME[f.suit]}の${f.key}`;
}

/** 1枚の短い表記（「♠K」「♥10」「ジョーカー」）。透視で見たカードや強奪のメッセージに使う（design-3 §4.4、§4.5）。 */
export function cardShort(id: CardId): string {
  const f = faceOf(id);
  if (f === null) return '?';
  if (f.kind === 'joker') return 'ジョーカー';
  return `${SUIT_MARK[f.suit]}${f.key}`;
}

/** 場のジョーカーが何の代わりかの短い表記（「7」「♠6」）。決まっていなければ null。 */
export function jokerStandIn(play: Play, card: CardId): string | null {
  const j = play.jokers.find((x) => x.card === card);
  if (j === undefined || j.rank === null) return null;
  const r = rankKey(j.rank);
  return j.suit === null || play.shape === 'group' ? r : `${SUIT_MARK[j.suit]}${r}`;
}

/** 手の短い説明。組は「9を2枚」、ジョーカーだけの組は「ジョーカーを2枚」、階段は「♠5〜7の階段」。 */
export function playSummary(play: Play): string {
  if (play.shape === 'run') return `${SUIT_MARK[play.suit]}${rankKey(play.low)}〜${rankKey(play.high)}の階段`;
  const n = play.cards.length;
  if (play.rank === null) return `ジョーカーを${n}枚`;
  return `${rankKey(play.rank)}を${n}枚`;
}

/** 形の2択のボタンの文言（「5の3枚組」「♠5〜7の階段」）。 */
export function shapeChoiceLabel(play: Play): string {
  if (play.shape === 'run') return `${SUIT_MARK[play.suit]}${rankKey(play.low)}〜${rankKey(play.high)}の階段`;
  const n = play.cards.length;
  const r = play.rank === null ? 'ジョーカー' : rankKey(play.rank);
  return n === 1 ? `${r}の1枚出し` : `${r}の${n}枚組`;
}

export const PLACE_TITLE: Record<1 | 2 | 3 | 4, string> = {
  1: '大富豪',
  2: '富豪',
  3: '貧民',
  4: '大貧民',
};
