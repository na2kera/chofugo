// 禁止上がり（decisions §6.9、§14.4）。

import type { RuleModule } from './types.ts';
import { isEightGroup } from './flush_on_8.ts';
import { isSandstorm } from './triple3_trump.ts';

export const forbiddenFinish: RuleModule = {
  id: 'forbidden_finish',
  isFoulFinish(ctx, play) {
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
