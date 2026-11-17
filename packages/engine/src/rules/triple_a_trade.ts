// 闇市（decisions §15.7、§19.3、design-4 §2.4）。A の本物3枚で、相手を1人選び、自分の2枚と相手のいちばん強い2枚を交換できる。

import { isTurnRole } from './roles.ts';
import type { RuleModule } from './types.ts';

export const tripleATrade: RuleModule = {
  id: 'triple_a_trade',
  choiceKind: 'trade',
  afterPlay(_ctx, played) {
    // 上限は、待ちを作るときに手札の枚数で丸める（game.ts の runEffects）
    return isTurnRole(played, 14, 3) ? [{ type: 'handChoice', rule: 'triple_a_trade', max: 2 }] : [];
  },
};
