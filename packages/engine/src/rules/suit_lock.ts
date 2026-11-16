// マーク縛り（decisions §6.6、§14.6）。

import { suitIndex, type Suit } from '../cards.ts';
import { hasJoker, realSuits } from '../hand.ts';
import type { Play } from '../types.ts';
import type { RuleModule } from './types.ts';

/** need（縛りのマークの並び）から、have（本物のカードのマーク）を除いた残り。have が収まらなければ null。 */
function missingSuits(need: readonly Suit[], have: readonly Suit[]): Suit[] | null {
  const rest = need.slice();
  for (const s of have) {
    const i = rest.indexOf(s);
    if (i < 0) return null;
    rest.splice(i, 1);
  }
  return rest;
}

function sameSuits(a: readonly Suit[], b: readonly Suit[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

export const suitLock: RuleModule = {
  id: 'suit_lock',
  restrictPlay(ctx, play) {
    const lock = ctx.game.suitLock;
    if (lock === null) return null;
    if (play.shape === 'run') return play.suit === lock[0] && lock.length === 1 ? null : { kind: 'suitLock' };
    // 組: ジョーカーは足りないマークの代わりになる
    const rest = missingSuits(lock, realSuits(play));
    return rest === null ? { kind: 'suitLock' } : null;
  },
  refinePlay(ctx, play): Play {
    const lock = ctx.game.suitLock;
    if (lock === null || play.shape !== 'group' || play.jokers.length === 0) return play;
    const rest = missingSuits(lock, realSuits(play));
    if (rest === null) return play;
    rest.sort((a, b) => suitIndex(a) - suitIndex(b));
    return { ...play, jokers: play.jokers.map((j, i) => ({ ...j, suit: rest[i] ?? null })) };
  },
  afterPlay(ctx, played, prev) {
    if (ctx.game.suitLock !== null || prev === null) return [];
    const a = prev.play;
    const b = played.play;
    // ジョーカーを含む出し方では、縛りは新しく成立しない
    if (a.shape !== b.shape || hasJoker(a) || hasJoker(b)) return [];
    const sa = realSuits(a);
    const sb = realSuits(b);
    return sameSuits(sa, sb) ? [{ type: 'setSuitLock', suits: sb }] : [];
  },
  onFieldCleared(ctx) {
    return ctx.game.suitLock !== null ? [{ type: 'clearSuitLock' }] : [];
  },
};
