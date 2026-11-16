// 試合の作成と操作の適用（design §3.2、§3.3）。

import { STANDARD_DECK, sortCardIds, type CardId } from './cards.ts';
import { deepClone } from './clone.ts';
import { decideAuto } from './auto.ts';
import { giveCards, exchangeTaskFor, isValidExchangeGive, startExchange } from './exchange.ts';
import {
  applyStarterRules,
  doChoose,
  doPass,
  doRespond,
  doTurnPlay,
  emit,
  gameOf,
  interpretTurnPlay,
  isFoulFinish,
  legalReturnPlays,
  legalTurnPlays,
  makeCtx,
  startTurn,
  topPlay,
  computeStandings,
  type Ctx,
} from './game.ts';
import { findModule } from './rules/index.ts';
import { isValidSeed, nextInt, rngFromSeed, shuffleInPlace, type Seed } from './rng.ts';
import {
  ALL_RULE_IDS,
  SEATS,
  type Action,
  type ActionError,
  type ActionErrorCode,
  type ApplyResult,
  type Awaiting,
  type ConfigError,
  type CreateMatchResult,
  type GameEvent,
  type GameState,
  type MatchConfig,
  type MatchState,
  type RuleId,
  type SeatId,
} from './types.ts';

// ---------- 設定の検証 ----------

function isRuleId(v: unknown): v is RuleId {
  return typeof v === 'string' && (ALL_RULE_IDS as readonly string[]).includes(v);
}

export function validateConfig(config: unknown): ConfigError | null {
  if (typeof config !== 'object' || config === null) return { code: 'malformed', message: 'config must be an object' };
  const c = config as Record<string, unknown>;
  if (typeof c['matchId'] !== 'string') return { code: 'malformed', message: 'matchId must be a string' };
  const rules = c['rules'];
  if (!Array.isArray(rules)) return { code: 'malformed', message: 'rules must be an array' };
  for (const r of rules) {
    if (!isRuleId(r)) return { code: 'unknownRule', message: `unknown rule: ${typeof r === 'string' ? r : typeof r}` };
  }
  const ids = rules as RuleId[];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as RuleId;
    if (ids.indexOf(id) !== i) return { code: 'duplicateRule', rule: id, message: `duplicate rule: ${id}` };
    const mod = findModule(id);
    if (mod === null) return { code: 'notImplemented', rule: id, message: `rule not implemented yet: ${id}` };
    for (const req of mod.requires ?? []) {
      if (!ids.includes(req)) return { code: 'missingRequirement', rule: id, message: `${id} requires ${req}` };
    }
  }
  const gc = c['gameCount'];
  if (gc !== 5 && gc !== 10 && gc !== null) return { code: 'invalidGameCount', message: 'gameCount must be 5, 10 or null' };
  return null;
}

// ---------- 試合の作成とゲームの開始 ----------

/** 試合を作り、1ゲーム目を配った状態を返す。 */
export function createMatch(config: MatchConfig, seed: Seed): CreateMatchResult {
  const err = validateConfig(config);
  if (err !== null) return { ok: false, error: err };
  if (!isValidSeed(seed)) return { ok: false, error: { code: 'invalidSeed', message: 'seed must be four uint32 values, not all zero' } };
  const cfg: MatchConfig = { matchId: config.matchId, rules: config.rules.slice(), gameCount: config.gameCount };
  const state: MatchState = {
    version: 2,
    matchId: cfg.matchId,
    config: cfg,
    rng: rngFromSeed(seed),
    gameNo: 0,
    scores: [0, 0, 0, 0],
    prevRanks: null,
    phase: 'play',
    game: null,
    results: [],
    nextAwaitId: 1,
    nextEventSeq: 1,
  };
  const c = makeCtx(state);
  startGame(c);
  return { ok: true, state, events: c.events };
}

