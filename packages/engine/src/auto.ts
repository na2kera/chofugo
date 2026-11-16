// auto 操作の決め方（timeout: decisions §8、cpu: design §3.6・decisions §14.9 を差し替えた §14.14）。

import { compareCardIds } from './cards.ts';
import { autoLowerGive, autoUpperGive, exchangeTaskFor } from './exchange.ts';
import { gameOf, isReversed, legalReturnPlays, legalTurnPlays, topPlay, type Ctx } from './game.ts';
import { weakestStrength } from './hand.ts';
import type { Action, Awaiting, LegalPlay } from './types.ts';

/** CPU の並べ方（§14.14 で差し替えた §14.9）。先頭がいちばん選ばれやすい。 */
export function sortForCpu(plays: readonly LegalPlay[], reversed: boolean): LegalPlay[] {
  return plays.slice().sort((a, b) => {
    if (a.foul !== b.foul) return a.foul ? 1 : -1; // (1) 反則上がりにならない手を先に
    const ja = a.play.jokers.length > 0;
    const jb = b.play.jokers.length > 0;
    if (ja !== jb) return ja ? 1 : -1; // (2) ジョーカーを使わない手を先に（§14.14）
    const wa = weakestStrength(a.play, reversed);
    const wb = weakestStrength(b.play, reversed);
    if (wa !== wb) return wa < wb ? -1 : 1; // (3) いちばん弱いカードが弱い順
    if (a.cards.length !== b.cards.length) return b.cards.length - a.cards.length; // (4) 枚数の多い順
    if (a.shape !== b.shape) return a.shape === 'group' ? -1 : 1; // (5) 組を階段より先に
    return compareCardLists(a.cards, b.cards); // (6) カードの並び順
  });
}

function compareCardLists(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = compareCardIds(a[i] as string, b[i] as string);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function playAction(w: Awaiting, lp: LegalPlay): Action {
  return { type: 'play', seat: w.seat, awaitId: w.id, cards: lp.cards, shape: lp.shape, confirmFoul: lp.foul };
}

/** 待ち w に対して、決まりどおりの操作を作る（乱数を使う場合は c.s.rng を進める）。 */
export function decideAuto(c: Ctx, w: Awaiting, policy: 'timeout' | 'cpu'): Action | null {
  const g = gameOf(c);
  if (w.kind === 'turn') {
    const plays = sortForCpu(legalTurnPlays(c, w.seat), isReversed(g));
    const leader = topPlay(g) === null;
    const pass: Action = { type: 'pass', seat: w.seat, awaitId: w.id };
    if (!leader) {
      if (policy === 'timeout') return pass; // 時間切れは自動でパス
      const best = plays[0];
      return best !== undefined && !best.foul ? playAction(w, best) : pass;
    }
    if (plays.length === 0) return pass; // 親で出せる手がない（§2.4）
    if (policy === 'timeout') {
      // 1枚出しのうち、いちばん弱いカード。反則になる手は、ほかに出せる手がある限り選ばない（§8）
      const single = plays.find((p) => p.cards.length === 1 && !p.foul);
      const choice = single ?? plays[0];
      return choice === undefined ? pass : playAction(w, choice);
    }
    return playAction(w, plays[0] as LegalPlay);
  }
  if (w.kind === 'respond') {
    if (policy === 'cpu') {
      const r = legalReturnPlays(c, w.seat)[0];
      if (r !== undefined) return { type: 'respond', seat: w.seat, awaitId: w.id, cards: r.cards };
    }
    return { type: 'respond', seat: w.seat, awaitId: w.id, cards: null };
  }
  const task = exchangeTaskFor(c, w.seat);
  if (task === null) return null;
  const cards =
    task.role === 'lower' ? autoLowerGive(c, task.pair) : autoUpperGive(g.hands[w.seat] ?? [], task.pair.count);
  return { type: 'exchangeGive', seat: w.seat, awaitId: w.id, cards };
}
