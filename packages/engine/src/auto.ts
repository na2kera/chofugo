// auto 操作の決め方（timeout: decisions §8、cpu: design §3.6・decisions §14.9 を差し替えた §14.14）。

import { cardOf, compareCardIds, RANKS, rankStrength, type CardId, type Rank } from './cards.ts';
import { cpuAbilityAction, cpuWantsSkip, decideAbilitySelect } from './abilities.ts';
import { autoLowerGive, autoUpperGive, exchangeTaskFor } from './exchange.ts';
import { gameOf, isActive, isReversed, legalReturnPlays, legalTurnPlays, topPlay, type Ctx } from './game.ts';
import { cardStrength, weakestStrength } from './hand.ts';
import { findModule } from './rules/index.ts';
import { nextInt } from './rng.ts';
import { SEATS, type Action, type Awaiting, type LegalPlay, type SeatId } from './types.ts';

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

function playAction(w: Awaiting, lp: LegalPlay, withSkip = false): Action {
  const a: Action = { type: 'play', seat: w.seat, awaitId: w.id, cards: lp.cards, shape: lp.shape, confirmFoul: lp.foul };
  if (withSkip) a.withSkip = true;
  return a;
}

/** 7渡し・10捨て・銀河鉄道・闇市の CPU: その時点の向きでいちばん弱いカードから max 枚まで。ジョーカーは最後（design-2 §2.6）。 */
export function cpuChoice(hand: readonly CardId[], max: number, reversed: boolean): CardId[] {
  return hand
    .slice()
    .sort((a, b) => cardStrength(a, reversed) - cardStrength(b, reversed) || compareCardIds(a, b))
    .slice(0, max);
}

/** 闇市で選べる相手: 自分以外の残っている席（パス済みを含む。design-4 §2.4）。 */
export function tradeTargets(c: Ctx, seat: SeatId): SeatId[] {
  const g = gameOf(c);
  return SEATS.filter((s) => s !== seat && isActive(g, s));
}

/**
 * Q ボンバーの CPU（decisions §15.8、§19.3）: 自分の手札でいちばん枚数の多い数字を1つ。同じ枚数なら、その時点の向きで弱い数字。
 * ジョーカーは数えない。数字のカードがなければ null（宣言しない）。
 */
export function cpuCallRank(hand: readonly CardId[], reversed: boolean): Rank | null {
  let best: Rank | null = null;
  let bestCount = 0;
  for (const r of RANKS) {
    const n = hand.filter((id) => {
      const card = cardOf(id);
      return card !== null && card.kind === 'normal' && card.rank === r;
    }).length;
    if (n === 0) continue;
    if (n > bestCount || (n === bestCount && best !== null && rankStrength(r, reversed) < rankStrength(best, reversed))) {
      best = r;
      bestCount = n;
    }
  }
  return best;
}

/** 待ち w に対して、決まりどおりの操作を作る（乱数を使う場合は c.s.rng を進める）。 */
export function decideAuto(c: Ctx, w: Awaiting, policy: 'timeout' | 'cpu'): Action | null {
  const g = gameOf(c);
  if (w.kind === 'abilitySelect') return decideAbilitySelect(c, w, policy);
  if (w.kind === 'turn') {
    // CPU の特権（design-3 §2.5）。時間切れでは使わない。使うときは、カードを選ぶ前に1つだけ
    if (policy === 'cpu') {
      const use = cpuAbilityAction(c, w);
      if (use !== null) return use;
    }
    const plays = sortForCpu(legalTurnPlays(c, w.seat), isReversed(g));
    const cpuPlay = (lp: LegalPlay): Action => playAction(w, lp, cpuWantsSkip(g, w.seat, lp.canSkip === true));
    const leader = topPlay(g) === null;
    const pass: Action = { type: 'pass', seat: w.seat, awaitId: w.id };
    if (!leader) {
      if (policy === 'timeout') return pass; // 時間切れは自動でパス
      const best = plays[0];
      return best !== undefined && !best.foul ? cpuPlay(best) : pass;
    }
    if (plays.length === 0) return pass; // 親で出せる手がない（§2.4）
    if (policy === 'timeout') {
      // 1枚出しのうち、いちばん弱いカード。反則になる手は、ほかに出せる手がある限り選ばない（§8）
      const single = plays.find((p) => p.cards.length === 1 && !p.foul);
      const choice = single ?? plays[0];
      return choice === undefined ? pass : playAction(w, choice);
    }
    return cpuPlay(plays[0] as LegalPlay);
  }
  if (w.kind === 'respond') {
    if (policy === 'cpu') {
      const r = legalReturnPlays(c, w.seat)[0];
      if (r !== undefined) return { type: 'respond', seat: w.seat, awaitId: w.id, cards: r.cards };
    }
    return { type: 'respond', seat: w.seat, awaitId: w.id, cards: null };
  }
  if (w.kind === 'choice') {
    const p = g.pending;
    if (p === null || p.type !== 'choice') return null;
    const base = { type: 'choose' as const, seat: w.seat, awaitId: w.id };
    // 時間切れは、どれも何もしない（渡さない・捨てない・交換しない・使わない・宣言しない。§8、design-4 §2.6）
    if (policy === 'timeout') return { ...base, cards: [] };
    const hand = g.hands[w.seat] ?? [];
    const kind = findModule(p.rule)?.choiceKind;
    if (kind === 'trade') {
      // 闇市: 相手を乱数で1人選び、いちばん弱いカードを、ちょうどの枚数だけ渡す
      const targets = tradeTargets(c, w.seat);
      if (targets.length === 0) return { ...base, cards: [] };
      const target = targets[nextInt(c.s.rng, targets.length)] as SeatId;
      const n = Math.min(p.max, hand.length, (g.hands[target] ?? []).length);
      return { ...base, cards: cpuChoice(hand, n, isReversed(g)), target };
    }
    if (kind === 'call') {
      const r = cpuCallRank(hand, isReversed(g));
      return r === null ? { ...base, cards: [] } : { ...base, cards: [], ranks: [r] };
    }
    // 7渡し・10捨て・銀河鉄道: いちばん弱いカードから max 枚まで
    return { ...base, cards: cpuChoice(hand, p.max, isReversed(g)) };
  }
  const task = exchangeTaskFor(c, w.seat);
  if (task === null) return null;
  const cards =
    task.role === 'lower' ? autoLowerGive(c, task.pair) : autoUpperGive(g.hands[w.seat] ?? [], task.pair.count);
  return { type: 'exchangeGive', seat: w.seat, awaitId: w.id, cards };
}
