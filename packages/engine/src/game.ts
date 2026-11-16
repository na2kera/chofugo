// 中心の処理: 手番、パス、場の流れ、効果の列、返しの一周、順位の確定。
// ルールごとの判断はすべて rules/ のモジュールに問い合わせる。

import { sortCardIds, type CardId } from './cards.ts';
import {
  beats,
  enumerateGroupSets,
  enumerateRunSets,
  interpretations,
  isUnbeatableJokers,
  strongerRun,
} from './hand.ts';
import { activeModules, findModule, type RuleCtx, type RuleModule } from './rules/index.ts';
import { banViolation, canSkipPlay, decideAbilityGrant, hasUnused } from './abilities.ts';
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

/** モジュールの制限と、特権の独裁の制限（ignore にある種類は無視する。ban を無視する手はない）。 */
function restriction(c: Ctx, play: Play, seat: SeatId, ignore: readonly ViolationKind[]): Violation | null {
  for (const m of c.mods) {
    const v = m.restrictPlay?.(ruleCtx(c), play, seat) ?? null;
    if (v !== null && !ignore.includes(v.kind)) return v;
  }
  const b = banViolation(gameOf(c), play);
  if (b !== null && !ignore.includes(b.kind)) return b;
  return null;
}

/** 場の制限（種類・枚数・強さ）。ignore にある種類は無視する。 */
function fieldViolation(g: GameState, play: Play, ignore: readonly ViolationKind[]): Violation | null {
  const top = topPlay(g);
  if (top === null) return null;
  const check = (kind: ViolationKind, ok: boolean): Violation | null => (ok || ignore.includes(kind) ? null : { kind });
  return (
    check('fieldShape', top.play.shape === play.shape) ??
    check('fieldSize', top.play.cards.length === play.cards.length) ??
    check('notStronger', beats(play, top.play, isReversed(g)))
  );
}

