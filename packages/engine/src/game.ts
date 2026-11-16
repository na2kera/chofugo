// 中心の処理: 手番、パス、場の流れ、効果の列、返しの一周、順位の確定。
// ルールごとの判断はすべて rules/ のモジュールに問い合わせる。

import { sortCardIds, type CardId } from './cards.ts';
import {
  beats,
  enumerateGroupSets,
  enumerateRunSets,
  interpretations,
  strongerRun,
} from './hand.ts';
import { activeModules, findModule, type RuleCtx, type RuleModule } from './rules/index.ts';
import {
  SEATS,
  type Effect,
  type FieldPlay,
  type FlushReason,
  type GameEvent,
  type GameEventBody,
  type GameState,
  type LegalPlay,
  type MatchState,
  type Place,
  type PlaceReason,
  type Play,
  type SeatId,
  type Shape,
  type Violation,
  type ViolationKind,
} from './types.ts';

/** 1つの操作を処理している間の作業領域。s は下書き（コピー済み）の状態。 */
export type Ctx = {
  s: MatchState;
  events: GameEvent[];
  mods: RuleModule[];
};

export function makeCtx(s: MatchState, events: GameEvent[] = []): Ctx {
  return { s, events, mods: activeModules(s.config.rules) };
}

/** 下書きのゲーム状態。呼び出す前に game が null でないことを公開関数で確かめている。 */
export function gameOf(c: Ctx): GameState {
  return c.s.game as GameState;
}

export function emit(c: Ctx, body: GameEventBody): void {
  c.events.push({ seq: c.s.nextEventSeq++, gameNo: c.s.gameNo, ...body } as GameEvent);
}

// ---------- 席 ----------

export function isPlaced(g: GameState, seat: SeatId): boolean {
  return g.topOrder.includes(seat) || g.bottomOrder.includes(seat);
}

export function isActive(g: GameState, seat: SeatId): boolean {
  return !isPlaced(g, seat);
}

export function activeSeats(g: GameState): SeatId[] {
  return SEATS.filter((s) => isActive(g, s));
}

export function stepSeat(g: GameState, from: SeatId, steps: number): SeatId {
  return ((((from + g.direction * steps) % 4) + 4) % 4) as SeatId;
}

/** from の次から進行方向に、条件を満たす最初の席を探す（from 自身は含めない）。 */
export function nextSeatWhere(g: GameState, from: SeatId, pred: (s: SeatId) => boolean): SeatId | null {
  for (let i = 1; i < 4; i++) {
    const s = stepSeat(g, from, i);
    if (pred(s)) return s;
  }
  return null;
}

/** from 自身から進行方向に、残っている最初の席。 */
function selfOrNextActive(g: GameState, from: SeatId): SeatId | null {
  if (isActive(g, from)) return from;
  return nextSeatWhere(g, from, (s) => isActive(g, s));
}

export function placeOf(g: GameState, seat: SeatId): Place | null {
  const t = g.topOrder.indexOf(seat);
  if (t >= 0) return (t + 1) as Place;
  const b = g.bottomOrder.indexOf(seat);
  if (b >= 0) return (4 - b) as Place;
  return null;
}

export function isReversed(g: GameState): boolean {
  return g.revolution !== g.tempReverse;
}

export function topPlay(g: GameState): FieldPlay | null {
  return g.field[g.field.length - 1] ?? null;
}

// ---------- ルールへの問い合わせ ----------

export function ruleCtx(c: Ctx): RuleCtx {
  const g = gameOf(c);
  const s = c.s;
  return {
    state: s,
    game: g,
    get reversed() {
      return isReversed(g);
    },
    isOn: (id) => s.config.rules.includes(id),
    isPublic: (card) => g.discard.includes(card) || g.field.some((fp) => fp.play.cards.includes(card)),
    isActive: (seat) => isActive(g, seat),
  };
}

function enabledShapes(c: Ctx): Shape[] {
  const shapes: Shape[] = ['group'];
  for (const m of c.mods) for (const sh of m.shapes ?? []) if (!shapes.includes(sh)) shapes.push(sh);
  return shapes;
}

function refine(c: Ctx, play: Play): Play {
  let p = play;
  for (const m of c.mods) if (m.refinePlay) p = m.refinePlay(ruleCtx(c), p);
  return p;
}

