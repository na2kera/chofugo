// 革命（decisions §6.3）。同じ数字の4枚以上の組、または4枚以上の階段で、強さが逆になる。

import type { RuleModule } from './types.ts';

export const revolution: RuleModule = {
  id: 'revolution',
  afterPlay(_ctx, played) {
    const p = played.play;
    const triggers = p.cards.length >= 4 && (p.shape === 'run' || p.rank !== null);
    return triggers ? [{ type: 'toggleRevolution' }] : [];
  },
};
