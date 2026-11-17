// 禁止上がり（decisions §6.9、§14.4）。

import type { RuleModule } from './types.ts';
import { isEightGroup } from './flush_on_8.ts';
import { isSandstorm } from './triple3_trump.ts';
import { isRealGroup } from './roles.ts';
import type { RuleId } from '../types.ts';

/** 役のルールと、その手（数字・枚数）。ON の役に当たる手は反則上がりにしない（decisions §15.1、§15.9）。 */
const ROLES: readonly { rule: RuleId; rank: number; count: number }[] = [
  { rule: 'triple6_revolution', rank: 6, count: 3 },
  { rule: 'triple4_purge', rank: 4, count: 3 },
  { rule: 'triple9_salvage', rank: 9, count: 3 },
  { rule: 'triple_a_trade', rank: 14, count: 3 },
  { rule: 'quad2_instant_win', rank: 15, count: 4 },
];

export const forbiddenFinish: RuleModule = {
  id: 'forbidden_finish',
  isFoulFinish(ctx, play) {
    // 役で上がっても反則にならない（第2段階。判定のいちばん上に置く）
    if (ROLES.some((r) => ctx.isOn(r.rule) && isRealGroup(play, r.rank, r.count))) return false;
    // 砂嵐で上がっても反則にならない（§6.12。強さが逆のとき、3は「いちばん強い数字」に当たるため）
    if (ctx.isOn('triple3_trump') && isSandstorm(play)) return false;
    // ジョーカーを含む手（1枚出し、組、階段のどれでも）
    if (play.jokers.length > 0) return true;
    // その時点でいちばん強い数字の組（出す直前の向きで決める）
    const strongest = ctx.reversed ? 3 : 15;
    if (play.shape === 'group' && play.rank === strongest) return true;
    // 8の組（8切りが ON のとき）
    if (ctx.isOn('flush_on_8') && isEightGroup(play)) return true;
    return false;
  },
};
