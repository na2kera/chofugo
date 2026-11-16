// 席ごとに見える形への変換（design §3.8）。乱数の状態や他人の手札は含めない。

import { deepClone } from './clone.ts';
import { exchangeTaskFor } from './exchange.ts';
import { hasUnused, publicAbilities, usableAbilities } from './abilities.ts';
import {
  computeStandings,
  isReversed,
  legalReturnPlays,
  legalTurnPlays,
  makeCtx,
  placeOf,
  topPlay,
} from './game.ts';
import {
  SEATS,
  isAwaitPhase,
  type GameEvent,
  type GameView,
  type LegalPlay,
  type MatchState,
  type MyAwaiting,
  type PlayerView,
  type SeatId,
  type VisibleEvent,
} from './types.ts';

/** その席が出せる手の一覧（手番か返しの一周で待たれているときだけ。ほかは空）。 */
export function legalPlays(state: MatchState, seat: SeatId): LegalPlay[] {
  const g = state.game;
  if (g === null || state.phase !== 'play') return [];
  const w = g.awaiting.find((a) => a.seat === seat);
  if (w === undefined) return [];
  // ルールへの問い合わせは読み取りだけなので、入力の状態をそのまま使う（変更しない）
  const c = makeCtx(state);
  if (w.kind === 'turn') return legalTurnPlays(c, seat);
  if (w.kind === 'respond') return legalReturnPlays(c, seat);
  return [];
}

function myAwaiting(state: MatchState, seat: SeatId): MyAwaiting | null {
  const g = state.game;
  if (g === null) return null;
  if (!isAwaitPhase(state.phase)) return null;
  const w = g.awaiting.find((a) => a.seat === seat);
  if (w === undefined) return null;
  if (w.kind === 'turn') {
    const plays = legalPlays(state, seat);
    const leader = topPlay(g) === null;
    return {
      awaitId: w.id,
      kind: 'turn',
      leader,
      plays,
      canPass: !leader || plays.length === 0,
      abilities: usableAbilities(makeCtx(state), seat),
      skipAvailable: hasUnused(g, seat, 'skip'),
    };
  }
  if (w.kind === 'abilitySelect') {
    const a = g.abilities;
    if (a === null || a.holder !== seat) return null;
    return { awaitId: w.id, kind: 'abilitySelect', slots: a.slots, draft: a.draft.slice() };
  }
  if (w.kind === 'respond') {
    const p = g.pending;
    if (p === null || p.type !== 'returnRound') return null;
    return { awaitId: w.id, kind: 'respond', rule: p.rule, plays: legalPlays(state, seat) };
  }
  if (w.kind === 'choice') {
    // 候補は手札そのものなので一覧にしない（design-2 §2.7）
    const p = g.pending;
    if (p === null || p.type !== 'choice') return null;
    return { awaitId: w.id, kind: 'choice', rule: p.rule, max: p.max, to: p.to };
  }
  const task = exchangeTaskFor(makeCtx(state), seat);
  if (task === null) return null;
  const p = task.pair;
  if (task.role === 'lower') {
    return {
      awaitId: w.id,
      kind: 'exchangeGive',
      role: 'lower',
      count: p.count,
      forced: p.forced.slice(),
      candidates: p.candidates.slice(),
      choose: p.choose,
    };
  }
  return { awaitId: w.id, kind: 'exchangeGive', role: 'upper', count: p.count, forced: [], candidates: [], choose: p.count };
}

