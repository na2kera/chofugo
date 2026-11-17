// 6戻し（decisions §15.3、§19.2、design-4 §2.4）。J バック中に6の組を出すと、J バックが解除される。

import { isTurnNumberGroup } from './roles.ts';
import type { RuleModule } from './types.ts';

export const cancelReverseOn6: RuleModule = {
  id: 'cancel_reverse_on_6',
  requires: ['temp_reverse_on_j'],
  afterPlay(ctx, played) {
    if (!ctx.game.tempReverse || !isTurnNumberGroup(played, 6)) return [];
    return [{ type: 'setTempReverse', active: false, rule: 'cancel_reverse_on_6' }];
  },
};
