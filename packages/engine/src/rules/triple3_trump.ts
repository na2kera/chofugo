// 砂嵐（decisions §6.12、§14.8、§16.3、design-2 §2.4）。
// 本物の3がちょうど3枚の組は、場に関係なく出せて、出すとすぐ場が流れる。

import { cardOf, type CardId } from '../cards.ts';
import type { Play } from '../types.ts';
import type { RuleModule } from './types.ts';

/** 砂嵐の手か（本物の3がちょうど3枚の組。ジョーカーなし）。 */
export function isSandstorm(play: Play): boolean {
  return play.shape === 'group' && play.rank === 3 && play.cards.length === 3 && play.jokers.length === 0;
}

function realThrees(hand: readonly CardId[]): CardId[] {
  return hand.filter((id) => {
    const c = cardOf(id);
    return c !== null && c.kind === 'normal' && c.rank === 3;
  });
}

export const triple3Trump: RuleModule = {
  id: 'triple3_trump',
  mayFlush: (_ctx, play) => isSandstorm(play),
  extraSets(ctx, seat) {
    const threes = realThrees(ctx.game.hands[seat] ?? []);
    const out: CardId[][] = [];
    for (let i = 0; i < threes.length; i++)
      for (let j = i + 1; j < threes.length; j++)
        for (let k = j + 1; k < threes.length; k++) out.push([threes[i]!, threes[j]!, threes[k]!]);
    return out;
  },
  playIgnores(_ctx, play) {
    // 場の種類・枚数・強さ、マーク縛り、激縛りを無視する。ダイヤの3の義務（とその3の独裁）は守る
    return isSandstorm(play) ? ['fieldShape', 'fieldSize', 'notStronger', 'suitLock', 'sequenceLock'] : [];
  },
  afterPlay(_ctx, played) {
    if (played.via !== 'turn' || !isSandstorm(played.play)) return [];
    return [{ type: 'flush', leader: played.seat, reason: 'triple3_trump' }];
  },
};
