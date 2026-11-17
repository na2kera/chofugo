// Q ボンバー（decisions §15.8、§19.2、design-4 §2.4）。Q の組を出したら、出した枚数まで数字を宣言でき、全員がその数字のカードをすべて捨てる。

import { isTurnNumberGroup } from './roles.ts';
import type { RuleModule } from './types.ts';

export const callDiscardOnQ: RuleModule = {
  id: 'call_discard_on_q',
  choiceKind: 'call',
  afterPlay(_ctx, played) {
    if (!isTurnNumberGroup(played, 12)) return [];
    return [{ type: 'handChoice', rule: 'call_discard_on_q', max: played.play.cards.length }];
  },
};
