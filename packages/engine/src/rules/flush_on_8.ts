// 8切り（decisions §6.1）。8の組を出すと場が流れ、出した人が親になる。

import type { Play } from '../types.ts';
import type { RuleModule } from './types.ts';

/** 8の組か（ジョーカーを混ぜた組を含む。階段とジョーカーの1枚出しは含まない、§6.0.1）。 */
export function isEightGroup(play: Play): boolean {
  return play.shape === 'group' && play.rank === 8;
}

export const flushOn8: RuleModule = {
  id: 'flush_on_8',
  mayFlush: (_ctx, play) => isEightGroup(play),
  afterPlay(_ctx, played) {
    if (!isEightGroup(played.play)) return [];
    return [{ type: 'flush', leader: played.seat, reason: 'flush_on_8' }];
  },
};