/** モジュールの制限（ignore にある種類は無視する）。 */
function restriction(c: Ctx, play: Play, seat: SeatId, ignore: readonly ViolationKind[]): Violation | null {
  for (const m of c.mods) {
    const v = m.restrictPlay?.(ruleCtx(c), play, seat) ?? null;
    if (v !== null && !ignore.includes(v.kind)) return v;
  }
  return null;
}

function fieldViolation(g: GameState, play: Play): Violation | null {
  const top = topPlay(g);
  if (top === null) return null;
  if (top.play.shape !== play.shape) return { kind: 'fieldShape' };
  if (top.play.cards.length !== play.cards.length) return { kind: 'fieldSize' };
  if (!beats(play, top.play, isReversed(g))) return { kind: 'notStronger' };
  return null;
}

/** 手番で出す手として正しいか。 */
function turnViolation(c: Ctx, seat: SeatId, play: Play): Violation | null {
  return fieldViolation(gameOf(c), play) ?? restriction(c, play, seat, []);
}

/** 反則上がりになるか（出す直前の状態で判定する）。 */
export function isFoulFinish(c: Ctx, seat: SeatId, play: Play): boolean {
  const hand = gameOf(c).hands[seat] ?? [];
  if (hand.length !== play.cards.length) return false;
  const rc = ruleCtx(c);
  return c.mods.some((m) => m.isFoulFinish?.(rc, play) ?? false);
}

export type Interpretation =
  | { ok: true; play: Play }
  | { ok: false; reason: 'invalidCombination' | 'ambiguousShape' }
  | { ok: false; reason: 'illegalPlay'; violation: ViolationKind };

/**
 * カードの組み合わせを、手番で出す手として解釈する。
 * 解釈が複数あるときは、すべての制限を満たすもののうち、その時点の向きでいちばん強いものを選ぶ（§14.6）。
 */
export function interpretTurnPlay(c: Ctx, seat: SeatId, cards: readonly CardId[], shape: Shape | null): Interpretation {
  const g = gameOf(c);
  const shapes = enabledShapes(c).filter((sh) => shape === null || sh === shape);
  const cands = interpretations(cards, shapes).map((p) => refine(c, p));
  if (cands.length === 0) return { ok: false, reason: 'invalidCombination' };
  let firstViolation: ViolationKind | null = null;
  let group: Play | null = null;
  let run: Play | null = null;
  for (const p of cands) {
    const v = turnViolation(c, seat, p);
    if (v !== null) {
      firstViolation ??= v.kind;
      continue;
    }
    if (p.shape === 'group') group = p;
    else run = run === null || run.shape !== 'run' ? p : strongerRun(run, p, isReversed(g));
  }
  if (group !== null && run !== null) return { ok: false, reason: 'ambiguousShape' };
  const chosen = group ?? run;
  if (chosen === null) return { ok: false, reason: 'illegalPlay', violation: firstViolation ?? 'notStronger' };
  return { ok: true, play: chosen };
}

/** 手番の席が出せる手の一覧。手札と全員に見えている情報だけで決まる。 */
export function legalTurnPlays(c: Ctx, seat: SeatId): LegalPlay[] {
  const g = gameOf(c);
  const hand = g.hands[seat] ?? [];
  const top = topPlay(g);
  const size = top === null ? null : top.play.cards.length;
  const shapes = enabledShapes(c).filter((sh) => top === null || sh === top.play.shape);
  const out: LegalPlay[] = [];
  for (const sh of shapes) {
    const sets = sh === 'group' ? enumerateGroupSets(hand, size) : enumerateRunSets(hand, size);
    for (const cards of sets) {
      const r = interpretTurnPlay(c, seat, cards, sh);
      if (!r.ok) continue;
      out.push({ cards, shape: sh, play: r.play, foul: isFoulFinish(c, seat, r.play) });
    }
  }
  return out;
}

/** 返しの一周で、その席が返せる手。 */
export function legalReturnPlays(c: Ctx, seat: SeatId): LegalPlay[] {
  const g = gameOf(c);
  const p = g.pending;
  if (p === null || p.type !== 'returnRound') return [];
  const mod = findModule(p.rule);
  if (mod === null || mod.returnOptions === undefined) return [];
  const ignore = mod.returnIgnores ?? [];
  const hand = g.hands[seat] ?? [];
  const out: LegalPlay[] = [];
  for (const play of mod.returnOptions(ruleCtx(c), seat, p)) {
    if (!play.cards.every((id) => hand.includes(id))) continue;
    if (restriction(c, play, seat, ignore) !== null) continue;
    out.push({ cards: play.cards, shape: play.shape, play, foul: false });
  }
  return out;
}