function startGame(c: Ctx): void {
  const s = c.s;
  s.gameNo += 1;
  const deck: CardId[] = STANDARD_DECK.map((card) => card.id);
  shuffleInPlace(s.rng, deck);
  // 14枚になる2人を毎ゲームランダムに決める（§2.2）
  const order: SeatId[] = SEATS.slice();
  shuffleInPlace(s.rng, order);
  const counts = [13, 13, 13, 13];
  counts[order[0] as SeatId] = 14;
  counts[order[1] as SeatId] = 14;
  const hands: CardId[][] = [];
  let pos = 0;
  for (const seat of SEATS) {
    const n = counts[seat] as number;
    hands.push(sortCardIds(deck.slice(pos, pos + n)));
    pos += n;
  }
  const prev = s.prevRanks;
  const starter: SeatId = prev === null ? (nextInt(s.rng, 4) as SeatId) : (SEATS.find((x) => prev[x] === 4) ?? 0);
  const game: GameState = {
    hands,
    discard: [],
    field: [],
    lastPlayer: null,
    direction: 1,
    orderReversed: false,
    passed: [false, false, false, false],
    topOrder: [],
    bottomOrder: [],
    placeReasons: [null, null, null, null],
    revolution: false,
    tempReverse: false,
    suitLock: null,
    seqLock: null,
    openingCard: null,
    pending: null,
    awaiting: [],
    firstPlaceHandCounts: null,
    exchange: null,
    starter,
  };
  s.game = game;
  s.phase = 'play';
  // 乱数は、その1と同じ時点で同じ回数だけ引いてある。モジュールが親を決めるときは、その結果を使わない（design-2 §2.3）。
  // 交換があるときは、交換が終わるまで決め直さない（exchange.ts）。交換の間の starter はその1の値（前の大貧民）、
  // openingCard は null のまま（交換の間にダイヤの3の持ち主を見せないため、design-2 §6.6）
  if (prev === null) applyStarterRules(c);
  const leaderRule = c.mods.find((m) => m.leaderRule !== undefined)?.leaderRule ?? (prev === null ? 'random' : 'prevLowest');
  emit(c, { type: 'gameStart', leaderRule });
  emit(c, { type: 'deal', counts: hands.map((h) => h.length), hands: hands.map((h) => h.slice()) });
  if (prev !== null) startExchange(c, prev);
  else startTurn(c, game.starter);
}

// ---------- 操作の適用 ----------

