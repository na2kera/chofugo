// 9リバース（decisions §6.14、§14.8、design-2 §2.4）。9の組を出すと、その場が流れるまで手番の順が逆回りになる。

import type { RuleModule } from './types.ts';

export const reverseOrderOn9: RuleModule = {
  id: 'reverse_order_on_9',
  afterPlay(ctx, played) {
    const p = played.play;
    if (played.via !== 'turn' || p.shape !== 'group' || p.rank !== 9) return [];
    if (ctx.game.orderReversed) return []; // 逆回り中にもう一度9が出ても何も変わらない
    return [{ type: 'setOrderReverse', active: true }];
  },
  onFieldCleared(ctx) {
    return ctx.game.orderReversed ? [{ type: 'setOrderReverse', active: false }] : [];
  },
};
