// ダイヤの3スタート（decisions §6.11、§16.3、design-2 §2.4）。
// 毎ゲーム、ダイヤの3を持つ人が親になり、最初の1手には必ずダイヤの3を含める。

import { SEATS } from '../types.ts';
import type { RuleModule } from './types.ts';

const DIAMOND3 = 'diamond-3';

export const diamond3Start: RuleModule = {
  id: 'diamond3_start',
  leaderRule: 'diamond3',
  chooseStarter(ctx) {
    return SEATS.find((s) => (ctx.game.hands[s] ?? []).includes(DIAMOND3)) ?? null;
  },
  openingCard: () => DIAMOND3,
  restrictPlay(ctx, play) {
    const card = ctx.game.openingCard;
    if (card === null || play.cards.includes(card)) return null;
    return { kind: 'openingCard' };
  },
  afterPlay(ctx) {
    // 最初の1手で義務を外す
    return ctx.game.openingCard !== null ? [{ type: 'clearOpening' }] : [];
  },
};
