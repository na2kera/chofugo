// 7渡し（decisions §6.13、§16.4、design-2 §2.4）。7の組を出したあと、出した枚数まで手札から次の人に渡せる。

import type { RuleModule } from './types.ts';

export const giveOn7: RuleModule = {
  id: 'give_on_7',
  choiceTarget: 'give',
  afterPlay(_ctx, played) {
    const p = played.play;
    // 数字の効果は play.rank で判定する（ジョーカーを混ぜた組は発動、ジョーカーだけの手は発動しない。§6.0.1）
    if (played.via !== 'turn' || p.shape !== 'group' || p.rank !== 7) return [];
    return [{ type: 'handChoice', rule: 'give_on_7', max: p.cards.length }];
  },
};
