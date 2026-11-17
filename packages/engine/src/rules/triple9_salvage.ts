// 銀河鉄道（decisions §15.6、§19.3、design-4 §2.4）。9の本物3枚で、手札を2枚まで捨て札に置き、同じ枚数を捨て札から受け取る。

import { isTurnRole } from './roles.ts';
import type { RuleModule } from './types.ts';

export const triple9Salvage: RuleModule = {
  id: 'triple9_salvage',
  choiceKind: 'salvage',
  afterPlay(_ctx, played) {
    // 上限は、待ちを作るときに手札と捨て札の枚数で丸める（game.ts の runEffects）
    return isTurnRole(played, 9, 3) ? [{ type: 'handChoice', rule: 'triple9_salvage', max: 2 }] : [];
  },
};
