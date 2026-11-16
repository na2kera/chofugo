// J バック（decisions §6.4）。J の組を出すと、その場が流れるまで強さが逆になる。

import type { RuleModule } from './types.ts';

export const tempReverseOnJ: RuleModule = {
  id: 'temp_reverse_on_j',
  afterPlay(ctx, played) {
    const p = played.play;
    if (p.shape !== 'group' || p.rank !== 11) return [];
    if (ctx.game.tempReverse) return []; // J バック中にもう一度 J が出ても何も変わらない
    return [{ type: 'setTempReverse', active: true }];
  },
  onFieldCleared(ctx) {
    return ctx.game.tempReverse ? [{ type: 'setTempReverse', active: false }] : [];
  },
};
