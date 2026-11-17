// 5色縛り（decisions §15.2、§19.2、design-4 §2.4）。
// 5の組を出すと、その場が流れるまで、出した5と同じ色（赤か黒）のカードしか出せない。

import type { Color } from '../types.ts';
import { colorOf, isTurnNumberGroup } from './roles.ts';
import type { RuleModule } from './types.ts';

export const colorLockOn5: RuleModule = {
  id: 'color_lock_on_5',
  restrictPlay(ctx, play) {
    const lock = ctx.game.colorLock;
    if (lock === null) return null;
    // 組も階段も、本物のカードがすべてその色であること。ジョーカーはどちらの色としても出せる
    for (const id of play.cards) {
      const col = colorOf(id);
      if (col !== null && col !== lock) return { kind: 'colorLock' };
    }
    return null;
  },
  afterPlay(ctx, played) {
    if (ctx.game.colorLock !== null || !isTurnNumberGroup(played, 5)) return [];
    // 本物の5の色だけで決める（ジョーカーは色を持たない）。すべて同じ色のときだけ成立
    const colors = played.play.cards.map(colorOf).filter((x): x is Color => x !== null);
    const first = colors[0];
    if (first === undefined || colors.some((x) => x !== first)) return [];
    return [{ type: 'setColorLock', color: first }];
  },
  onFieldCleared(ctx) {
    return ctx.game.colorLock !== null ? [{ type: 'clearColorLock' }] : [];
  },
};
