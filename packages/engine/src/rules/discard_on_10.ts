// 10捨て（decisions §6.13、§16.4、design-2 §2.4）。10の組を出したあと、出した枚数まで手札から捨てられる。

import type { RuleModule } from './types.ts';

export const discardOn10: RuleModule = {
  id: 'discard_on_10',
  choiceTarget: 'discard',
  afterPlay(_ctx, played) {
    const p = played.play;
    if (played.via !== 'turn' || p.shape !== 'group' || p.rank !== 10) return [];
    return [{ type: 'handChoice', rule: 'discard_on_10', max: p.cards.length }];
  },
};
