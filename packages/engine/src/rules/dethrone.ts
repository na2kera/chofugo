// 都落ち（decisions §4.1、§14.2）。前の大富豪以外が1位に確定した瞬間、前の大富豪は最下位になる。

import { SEATS } from '../types.ts';
import type { RuleModule } from './types.ts';

export const dethrone: RuleModule = {
  id: 'dethrone',
  onFirstPlace(ctx, seat) {
    const prev = ctx.state.prevRanks;
    if (prev === null) return [];
    const king = SEATS.find((s) => prev[s] === 1);
    if (king === undefined || king === seat || !ctx.isActive(king)) return [];
    return [{ type: 'forceLast', seat: king, reason: 'dethrone' }];
  },
};
