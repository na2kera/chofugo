// スペ3返し（decisions §6.5、§6.2 の返しの一周、§14.3、§14.7）。

import type { RuleModule } from './types.ts';
import { isJokerSingle } from '../hand.ts';

const SPADE3 = 'spade-3';

export const spade3BeatsJoker: RuleModule = {
  id: 'spade3_beats_joker',
  afterPlay(ctx, played) {
    if (played.via !== 'turn' || !isJokerSingle(played.play)) return [];
    // 省く条件: スペードの3がすでに全員に見えている（捨て札・場）
    if (ctx.isPublic(SPADE3)) return [];
    return [{ type: 'returnRound', rule: 'spade3_beats_joker' }];
  },
  canStartReturnRound(ctx) {
    return !ctx.isPublic(SPADE3);
  },
  onReturnRoundSkipped(_ctx, source) {
    // 返す手段がないジョーカーの1枚出しとして、すぐ場を流す（§2.5）
    return [{ type: 'flush', leader: source, reason: 'jokerUnbeatable' }];
  },
  // マーク縛り・場の種類と枚数・強さ・自分のパス状態を無視する（§14.7）
  returnIgnores: ['suitLock', 'fieldShape', 'fieldSize', 'notStronger', 'passed'],
  returnOptions(ctx, seat) {
    const hand = ctx.game.hands[seat] ?? [];
    if (!hand.includes(SPADE3)) return [];
    return [{ shape: 'group', cards: [SPADE3], rank: 3, jokers: [] }];
  },
  onReturned(_ctx, seat) {
    // スペードの3を出すと場が流れ、出した人が親になる
    return [{ type: 'flush', leader: seat, reason: 'spade3_beats_joker' }];
  },
  onReturnFailed(_ctx, pending) {
    // 不成立なら、ジョーカーを出した人が場を取って親になる
    return [{ type: 'flush', leader: pending.source, reason: 'returnFailed' }];
  },
};