/** 席から見える状態。 */
export function viewFor(state: MatchState, seat: SeatId): PlayerView {
  const g = state.game;
  let game: GameView | null = null;
  if (g !== null) {
    let myExchange: GameView['myExchange'] = null;
    if (g.exchange !== null) {
      const gave: string[] = [];
      const received: string[] = [];
      for (const p of g.exchange.pairs) {
        if (p.lower === seat) {
          gave.push(...(p.lowerGave ?? []));
          received.push(...(p.upperGave ?? []));
        }
        if (p.upper === seat) {
          gave.push(...(p.upperGave ?? []));
          received.push(...(p.lowerGave ?? []));
        }
      }
      myExchange = { gave, received };
    }
    const pending = g.pending;
    game = {
      hand: (g.hands[seat] ?? []).slice(),
      handCounts: g.hands.map((h) => h.length),
      discard: g.discard.slice(),
      field: deepClone(g.field),
      lastPlayer: g.lastPlayer,
      direction: g.direction,
      orderReversed: g.orderReversed,
      passed: g.passed.slice(),
      places: SEATS.map((s) => placeOf(g, s)),
      placeReasons: g.placeReasons.slice(),
      revolution: g.revolution,
      tempReverse: g.tempReverse,
      reversed: isReversed(g),
      suitLock: g.suitLock === null ? null : g.suitLock.slice(),
      seqLock: g.seqLock === null ? null : { suits: g.seqLock.suits.slice(), rank: g.seqLock.rank },
      openingCard: g.openingCard,
      choice: pending !== null && pending.type === 'choice' ? { rule: pending.rule, seat: pending.seat, to: pending.to } : null,
      returnRound:
        pending === null || pending.type !== 'returnRound'
          ? null
          : { rule: pending.rule, source: pending.source, asking: pending.queue[0] ?? null },
      exchange:
        g.exchange === null
          ? null
          : g.exchange.pairs.map((p) => ({ lower: p.lower, upper: p.upper, count: p.count, stage: p.stage })),
      myExchange,
      starter: g.starter,
      abilities: publicAbilities(g),
      myAbilities:
        g.abilities !== null && g.abilities.holder === seat
          ? {
              chosen: (g.abilities.chosen ?? []).slice(),
              used: g.abilities.used.slice(),
              draft: g.abilities.draft.slice(),
            }
          : null,
      ban: g.ban,
      // 透視で見たカード: 持ち主には対象の手札に残っている分、対象には自分の手札に残っている分（§17.3）
      peek:
        g.peek !== null && g.abilities !== null && g.abilities.holder === seat
          ? { target: g.peek.target, cards: g.peek.cards.filter((id) => (g.hands[g.peek!.target] ?? []).includes(id)) }
          : null,
      peekedMine:
        g.peek !== null && g.peek.target === seat ? g.peek.cards.filter((id) => (g.hands[seat] ?? []).includes(id)) : null,
    };
  }
  return {
    matchId: state.matchId,
    seat,
    rules: state.config.rules.slice(),
    gameCount: state.config.gameCount,
    gameNo: state.gameNo,
    phase: state.phase,
    scores: state.scores.slice(),
    prevRanks: state.prevRanks === null ? null : state.prevRanks.slice(),
    results: deepClone(state.results),
    game,
    awaiting: g === null || !isAwaitPhase(state.phase) ? [] : g.awaiting.map((a) => ({ ...a })),
    mine: myAwaiting(state, seat),
    standings: state.phase === 'matchResult' ? computeStandings(state.scores) : null,
  };
}

/** 席から見える出来事（見せてはいけない中身を落とす）。 */
export function eventsFor(events: readonly GameEvent[], seat: SeatId): VisibleEvent[] {
  return events.map((e): VisibleEvent => {
    if (e.type === 'deal') {
      return { seq: e.seq, gameNo: e.gameNo, type: 'deal', counts: e.counts.slice(), hand: (e.hands[seat] ?? []).slice() };
    }
    if (e.type === 'exchange') {
      const party = e.from === seat || e.to === seat;
      return {
        seq: e.seq,
        gameNo: e.gameNo,
        type: 'exchange',
        from: e.from,
        to: e.to,
        count: e.cards.length,
        cards: party ? e.cards.slice() : null,
      };
    }
    if (e.type === 'give') {
      // 7渡し: 全員に見えるのは誰から誰へ何枚。中身は渡した人と受け取った人だけ（design-2 §2.7）
      const party = e.from === seat || e.to === seat;
      return {
        seq: e.seq,
        gameNo: e.gameNo,
        type: 'give',
        from: e.from,
        to: e.to,
        count: e.cards.length,
        cards: party ? e.cards.slice() : null,
      };
    }
    if (e.type === 'abilitiesChosen') {
      // 選んだ種類は本人だけ。ほかの席には個数だけ（§5.2、design-3 §2.6）
      return {
        seq: e.seq,
        gameNo: e.gameNo,
        type: 'abilitiesChosen',
        seat: e.seat,
        count: e.count,
        abilities: e.seat === seat ? e.abilities.slice() : null,
      };
    }
    if (e.type === 'ability') {
      // 透視で見たカード・強奪で動いたカードは、本人と対象だけ。ほかの席からは項目ごと落とす
      const party = e.seat === seat || e.target === seat;
      const out = deepClone(e);
      if (!party) {
        delete out.cards;
        delete out.given;
        delete out.taken;
      }
      return out;
    }
    return deepClone(e);
  });
}
