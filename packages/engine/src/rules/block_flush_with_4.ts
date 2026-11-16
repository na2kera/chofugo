// 4止め（decisions §6.2、§14.7、§16.2、design-2 §2.4）。
// 8切りが起きたとき、返しの一周で本物の4の2枚を出すと8切りを止める。4の2枚は捨て札に置き、8は場に残る。

import { cardOf, type CardId } from '../cards.ts';
import type { Play } from '../types.ts';
import { isEightGroup } from './flush_on_8.ts';
import type { RuleCtx, RuleModule } from './types.ts';

const FOURS: readonly CardId[] = ['spade-4', 'heart-4', 'diamond-4', 'club-4'];

/** 省く条件: 本物の4が、捨て札と場に合わせて3枚以上見えている（§6.2、§16.2）。 */
function cannotBeReturned(ctx: RuleCtx): boolean {
  return FOURS.filter((id) => ctx.isPublic(id)).length >= 3;
}

function isRealFour(id: CardId): boolean {
  const c = cardOf(id);
  return c !== null && c.kind === 'normal' && c.rank === 4;
}

export const blockFlushWith4: RuleModule = {
  id: 'block_flush_with_4',
  requires: ['flush_on_8'],
  afterPlay(ctx, played) {
    if (played.via !== 'turn' || !isEightGroup(played.play)) return [];
    if (cannotBeReturned(ctx)) return [];
    // 8切りの flush は flush_on_8 が返す。列は returnRound → flush の順になる
    return [{ type: 'returnRound', rule: 'block_flush_with_4' }];
  },
  canStartReturnRound(ctx) {
    return !cannotBeReturned(ctx);
  },
  // 省いたときは何も足さない（残りの flush がそのまま処理される）
  onReturnRoundSkipped: () => [],
  returnIgnores: ['suitLock', 'sequenceLock', 'fieldShape', 'fieldSize', 'notStronger', 'passed'],
  returnToDiscard: true,
  returnOptions(ctx, seat) {
    // 手札の本物の4から2枚を選ぶ組み合わせすべて。ジョーカーは使えない
    const fours = (ctx.game.hands[seat] ?? []).filter(isRealFour);
    const out: Play[] = [];
    for (let i = 0; i < fours.length; i++) {
      for (let k = i + 1; k < fours.length; k++) {
        out.push({ shape: 'group', cards: [fours[i] as CardId, fours[k] as CardId], rank: 4, jokers: [] });
      }
    }
    return out;
  },
  // 成立: 8切りを無効にする（残りの flush を捨てる）。手番は8を出した人の次の人から続く
  onReturned: () => [],
  // 不成立: 残りの flush（8切り）がそのまま処理される
  onReturnFailed: () => [],
};
