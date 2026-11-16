// K スキップ（decisions §6.15、§14.8、design-2 §2.4）。K の組を出すと、出した枚数ぶんの人数を飛ばす。上がる手でも起きる。

import type { RuleModule } from './types.ts';

export const skipOnK: RuleModule = {
  id: 'skip_on_k',
  afterPlay(_ctx, played) {
    const p = played.play;
    if (played.via !== 'turn' || p.shape !== 'group' || p.rank !== 13) return [];
    return [{ type: 'skip', count: p.cards.length }];
  },
};
