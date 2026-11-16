// カードの基本定義（仕様書 §3.1）。強さの比較やルールは後続ステップで追加する。

export const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;
export type Suit = (typeof SUITS)[number];

/** 3〜13 = 3〜K、14 = A、15 = 2。数値が通常時の強さ順になる。 */
export const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type Rank = (typeof RANKS)[number];

export type Card =
  | { readonly id: string; readonly kind: 'normal'; readonly suit: Suit; readonly rank: Rank }
  | { readonly id: string; readonly kind: 'joker'; readonly index: number };

/** 52枚 + ジョーカー jokerCount 枚のデッキを生成する（MVP は jokerCount = 2）。 */
export function createDeck(jokerCount = 2): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}-${rank}`, kind: 'normal', suit, rank });
    }
  }
  for (let i = 0; i < jokerCount; i++) {
    deck.push({ id: `joker-${i}`, kind: 'joker', index: i });
  }
  return deck;
}

export type CardId = string;

/** 54枚の標準デッキ（engine の中で共有する定数。状態には持たない）。 */
export const STANDARD_DECK: readonly Card[] = createDeck(2);

const CARD_BY_ID: ReadonlyMap<CardId, Card> = new Map(STANDARD_DECK.map((c) => [c.id, c]));

/** カード ID から定義を引く。知らない ID なら null。 */
export function cardOf(id: CardId): Card | null {
  return CARD_BY_ID.get(id) ?? null;
}

export function isJokerId(id: CardId): boolean {
  return cardOf(id)?.kind === 'joker';
}

const SUIT_INDEX: Record<Suit, number> = { spade: 0, heart: 1, diamond: 2, club: 3 };

export function suitIndex(suit: Suit): number {
  return SUIT_INDEX[suit];
}

/**
 * カードの決まった並び順（engine-assumptions.md の「カード ID の並び順」）。
 * 数字の弱い順（通常時）、同じ数字ならマーク順（スペード、ハート、ダイヤ、クラブ）、ジョーカーは最後。
 */
export function cardOrder(id: CardId): number {
  const c = cardOf(id);
  if (c === null) return 10_000;
  if (c.kind === 'joker') return 1000 + c.index;
  return c.rank * 4 + SUIT_INDEX[c.suit];
}

export function compareCardIds(a: CardId, b: CardId): number {
  return cardOrder(a) - cardOrder(b);
}

export function sortCardIds(ids: readonly CardId[]): CardId[] {
  return ids.slice().sort(compareCardIds);
}

/** 通常時の強さ（ジョーカー ＞ 2 ＞ A ＞ … ＞ 3）。交換で使う。 */
export function normalStrength(id: CardId): number {
  const c = cardOf(id);
  if (c === null) return -1;
  return c.kind === 'joker' ? 100 : c.rank;
}

/** 強さの向きを考えた数字の強さ。値が大きいほど強い。 */
export function rankStrength(rank: Rank, reversed: boolean): number {
  return reversed ? 18 - rank : rank;
}
