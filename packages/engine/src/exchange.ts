// カード交換（decisions §3.2、§14.5）。

import { compareCardIds, isJokerId, normalStrength, sortCardIds, type CardId } from './cards.ts';
import { afterExchange } from './abilities.ts';
import { emit, gameOf, type Ctx } from './game.ts';
import { sample } from './rng.ts';
import { SEATS, type ExchangePair, type Place, type SeatId } from './types.ts';

/** 下位が渡すカードを強さで決める。同じ強さで決まらない分は候補として返す。 */
export function lowerGiveSplit(hand: readonly CardId[], n: number): { forced: CardId[]; candidates: CardId[]; choose: number } {
  const sorted = hand.slice().sort((a, b) => normalStrength(b) - normalStrength(a) || compareCardIds(a, b));
  const nth = sorted[n - 1];
  if (nth === undefined) return { forced: sortCardIds(sorted), candidates: [], choose: 0 };
  const t = normalStrength(nth);
  const forced = sorted.filter((id) => normalStrength(id) > t);
  let candidates = sorted.filter((id) => normalStrength(id) === t);
  let choose = n - forced.length;
  // ジョーカー同士は区別がないので、ID の順に自動で決める（engine-assumptions.md）
  if (choose > 0 && candidates.every(isJokerId)) {
    forced.push(...sortCardIds(candidates).slice(0, choose));
    candidates = [];
    choose = 0;
  }
  if (candidates.length === choose) {
    forced.push(...candidates);
    candidates = [];
    choose = 0;
  }
  return { forced: sortCardIds(forced), candidates: sortCardIds(candidates), choose };
}

function seatWithPlace(prev: readonly Place[], place: Place): SeatId {
  return SEATS.find((s) => prev[s] === place) ?? 0;
}

/** 交換フェーズを始める（配った直後）。 */
export function startExchange(c: Ctx, prev: readonly Place[]): void {
  const g = gameOf(c);
  const specs: [Place, Place, number][] = [
    [4, 1, 2],
    [3, 2, 1],
  ];
  const pairs: ExchangePair[] = specs.map(([lp, up, count]) => {
    const lower = seatWithPlace(prev, lp);
    const upper = seatWithPlace(prev, up);
    const split = lowerGiveSplit(g.hands[lower] ?? [], count);
    return {
      lower,
      upper,
      count,
      stage: 'lowerGive',
      forced: split.forced,
      candidates: split.candidates,
      choose: split.choose,
      lowerGave: null,
      upperGave: null,
    };
  });
  g.exchange = { pairs };
  c.s.phase = 'exchange';
  emit(c, { type: 'exchangeStart', pairs: pairs.map((p) => ({ lower: p.lower, upper: p.upper, count: p.count })) });
  g.awaiting = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i] as ExchangePair;
    // 下位に選択の余地がなければ、待たずに自動で渡す（§14.5）
    if (p.choose === 0) giveCards(c, i, p.forced);
    else addExchangeAwait(c, p.lower);
  }
}

function addExchangeAwait(c: Ctx, seat: SeatId): void {
  const g = gameOf(c);
  g.awaiting.push({ id: c.s.nextAwaitId++, seat, kind: 'exchangeGive', timer: 'exchange' });
}

/** 交換の待ちに対して、この席が何をすべきか。 */
export function exchangeTaskFor(c: Ctx, seat: SeatId): { pairIndex: number; role: 'lower' | 'upper'; pair: ExchangePair } | null {
  const ex = gameOf(c).exchange;
  if (ex === null) return null;
  for (let i = 0; i < ex.pairs.length; i++) {
    const p = ex.pairs[i] as ExchangePair;
    if (p.stage === 'lowerGive' && p.lower === seat) return { pairIndex: i, role: 'lower', pair: p };
    if (p.stage === 'upperGive' && p.upper === seat) return { pairIndex: i, role: 'upper', pair: p };
  }
  return null;
}

/** 渡すカードが正しいか。 */
export function isValidExchangeGive(c: Ctx, seat: SeatId, cards: readonly CardId[]): boolean {
  const task = exchangeTaskFor(c, seat);
  if (task === null) return false;
  const p = task.pair;
  const hand = gameOf(c).hands[seat] ?? [];
  if (cards.length !== p.count) return false;
  if (new Set(cards).size !== cards.length) return false;
  if (!cards.every((id) => hand.includes(id))) return false;
  if (task.role === 'upper') return true;
  if (!p.forced.every((id) => cards.includes(id))) return false;
  const chosen = cards.filter((id) => !p.forced.includes(id));
  return chosen.length === p.choose && chosen.every((id) => p.candidates.includes(id));
}

/** カードを渡し、交換を次の段階へ進める（検証は済んでいる前提）。 */
export function giveCards(c: Ctx, pairIndex: number, cards: readonly CardId[]): void {
  const g = gameOf(c);
  const ex = g.exchange;
  if (ex === null) return;
  const p = ex.pairs[pairIndex] as ExchangePair;
  const from = p.stage === 'lowerGive' ? p.lower : p.upper;
  const to = p.stage === 'lowerGive' ? p.upper : p.lower;
  const given = sortCardIds(cards);
  g.hands[from] = (g.hands[from] ?? []).filter((id) => !given.includes(id));
  g.hands[to] = sortCardIds([...(g.hands[to] ?? []), ...given]);
  g.awaiting = g.awaiting.filter((a) => a.seat !== from);
  emit(c, { type: 'exchange', from, to, cards: given });
  if (p.stage === 'lowerGive') {
    p.lowerGave = given;
    p.stage = 'upperGive';
    addExchangeAwait(c, p.upper);
  } else {
    p.upperGave = given;
    p.stage = 'done';
  }
  if (ex.pairs.every((q) => q.stage === 'done')) {
    emit(c, { type: 'exchangeDone' });
    g.awaiting = [];
    // 特権の持ち主がいれば選択のフェーズへ。いなければ対戦を始める（最初の親はそこで決め直す。design-2 §2.3）
    afterExchange(c);
  }
}

/** 下位の時間切れ・CPU: 同じ強さの候補からランダムに選ぶ（状態の中の乱数）。 */
export function autoLowerGive(c: Ctx, p: ExchangePair): CardId[] {
  return [...p.forced, ...sample(c.s.rng, p.candidates, p.choose)];
}

/** 上位の時間切れ・CPU: 通常時の強さでいちばん弱いカードから（同じ強さならマーク順）。 */
export function autoUpperGive(hand: readonly CardId[], n: number): CardId[] {
  return hand
    .slice()
    .sort((a, b) => normalStrength(a) - normalStrength(b) || compareCardIds(a, b))
    .slice(0, n);
}