/** この手が無視する制限の種類（有効なモジュールの playIgnores を集める。砂嵐）。 */
function playIgnores(c: Ctx, play: Play): ViolationKind[] {
  const out: ViolationKind[] = [];
  for (const m of c.mods) for (const k of m.playIgnores?.(ruleCtx(c), play) ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

/** 手番で出す手として正しいか。場の制限とモジュールの制限の両方から、無視する種類を除く（design-2 §2.3）。 */
function turnViolation(c: Ctx, seat: SeatId, play: Play): Violation | null {
  const ignore = playIgnores(c, play);
  return fieldViolation(gameOf(c), play, ignore) ?? restriction(c, play, seat, ignore);
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

/**
 * 手番の席が出せる手の一覧。手札と全員に見えている情報だけで決まる。
 * 場の種類と枚数で列挙した組に、モジュールの extraSets（砂嵐）の組を足す（同じカード・同じ形は1つにまとめる）。
 */
export function legalTurnPlays(c: Ctx, seat: SeatId): LegalPlay[] {
  const g = gameOf(c);
  const hand = g.hands[seat] ?? [];
  const top = topPlay(g);
  const size = top === null ? null : top.play.cards.length;
  const all = enabledShapes(c);
  const shapes = all.filter((sh) => top === null || sh === top.play.shape);
  const out: LegalPlay[] = [];
  const seen = new Set<string>();
  const skipAvailable = hasUnused(g, seat, 'skip');
  const add = (cards: CardId[], sh: Shape) => {
    const key = `${sh}:${cards.join(',')}`;
    if (seen.has(key)) return;
    const r = interpretTurnPlay(c, seat, cards, sh);
    if (!r.ok) return;
    seen.add(key);
    const lp: LegalPlay = { cards, shape: sh, play: r.play, foul: isFoulFinish(c, seat, r.play) };
    if (skipAvailable && canSkipPlay(c, seat, r.play)) lp.canSkip = true;
    out.push(lp);
  };
  for (const sh of shapes) {
    const sets = sh === 'group' ? enumerateGroupSets(hand, size) : enumerateRunSets(hand, size);
    for (const cards of sets) add(cards, sh);
  }
  const rc = ruleCtx(c);
  for (const m of c.mods) {
    for (const set of m.extraSets?.(rc, seat) ?? []) {
      const cards = sortCardIds(set);
      if (!cards.every((id) => hand.includes(id))) continue;
      for (const sh of all) add(cards, sh);
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

function startChoiceAwait(c: Ctx, seat: SeatId): void {
  const g = gameOf(c);
  g.awaiting = [{ id: c.s.nextAwaitId++, seat, kind: 'choice', timer: 'choice' }];
}

/** 手番の対戦を始める（交換のあと、特権の選択のあと、または交換のない1ゲーム目）。最初の親を決めて手番を作る。 */
export function beginPlay(c: Ctx): void {
  const g = gameOf(c);
  c.s.phase = 'play';
  g.awaiting = [];
  // 最初の親と義務のカードは、交換が終わった時点の手札で決め直す（design-2 §2.3）
  applyStarterRules(c);
  startTurn(c, g.starter);
}

// ---------- 最初の親 ----------

/**
 * 手番の対戦を始めるとき（交換のあと。交換のない1ゲーム目は配った直後）に、モジュールに最初の親と義務のカードを聞く。
 * どのモジュールも親を決めなければ、g.starter（その1の決まりで決めた値）のまま（design-2 §2.3）。
 */
export function applyStarterRules(c: Ctx): void {
  const g = gameOf(c);
  const rc = ruleCtx(c);
  for (const m of c.mods) {
    const s = m.chooseStarter?.(rc) ?? null;
    if (s !== null) {
      g.starter = s;
      break;
    }
  }
  let opening: CardId | null = null;
  for (const m of c.mods) {
    opening = m.openingCard?.(rc) ?? null;
    if (opening !== null) break;
  }
  g.openingCard = opening;
}

// ---------- 効果 ----------

/** 効果の優先順（小さいほうが先。同じ値は集めた順。design-2 §2.2）。 */
const EFFECT_PRIORITY: Record<Effect['type'], number> = {
  toggleRevolution: 0, // 革命を先に（§6.0.1）
  setTempReverse: 1, // 数字の効果
  setSuitLock: 1,
  clearSuitLock: 1,
  setSeqLock: 1,
  clearSeqLock: 1,
  setOrderReverse: 1,
  clearOpening: 1,
  handChoice: 2, // 自分の手札を動かす効果（7渡し・10捨て）
  finishCheck: 3, // 上がりの判定（返しの一周より前、§14.3）
  forceLast: 3,
  returnRound: 4,
  skip: 5,
  flush: 6,
};

function sortEffects(effects: Effect[]): Effect[] {
  return effects
    .map((e, i) => ({ e, i }))
    .sort((a, b) => EFFECT_PRIORITY[a.e.type] - EFFECT_PRIORITY[b.e.type] || a.i - b.i)
    .map((x) => x.e);
}

/** 状態だけを変える効果を処理する。ゲームが終わったら true。流れを変える効果は runEffects で扱う。 */
function applyStateEffect(c: Ctx, e: Effect, source: SeatId | null = null): boolean {
  const g = gameOf(c);
  switch (e.type) {
    case 'toggleRevolution':
      g.revolution = !g.revolution;
      if (source !== null) g.revolutionBy = source; // 最後に革命を切り替えた席（その3の CPU の判断に使う）
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
    case 'setSeqLock': {
      const established = g.seqLock === null;
      g.seqLock = { suits: e.suits.slice(), rank: e.rank };
      // 出来事は成立したときだけ（連番の更新では出さない）
      if (established) emit(c, { type: 'seqLock', suits: e.suits.slice() });
      return false;
    }
    case 'clearSeqLock':
      g.seqLock = null;
      return false;
    case 'setOrderReverse':
      g.orderReversed = e.active;
      g.direction = e.active ? -1 : 1;
      emit(c, { type: 'orderReverse', active: e.active });
      return false;
    case 'clearOpening':
      g.openingCard = null;
      return false;
    case 'forceLast':
      return placeSeat(c, e.seat, e.reason);
    case 'handChoice':
    case 'finishCheck':
    case 'returnRound':
    case 'skip':
    case 'flush':
      return false;
  }
}

/**
 * 効果の列を先頭から1つずつ処理する（design-2 §2.2）。source は手を出した人。
 * 待ちが必要になったら、残りを pending.rest に保存して止まる。列を最後まで処理したら、source の次へ手番を送る。
 */
export function runEffects(c: Ctx, source: SeatId, effects: readonly Effect[]): void {
  const g = gameOf(c);
  let skip = 0;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i] as Effect;
    switch (e.type) {
      case 'handChoice': {
        if ((g.hands[source] ?? []).length === 0) break; // 手札が0枚なら選択をはさまない（§16.4）
        const mod = findModule(e.rule);
        // 7渡しの相手は、待ちを作る時点の向きで次の、まだ上がっていない人（パス済みでもよい）
        const to = mod?.choiceTarget === 'give' ? nextSeatWhere(g, source, (s) => isActive(g, s)) : null;
        g.pending = { type: 'choice', rule: e.rule, seat: source, max: e.max, to, rest: effects.slice(i + 1) };
        emit(c, { type: 'choiceStart', rule: e.rule, seat: source, max: e.max, to });
        startChoiceAwait(c, source);
        return;
      }
      case 'finishCheck':
        if ((g.hands[source] ?? []).length === 0 && placeSeat(c, source, e.foul ? 'foul' : 'finish')) return;
        break;
      case 'returnRound': {
        const rest = effects.slice(i + 1);
        // 省く条件は、一周を始める直前の最新の状態で評価し直す（decisions §14.14）
        const mod = findModule(e.rule);
        // 独裁で返しに使う数字が封じられていれば、返せないことが全員に分かるので省く（特権なしでは ban はいつも null）
        const banned = mod?.returnRank !== undefined && g.ban === mod.returnRank;
        if (banned || (mod?.canStartReturnRound !== undefined && !mod.canStartReturnRound(ruleCtx(c), source))) {
          runEffects(c, source, [...(mod.onReturnRoundSkipped?.(ruleCtx(c), source) ?? []), ...rest]);
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
      case 'skip':
        skip += e.count; // K スキップと特権のスキップを合算する（§5.8）
        break;
      case 'flush':
        flushField(c, e.leader, e.reason); // 飛ばす人数は捨てる
        return;
      default:
        if (applyStateEffect(c, e, source)) return;
    }
  }
  advanceFrom(c, source, skip);
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
  g.ban = null; // 独裁は場が流れると解除（親のパスで流れた扱いになるときも同じ）
  const effects: Effect[] = [];
  for (const m of c.mods) effects.push(...(m.onFieldCleared?.(ruleCtx(c)) ?? []));
  for (const e of sortEffects(effects)) applyStateEffect(c, e);
}

/**
 * 手番を from の次へ送る。最後に出した人の席に着いたら場が流れる（§14.1）。
 * skip（K スキップ）が残っていれば、残っていてパスしていない席を1人ずつ飛ばす（パス扱いにしない。design-2 §2.4）。
 */
function advanceFrom(c: Ctx, from: SeatId, skip = 0): void {
  const g = gameOf(c);
  let remaining = skip;
  const skipped: SeatId[] = [];
  const emitSkipped = () => {
    if (skipped.length > 0) emit(c, { type: 'skipped', by: from, seats: skipped.slice() });
  };
  for (let i = 1; i <= 4; i++) {
    const s = stepSeat(g, from, i);
    if (s === g.lastPlayer) {
      emitSkipped();
      flushField(c, s, 'allPassed');
      return;
    }
    if (isActive(g, s) && g.passed[s] !== true) {
      if (remaining > 0) {
        remaining--;
        skipped.push(s);
        continue;
      }
      emitSkipped();
      startTurn(c, s);
      return;
    }
  }
  emitSkipped();
  // 場が空なのに手番を送る場面はない（親のパスは leaderPass で扱う）
  const fallback = selfOrNextActive(g, stepSeat(g, from, 1));
  if (fallback !== null) startTurn(c, fallback);
}

// ---------- 操作の適用 ----------

/** 手番で手を出す（検証は済んでいる前提）。withSkip は特権のスキップ（付けられることは確かめ済み）。 */
export function doTurnPlay(c: Ctx, seat: SeatId, play: Play, withSkip = false): void {
  const g = gameOf(c);
  const foul = isFoulFinish(c, seat, play); // 出す直前の向きで判定（§14.4）
  const prev = topPlay(g);
  removeFromHand(g, seat, play.cards);
  const fp: FieldPlay = { seat, play, via: 'turn' };
  g.field.push(fp);
  g.lastPlayer = seat;
  g.awaiting = [];
  g.turnCount[seat] = (g.turnCount[seat] ?? 0) + 1;
  emit(c, { type: 'play', seat, play, foul });
  if (withSkip && g.abilities !== null) {
    g.abilities.used.push('skip');
    emit(c, { type: 'ability', seat, ability: 'skip' });
  }

  // ここまでは、どのモジュールも「出す直前の向き・効果を処理する前の状態」を見る
  const effects: Effect[] = [];
  for (const m of c.mods) effects.push(...(m.afterPlay?.(ruleCtx(c), fp, prev) ?? []));
  // 何にも負けないジョーカーだけの手（1枚出し・2枚組）に返す手段がなければ、すぐ場を流す（§2.5、§14.14）
  if (isUnbeatableJokers(play) && !effects.some((e) => e.type === 'returnRound' || e.type === 'flush')) {
    effects.push({ type: 'flush', leader: seat, reason: 'jokerUnbeatable' });
  }
  effects.push({ type: 'finishCheck', foul });
  if (withSkip) effects.push({ type: 'skip', count: 1 });
  runEffects(c, seat, sortEffects(effects));
}

/** 手番でパスする（検証は済んでいる前提）。 */
export function doPass(c: Ctx, seat: SeatId): void {
  const g = gameOf(c);
  g.awaiting = [];
  g.turnCount[seat] = (g.turnCount[seat] ?? 0) + 1;
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
  if (p === null || p.type !== 'returnRound') return;
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
  if (findModule(p.rule)?.returnToDiscard === true) {
    // 返したカードは捨て札へ。場のいちばん上と「最後に出した人」はそのまま（4止め、§16.2）
    g.discard.push(...play.cards);
    emit(c, { type: 'respond', seat, play, toDiscard: true });
  } else {
    g.field.push({ seat, play, via: 'respond' });
    g.lastPlayer = seat;
    emit(c, { type: 'respond', seat, play });
  }
  finishReturnRound(c, seat, play);
}

function finishReturnRound(c: Ctx, by: SeatId | null, play: Play | null): void {
  const g = gameOf(c);
  const p = g.pending;
  if (p === null || p.type !== 'returnRound') return;
  g.pending = null;
  emit(c, { type: 'returnRoundEnd', rule: p.rule, returnedBy: by });
  const mod = findModule(p.rule);
  const rc = ruleCtx(c);
  if (by !== null && play !== null) {
    // 返した人の手札が0枚なら、そこで上がる（反則ではない、§14.3）
    if ((g.hands[by] ?? []).length === 0) {
      if (placeSeat(c, by, 'finish')) return;
    }
    runEffects(c, p.source, mod?.onReturned?.(rc, by, play, p) ?? []);
    return;
  }
  runEffects(c, p.source, [...(mod?.onReturnFailed?.(rc, p) ?? []), ...p.rest]);
}

/** 7渡し・10捨てで選ぶ（検証は済んでいる前提）。cards が空なら渡さない・捨てない。 */
export function doChoose(c: Ctx, cards: readonly CardId[]): void {
  const g = gameOf(c);
  const p = g.pending;
  if (p === null || p.type !== 'choice') return;
  g.awaiting = [];
  g.pending = null;
  const chosen = sortCardIds(cards);
  if (chosen.length === 0) {
    emit(c, { type: 'choiceSkip', seat: p.seat, rule: p.rule });
  } else {
    removeFromHand(g, p.seat, chosen);
    if (p.to !== null) {
      g.hands[p.to] = sortCardIds([...(g.hands[p.to] ?? []), ...chosen]); // 受け取ったカードで手札を並べ直す
      emit(c, { type: 'give', from: p.seat, to: p.to, cards: chosen });
    } else {
      g.discard.push(...chosen);
      emit(c, { type: 'discard', seat: p.seat, rule: p.rule, cards: chosen });
    }
  }
  runEffects(c, p.seat, p.rest);
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
  if (g.pending !== null && g.pending.type === 'returnRound') g.pending.queue = g.pending.queue.filter((s) => s !== seat);

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
  if (s.config.abilities === true) decideAbilityGrant(c);
  emit(c, { type: 'gameEnd', places: places.slice(), deltas: deltas.slice(), scores: s.scores.slice() });
  const count = s.config.gameCount;
  if (count !== null && s.gameNo >= count) {
    s.phase = 'matchResult';
    emit(c, { type: 'matchEnd', standings: computeStandings(s.scores) });
  } else {
    s.phase = 'gameResult';
  }
}
