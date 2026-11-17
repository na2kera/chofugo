// オーメン（decisions §15.4、§19.1、design-4 §2.4）。6の本物3枚で革命が起きる。「革命」が OFF でも単独で働く。

import { isTurnRole } from './roles.ts';
import type { RuleModule } from './types.ts';

export const triple6Revolution: RuleModule = {
  id: 'triple6_revolution',
  afterPlay(_ctx, played) {
    return isTurnRole(played, 6, 3) ? [{ type: 'toggleRevolution', rule: 'triple6_revolution' }] : [];
  },
};