function isSeat(v: unknown): v is SeatId {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

/** カード ID の列か。穴のある配列（new Array(1) など）も拒否する（.every は穴を飛ばすので、添字で確かめる。design-2 §6.6）。 */
function isCardList(v: unknown): v is CardId[] {
  if (!Array.isArray(v) || v.length > 54) return false;
  for (let i = 0; i < v.length; i++) {
    if (!(i in v) || typeof v[i] !== 'string') return false;
  }
  return true;
}

/** いま待っている操作（並行して複数あり得る）。 */
export function awaiting(state: MatchState): Awaiting[] {
  if (state.game === null) return [];
  if (state.phase !== 'play' && state.phase !== 'exchange') return [];
  return state.game.awaiting.map((a) => ({ ...a }));
}

/** 操作を1つ適用する。不正なら error を返し、入力の状態は変えない。 */
export function applyAction(state: MatchState, action: Action): ApplyResult {
  if (typeof action !== 'object' || action === null || typeof (action as { type?: unknown }).type !== 'string') {
    return { ok: false, error: err('malformed', 'action must be an object with type') };
  }
  const draft = deepClone(state);
  const c = makeCtx(draft);
  const r = dispatch(c, action, false);
  if (r !== null) return { ok: false, error: r };
  return { ok: true, state: draft, events: c.events };
}

function err(code: ActionErrorCode, message: string, extra: Partial<ActionError> = {}): ActionError {
  return { code, message, ...extra };
}

/** 待ちの番号と席を確かめる。 */
function checkAwait(c: Ctx, seat: unknown, awaitId: unknown, kind: Awaiting['kind']): ActionError | Awaiting {
  if (!isSeat(seat)) return err('malformed', 'seat must be 0..3');
  if (typeof awaitId !== 'number') return err('malformed', 'awaitId must be a number');
  const g = c.s.game;
  if (g === null || (c.s.phase !== 'play' && c.s.phase !== 'exchange')) return err('wrongPhase', 'no game in progress');
  const w = g.awaiting.find((a) => a.id === awaitId);
  if (w === undefined) return err('staleAwait', `await ${awaitId} is not active`);
  if (w.seat !== seat) return err('notYourAwait', `await ${awaitId} is not for seat ${seat}`);
  if (w.kind !== kind) return err('wrongAwaitKind', `await ${awaitId} is ${w.kind}`);
  return w;
}

function isError(x: ActionError | Awaiting): x is ActionError {
  return 'code' in x;
}

function dispatch(c: Ctx, a: Action, fromAuto: boolean): ActionError | null {
  const s = c.s;
  switch (a.type) {
    case 'play': {
      const w = checkAwait(c, a.seat, a.awaitId, 'turn');
      if (isError(w)) return w;
      if (!isCardList(a.cards) || a.cards.length === 0) return err('malformed', 'cards must be a non-empty list');
      if (new Set(a.cards).size !== a.cards.length) return err('malformed', 'duplicate cards');
      const hand = gameOf(c).hands[w.seat] ?? [];
      if (!a.cards.every((id) => hand.includes(id))) return err('cardNotInHand', 'card not in hand');
      const shape = a.shape === 'group' || a.shape === 'run' ? a.shape : null;
      if (a.shape !== undefined && shape === null) return err('malformed', 'shape must be group or run');
      const r = interpretTurnPlay(c, w.seat, a.cards, shape);
      if (!r.ok) {
        if (r.reason === 'illegalPlay') return err('illegalPlay', `cannot play: ${r.violation}`, { violation: r.violation });
        return err(r.reason, r.reason);
      }
      if (isFoulFinish(c, w.seat, r.play) && a.confirmFoul !== true) {
        return err('confirmFoulRequired', 'this play is a foul finish; set confirmFoul');
      }
      doTurnPlay(c, w.seat, r.play);
      return null;
    }
    case 'pass': {
      const w = checkAwait(c, a.seat, a.awaitId, 'turn');
      if (isError(w)) return w;
      const g = gameOf(c);
      if (topPlay(g) === null && legalTurnPlays(c, w.seat).length > 0) {
        return err('cannotPass', 'the leader can pass only when no play is possible');
      }
      doPass(c, w.seat);
      return null;
    }
    case 'respond': {
      const w = checkAwait(c, a.seat, a.awaitId, 'respond');
      if (isError(w)) return w;
      if (a.cards === null) {
        doRespond(c, w.seat, null);
        return null;
      }
      if (!isCardList(a.cards)) return err('malformed', 'cards must be a list or null');
      const want = sortCardIds(a.cards).join(',');
      const opt = legalReturnPlays(c, w.seat).find((p) => p.cards.join(',') === want);
      if (opt === undefined) {
        const hand = gameOf(c).hands[w.seat] ?? [];
        if (!a.cards.every((id) => hand.includes(id))) return err('cardNotInHand', 'card not in hand');
        return err('invalidResponse', 'these cards cannot be used to return');
      }
      doRespond(c, w.seat, opt.play);
      return null;
    }
    case 'exchangeGive': {
      const w = checkAwait(c, a.seat, a.awaitId, 'exchangeGive');
      if (isError(w)) return w;
      if (!isCardList(a.cards)) return err('malformed', 'cards must be a list');
      const hand = gameOf(c).hands[w.seat] ?? [];
      if (!a.cards.every((id) => hand.includes(id))) return err('cardNotInHand', 'card not in hand');
      if (!isValidExchangeGive(c, w.seat, a.cards)) return err('invalidExchange', 'invalid cards for exchange');
      const task = exchangeTaskFor(c, w.seat);
      if (task === null) return err('invalidExchange', 'nothing to give');
      giveCards(c, task.pairIndex, a.cards);
      return null;
    }
    case 'choose': {
      const w = checkAwait(c, a.seat, a.awaitId, 'choice');
      if (isError(w)) return w;
      const p = gameOf(c).pending;
      if (p === null || p.type !== 'choice') return err('wrongAwaitKind', 'nothing to choose');
      if (!isCardList(a.cards)) return err('malformed', 'cards must be a list');
      if (new Set(a.cards).size !== a.cards.length) return err('invalidChoice', 'duplicate cards');
      if (a.cards.length > p.max) return err('invalidChoice', `at most ${p.max} cards`);
      const hand = gameOf(c).hands[w.seat] ?? [];
      if (!a.cards.every((id) => hand.includes(id))) return err('cardNotInHand', 'card not in hand');
      doChoose(c, a.cards);
      return null;
    }
    case 'auto': {
      if (fromAuto) return err('malformed', 'nested auto');
      if (a.policy !== 'timeout' && a.policy !== 'cpu') return err('malformed', 'policy must be timeout or cpu');
      if (typeof a.awaitId !== 'number') return err('malformed', 'awaitId must be a number');
      const g = s.game;
      if (g === null || (s.phase !== 'play' && s.phase !== 'exchange')) return err('wrongPhase', 'no game in progress');
      const w = g.awaiting.find((x) => x.id === a.awaitId);
      if (w === undefined) return err('staleAwait', `await ${a.awaitId} is not active`);
      const decided = decideAuto(c, w, a.policy);
      if (decided === null) return err('wrongAwaitKind', 'nothing to decide');
      return dispatch(c, decided, true);
    }
    case 'nextGame': {
      if (s.phase !== 'gameResult') return err('wrongPhase', 'nextGame is allowed only after a game ends');
      const last = s.results[s.results.length - 1];
      s.prevRanks = last === undefined ? null : last.places.slice();
      startGame(c);
      return null;
    }
    case 'endMatch': {
      if (s.phase !== 'gameResult') return err('wrongPhase', 'endMatch is allowed only on the game result');
      if (s.config.gameCount !== null) return err('notUnlimited', 'only an unlimited match can be ended');
      s.phase = 'matchResult';
      emit(c, { type: 'matchEnd', standings: computeStandings(s.scores) });
      return null;
    }
    default:
      return err('malformed', 'unknown action type');
  }
}

export type { GameEvent };
