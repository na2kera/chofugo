// DEATH（decisions §15.5、§19.3、design-4 §2.4）。4の本物3枚で、出した人以外の全員がいちばん強いカードを1枚捨てる。

import { isTurnRole } from './roles.ts';
import type { RuleModule } from './types.ts';

export const triple4Purge: RuleModule = {
  id: 'triple4_purge',
  afterPlay(_ctx, played) {
    return isTurnRole(played, 4, 3) ? [{ type: 'purge', rule: 'triple4_purge' }] : [];
  },
};
