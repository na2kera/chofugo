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
