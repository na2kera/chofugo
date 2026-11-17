// 大革命（decisions §15.9、§19.1、§19.5、design-4 §2.4、§6.2）。2の本物4枚で、その場で上がり、同時に革命が起きる。

import { isRealGroup, isTurnRole } from './roles.ts';
import type { RuleModule } from './types.ts';

export const quad2InstantWin: RuleModule = {
  id: 'quad2_instant_win',
  // 場が流れる手なので、特権のスキップを付けられない（decisions §19.3）
  mayFlush: (_ctx, play) => isRealGroup(play, 15, 4),
  afterPlay(ctx, played) {
    if (!isTurnRole(played, 15, 4)) return [];
    return [
      // 「革命」が ON のときは、4枚組の革命をそのモジュールが出すので重ねない（§19.1）
      ...(ctx.isOn('revolution') ? [] : [{ type: 'toggleRevolution' as const }]),
      { type: 'instantWin', rule: 'quad2_instant_win' },
      { type: 'flush', leader: played.seat, reason: 'quad2_instant_win' },
    ];
  },
};