// ---------- 手番の開始 ----------

export function startTurn(c: Ctx, seat: SeatId): void {
  const g = gameOf(c);
  g.awaiting = [{ id: c.s.nextAwaitId++, seat, kind: 'turn', timer: 'turn' }];
}

function startRespond(c: Ctx, seat: SeatId): void {
  const g = gameOf(c);
  g.awaiting = [{ id: c.s.nextAwaitId++, seat, kind: 'respond', timer: 'respond' }];
}

// ---------- 効果 ----------

const EFFECT_PRIORITY: Record<Effect['type'], number> = {
  toggleRevolution: 0, // 革命を先に（§6.0.1）
  setTempReverse: 1, // 数字の効果
  setSuitLock: 1,
  clearSuitLock: 1,
  forceLast: 2,
  returnRound: 3, // 上がりの判定のあと（§14.3）
  flush: 4,
};

/** 上がりの判定より前に処理する効果か。 */
function isPreFinish(e: Effect): boolean {
  return EFFECT_PRIORITY[e.type] < EFFECT_PRIORITY.returnRound;
}

function sortEffects(effects: Effect[]): Effect[] {
  return effects
    .map((e, i) => ({ e, i }))
    .sort((a, b) => EFFECT_PRIORITY[a.e.type] - EFFECT_PRIORITY[b.e.type] || a.i - b.i)
    .map((x) => x.e);
}

/** 状態だけを変える効果を処理する。ゲームが終わったら true。 */
function applyStateEffect(c: Ctx, e: Effect): boolean {
  const g = gameOf(c);
  switch (e.type) {
    case 'toggleRevolution':
      g.revolution = !g.revolution;
      emit(c, { type: 'revolution', active: g.revolution });
      return false;
    case 'setTempReverse':
      g.tempReverse = e.active;
      emit(c, { type: 'tempReverse', active: e.active });
      return false;
    case 'setSuitLock':
      g.suitLock = e.suits.slice();
      emit(c, { type: 'suitLock', suits: e.suits.slice() });
      return false;
    case 'clearSuitLock':
      g.suitLock = null;
      return false;
    case 'forceLast':
      return placeSeat(c, e.seat, e.reason);
    case 'returnRound':
    case 'flush':
      return false; // 流れを変える効果は runFlowEffects で扱う
  }
}

/**
 * 上がりの判定より後の効果（返しの一周、場の流れ）を順に処理する。
 * どれも流れを変えなければ、source の次の人へ手番を送る。
 */
function runFlowEffects(c: Ctx, effects: Effect[], source: SeatId): void {
  const g = gameOf(c);
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i] as Effect;
    if (e.type === 'returnRound') {
      const rest = effects.slice(i + 1);
      // 省く条件は、一周を始める直前の最新の状態で評価し直す（decisions §14.14）
      const mod = findModule(e.rule);
      if (mod?.canStartReturnRound !== undefined && !mod.canStartReturnRound(ruleCtx(c), source)) {
        runFlowEffects(c, [...(mod.onReturnRoundSkipped?.(ruleCtx(c), source) ?? []), ...rest], source);
        return;
      }
      const participants: SeatId[] = [];
      for (let k = 1; k < 4; k++) {
        const s = stepSeat(g, source, k);
        if (isActive(g, s)) participants.push(s);
      }
      emit(c, { type: 'returnRoundStart', rule: e.rule, source, participants: participants.slice() });
      g.pending = { type: 'returnRound', rule: e.rule, source, queue: participants, rest };
      // ここに来るときは残りが2人以上いるので、参加者は必ず1人以上いる（防御のための分岐）
      if (participants.length === 0) {
        finishReturnRound(c, null, null);
        return;
      }
      startRespond(c, participants[0] as SeatId);
      return;
    }
    if (e.type === 'flush') {
      flushField(c, e.leader, e.reason);
      return;
    }
    if (applyStateEffect(c, e)) return;
  }
  advanceFrom(c, source);
}

// ---------- 場 ----------

