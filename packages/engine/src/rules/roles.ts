// 役の判定の共通の道具（decisions §15.1、design-4 §2.2）。
// 役 = オーメン・DEATH・銀河鉄道・闇市（本物の3枚組）と大革命（本物の4枚組）。

import { cardOf } from '../cards.ts';
import type { Color, FieldPlay, Play } from '../types.ts';

/** 組で、数字が rank、枚数がちょうど count、ジョーカーなしか。 */
export function isRealGroup(play: Play, rank: number, count: number): boolean {
  return play.shape === 'group' && play.rank === rank && play.cards.length === count && play.jokers.length === 0;
}

/** 手番で出した、役の組か（返しの一周の手では発動しない）。 */
export function isTurnRole(played: FieldPlay, rank: number, count: number): boolean {
  return played.via === 'turn' && isRealGroup(played.play, rank, count);
}

/** 数字の効果（5色縛り・6戻し・Q ボンバー）の発動条件: 手番で出した、その数字の組（ジョーカーを混ぜてもよい。階段とジョーカーだけの手は除く）。 */
export function isTurnNumberGroup(played: FieldPlay, rank: number): boolean {
  return played.via === 'turn' && played.play.shape === 'group' && played.play.rank === rank;
}

/** 本物のカードの色（ジョーカーは null）。 */
export function colorOf(id: string): Color | null {
  const c = cardOf(id);
  if (c === null || c.kind === 'joker') return null;
  return c.suit === 'heart' || c.suit === 'diamond' ? 'red' : 'black';
}