/** 場を流し、親を決めて手番を始める（§14.1、§14.8 の順）。 */
export function flushField(c: Ctx, leader: SeatId, reason: FlushReason): void {
  const g = gameOf(c);
  for (const fp of g.field) g.discard.push(...fp.play.cards);
  g.field = [];
  g.lastPlayer = null;
  clearFieldEffects(c);
  const next = selfOrNextActive(g, leader);
  if (next === null) return; // ゲームは終わっているはず
  emit(c, { type: 'fieldCleared', reason, leader: next });
  startTurn(c, next);
}

/** 「場が流れるまで」の効果とパス状態を解除する。 */
function clearFieldEffects(c: Ctx): void {
  const g = gameOf(c);
  g.passed = [false, false, false, false];
  const effects: Effect[] = [];
  for (const m of c.mods) effects.push(...(m.onFieldCleared?.(ruleCtx(c)) ?? []));
  for (const e of sortEffects(effects)) applyStateEffect(c, e);
}

/** 手番を from の次へ送る。最後に出した人の席に着いたら場が流れる（§14.1）。 */
function advanceFrom(c: Ctx, from: SeatId): void {
  const g = gameOf(c);
  for (let i = 1; i <= 4; i++) {
    const s = stepSeat(g, from, i);
    if (s === g.lastPlayer) {
      flushField(c, s, 'allPassed');
      return;
    }
    if (isActive(g, s) && g.passed[s] !== true) {
      startTurn(c, s);
      return;
    }
  }
  // 場が空なのに手番を送る場面はない（親のパスは leaderPass で扱う）
  const fallback = selfOrNextActive(g, stepSeat(g, from, 1));
  if (fallback !== null) startTurn(c, fallback);
}

// ---------- 操作の適用 ----------

/** 手番で手を出す（検証は済んでいる前提）。 */
export function doTurnPlay(c: Ctx, seat: SeatId, play: Play): void {
  const g = gameOf(c);
  const foul = isFoulFinish(c, seat, play); // 出す直前の向きで判定（§14.4）
  const prev = topPlay(g);
  removeFromHand(g, seat, play.cards);
  const fp: FieldPlay = { seat, play, via: 'turn' };
  g.field.push(fp);
  g.lastPlayer = seat;
  g.awaiting = [];
  emit(c, { type: 'play', seat, play, foul });

  const effects: Effect[] = [];
  for (const m of c.mods) effects.push(...(m.afterPlay?.(ruleCtx(c), fp, prev) ?? []));
  // ジョーカーだけの手（1枚出し・2枚組）に返す手段がなければ、すぐ場を流す（§2.5、§14.14）
  if (play.shape === 'group' && play.rank === null && !effects.some((e) => e.type === 'returnRound' || e.type === 'flush')) {
    effects.push({ type: 'flush', leader: seat, reason: 'jokerUnbeatable' });
  }
  const sorted = sortEffects(effects);
  for (const e of sorted.filter(isPreFinish)) if (applyStateEffect(c, e)) return;
  // 上がりの判定（返しの一周より前、§14.3）
  if ((g.hands[seat] ?? []).length === 0) {
    if (placeSeat(c, seat, foul ? 'foul' : 'finish')) return;
  }
  runFlowEffects(c, sorted.filter((e) => !isPreFinish(e)), seat);
}

/** 手番でパスする（検証は済んでいる前提）。 */
export function doPass(c: Ctx, seat: SeatId): void {
  const g = gameOf(c);
  g.awaiting = [];
  emit(c, { type: 'pass', seat });
  if (g.lastPlayer === null) {
    // 親のパス（出せる手が1つもないときだけ）: 場が流れた扱いにし、次の人が親になる（§2.4）
    clearFieldEffects(c);
    const next = nextSeatWhere(g, seat, (s) => isActive(g, s)) ?? seat;
    emit(c, { type: 'fieldCleared', reason: 'leaderPassed', leader: next });
    startTurn(c, next);
    return;
  }
  g.passed[seat] = true;
  advanceFrom(c, seat);
}

/** 返しの一周で返す、またはスキップする（検証は済んでいる前提）。 */
export function doRespond(c: Ctx, seat: SeatId, play: Play | null): void {
  const g = gameOf(c);
  const p = g.pending;
  if (p === null) return;
  g.awaiting = [];
  if (play === null) {
    emit(c, { type: 'respondSkip', seat });
    p.queue = p.queue.filter((s) => s !== seat);
    const next = p.queue[0];
    if (next === undefined) finishReturnRound(c, null, null);
    else startRespond(c, next);
    return;
  }
  removeFromHand(g, seat, play.cards);
  g.field.push({ seat, play, via: 'respond' });
  g.lastPlayer = seat;
  emit(c, { type: 'respond', seat, play });
  finishReturnRound(c, seat, play);
}

function finishReturnRound(c: Ctx, by: SeatId | null, play: Play | null): void {
  const g = gameOf(c);
  const p = g.pending;
  if (p === null) return;
  g.pending = null;
  emit(c, { type: 'returnRoundEnd', rule: p.rule, returnedBy: by });
  const mod = findModule(p.rule);
  const rc = ruleCtx(c);
  if (by !== null && play !== null) {
    // 返した人の手札が0枚なら、そこで上がる（反則ではない、§14.3）
    if ((g.hands[by] ?? []).length === 0) {
      if (placeSeat(c, by, 'finish')) return;
    }
    runFlowEffects(c, mod?.onReturned?.(rc, by, play, p) ?? [], p.source);
    return;
  }
  runFlowEffects(c, [...(mod?.onReturnFailed?.(rc, p) ?? []), ...p.rest], p.source);
}

function removeFromHand(g: GameState, seat: SeatId, cards: readonly CardId[]): void {
  g.hands[seat] = (g.hands[seat] ?? []).filter((id) => !cards.includes(id));
}

// ---------- 順位 ----------

/**
 * 順位を確定する唯一の関数（design §8.1）。上がりは上から、強制最下位は下から埋める。
 * 確定済みの席は二重に確定しない。残りが1人になったらその人も確定する。ゲームが終わったら true。
 */
export function placeSeat(c: Ctx, seat: SeatId, reason: PlaceReason): boolean {
  const g = gameOf(c);
  if (isPlaced(g, seat)) return false;
  if (reason === 'foul' || reason === 'dethrone') {
    if (reason === 'dethrone') {
      const discarded = sortCardIds(g.hands[seat] ?? []);
      g.discard.push(...discarded);
      g.hands[seat] = [];
      emit(c, { type: 'dethrone', seat, discarded });
    }
    g.bottomOrder.push(seat);
  } else {
    g.topOrder.push(seat);
  }
  g.placeReasons[seat] = reason;
  const place = placeOf(g, seat) as Place;
  emit(c, { type: 'placed', seat, place, reason });
  if (g.awaiting.some((a) => a.seat === seat)) g.awaiting = g.awaiting.filter((a) => a.seat !== seat);
  if (g.pending !== null) g.pending.queue = g.pending.queue.filter((s) => s !== seat);

  if (place === 1) {
    g.firstPlaceHandCounts = g.hands.map((h) => h.length);
    const effects: Effect[] = [];
    for (const m of c.mods) effects.push(...(m.onFirstPlace?.(ruleCtx(c), seat) ?? []));
    for (const e of sortEffects(effects)) if (applyStateEffect(c, e)) return true;
  }
  const rest = activeSeats(g);
  if (rest.length === 1) return placeSeat(c, rest[0] as SeatId, 'last');
  if (rest.length === 0) {
    endGame(c);
    return true;
  }
  return false;
}

const DELTAS: Record<Place, number> = { 1: 2, 2: 1, 3: -1, 4: -2 };

export function computeStandings(scores: readonly number[]): { seat: SeatId; score: number; rank: number }[] {
  const rows = SEATS.map((seat) => ({ seat, score: scores[seat] ?? 0 }));
  rows.sort((a, b) => b.score - a.score || a.seat - b.seat);
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.score > r.score).length }));
}

function endGame(c: Ctx): void {
  const g = gameOf(c);
  const s = c.s;
  const places = SEATS.map((seat) => placeOf(g, seat) as Place);
  const deltas = places.map((p) => DELTAS[p]);
  s.scores = s.scores.map((v, i) => v + (deltas[i] ?? 0));
  s.results.push({ gameNo: s.gameNo, places: places.slice(), deltas: deltas.slice() });
  g.awaiting = [];
  g.pending = null;
  emit(c, { type: 'gameEnd', places: places.slice(), deltas: deltas.slice(), scores: s.scores.slice() });
  const count = s.config.gameCount;
  if (count !== null && s.gameNo >= count) {
    s.phase = 'matchResult';
    emit(c, { type: 'matchEnd', standings: computeStandings(s.scores) });
  } else {
    s.phase = 'gameResult';
  }
}
