// テスト用の道具（公開しない）。

import { expect } from 'vitest';
import {
  ALL_ABILITY_IDS,
  applyAction,
  awaiting,
  createMatch,
  legalPlays,
  viewFor,
  type AbilityId,
  type AbilityState,
  type Action,
  type CardId,
  type GameEvent,
  type GameState,
  type MatchConfig,
  type MatchState,
  type RuleId,
  type SeatId,
} from '../index.ts';
import { nextInt, rngFromSeed, type RngState } from '../rng.ts';

const SUIT_OF: Record<string, string> = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' };
const RANK_OF: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14, '2': 15 };

/** 短い記法をカード ID にする。'S3' = スペードの3、'H10'、'DJ'、'CA'、'S2'、'X0'/'X1' = ジョーカー。 */
export function c(short: string): CardId {
  if (short === 'X0' || short === 'X1') return `joker-${short[1]}`;
  const suit = SUIT_OF[short[0] ?? ''];
  const r = short.slice(1);
  const rank = RANK_OF[r] ?? Number(r);
  if (suit === undefined || !Number.isInteger(rank)) throw new Error(`bad card ${short}`);
  return `${suit}-${rank}`;
}

export function cs(shorts: string): CardId[] {
  return shorts
    .split(/\s+/)
    .filter((x) => x.length > 0)
    .map(c);
}

export function cfg(rules: RuleId[], gameCount: 5 | 10 | null = 5): MatchConfig {
  return { matchId: 'm-test', rules, gameCount };
}

export function newMatch(rules: RuleId[], seed: [number, number, number, number] = [1, 2, 3, 4], gameCount: 5 | 10 | null = 5) {
  const r = createMatch(cfg(rules, gameCount), seed);
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

export type Setup = {
  rules: RuleId[];
  hands: string[]; // 席ごとの短い記法
  turn: SeatId;
  prevRanks?: (1 | 2 | 3 | 4)[];
  revolution?: boolean;
  tempReverse?: boolean;
  discard?: string;
  gameCount?: 5 | 10 | null;
  orderReversed?: boolean;
  openingCard?: CardId;
  /** 特権（その3）。holder の特権を確定済みの状態で置く。 */
  abilities?: { holder: SeatId; chosen: AbilityId[]; used?: AbilityId[]; slots?: number };
  /** 試合の設定の abilities（省略時は abilities の指定があれば true）。 */
  abilitiesConfig?: boolean;
};

/** 場面を直接作る（手番 turn の人が親で、場は空）。 */
export function scene(s: Setup): MatchState {
  const base = newMatch(s.rules, [9, 9, 9, 9], s.gameCount ?? 5).state;
  const game: GameState = {
    hands: s.hands.map((h) => cs(h)),
    discard: cs(s.discard ?? ''),
    field: [],
    lastPlayer: null,
    direction: s.orderReversed === true ? -1 : 1,
    orderReversed: s.orderReversed ?? false,
    passed: [false, false, false, false],
    topOrder: [],
    bottomOrder: [],
    placeReasons: [null, null, null, null],
    revolution: s.revolution ?? false,
    tempReverse: s.tempReverse ?? false,
    suitLock: null,
    seqLock: null,
    openingCard: s.openingCard ?? null,
    pending: null,
    awaiting: [{ id: 100, seat: s.turn, kind: 'turn', timer: 'turn' }],
    firstPlaceHandCounts: null,
    exchange: null,
    starter: s.turn,
    abilities: null,
    ban: null,
    peek: null,
    revolutionBy: null,
    turnCount: [0, 0, 0, 0],
  };
  if (s.abilities !== undefined) {
    const ab: AbilityState = {
      holder: s.abilities.holder,
      slots: s.abilities.slots ?? 3,
      draft: s.abilities.chosen.slice(),
      chosen: s.abilities.chosen.slice(),
      used: (s.abilities.used ?? []).slice(),
    };
    game.abilities = ab;
  }
  const abilitiesConfig = s.abilitiesConfig ?? s.abilities !== undefined;
  return {
    ...base,
    config: { ...base.config, abilities: abilitiesConfig },
    game,
    phase: 'play',
    prevRanks: s.prevRanks ?? null,
    nextAwaitId: 101,
  };
}

/** 場面を進める小さな道具。失敗したらテストを落とす。 */
export class Driver {
  state: MatchState;
  events: GameEvent[] = [];
  constructor(state: MatchState) {
    this.state = state;
  }
  get game(): GameState {
    return this.state.game as GameState;
  }
  current() {
    const w = awaiting(this.state)[0];
    if (w === undefined) throw new Error('nothing awaited');
    return w;
  }
  apply(a: Action) {
    const r = applyAction(this.state, a);
    if (!r.ok) throw new Error(`${a.type} failed: ${r.error.code} ${r.error.message}`);
    this.state = r.state;
    this.events.push(...r.events);
    return r.events;
  }
  try(a: Action) {
    return applyAction(this.state, a);
  }
  /** いま待たれている人が手を出す。 */
  play(seat: SeatId, shorts: string, extra: { shape?: 'group' | 'run'; confirmFoul?: boolean } = {}) {
    const w = this.current();
    expect(w.seat, `expected seat ${seat} to be awaited`).toBe(seat);
    return this.apply({ type: 'play', seat, awaitId: w.id, cards: cs(shorts), ...extra });
  }
  pass(seat: SeatId) {
    const w = this.current();
    expect(w.seat).toBe(seat);
    return this.apply({ type: 'pass', seat, awaitId: w.id });
  }
  respond(seat: SeatId, shorts: string | null) {
    const w = this.current();
    expect(w.seat).toBe(seat);
    expect(w.kind).toBe('respond');
    return this.apply({ type: 'respond', seat, awaitId: w.id, cards: shorts === null ? null : cs(shorts) });
  }
  /** 7渡し・10捨てで選ぶ（空文字 = 渡さない・捨てない）。 */
  choose(seat: SeatId, shorts: string) {
    const w = this.current();
    expect(w.seat).toBe(seat);
    expect(w.kind).toBe('choice');
    return this.apply({ type: 'choose', seat, awaitId: w.id, cards: cs(shorts) });
  }
  places() {
    return viewFor(this.state, 0).game?.places;
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
}

// ---------- 不変条件 ----------

/** JSON にそのまま書き出せる値か（undefined、Map、Set、クラスを含まない）。 */
export function assertJsonSafe(v: unknown, path = 'state'): void {
  if (v === null) return;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) throw new Error(`${path} is not finite`);
    return;
  }
  if (t !== 'object') throw new Error(`${path} has ${t}`);
  if (Array.isArray(v)) {
    v.forEach((x, i) => assertJsonSafe(x, `${path}[${i}]`));
    return;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) throw new Error(`${path} is not a plain object`);
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x === undefined) throw new Error(`${path}.${k} is undefined`);
    assertJsonSafe(x, `${path}.${k}`);
  }
}

export function allCards(g: GameState): CardId[] {
  return [...g.hands.flat(), ...g.field.flatMap((fp) => fp.play.cards), ...g.discard];
}

export function checkInvariants(s: MatchState): void {
  assertJsonSafe(s);
  const g = s.game;
  if (g === null) return;
  const cards = allCards(g);
  if (cards.length !== 54 || new Set(cards).size !== 54) {
    throw new Error(`card count ${cards.length}, unique ${new Set(cards).size}`);
  }
  const placed = [...g.topOrder, ...g.bottomOrder];
  if (new Set(placed).size !== placed.length || placed.length > 4) throw new Error('duplicate places');
  for (const w of awaiting(s)) {
    const v = viewFor(s, w.seat);
    const m = v.mine;
    if (m === null) throw new Error(`seat ${w.seat} awaited but has no options`);
    if (m.kind === 'turn' && m.plays.length === 0 && !m.canPass) throw new Error('turn without options');
    if (placed.includes(w.seat)) throw new Error('placed seat is awaited');
  }
  if (s.phase === 'gameResult' || s.phase === 'matchResult') {
    if (placed.length !== 4) throw new Error('game ended without 4 places');
    const last = s.results[s.results.length - 1];
    if (last === undefined) throw new Error('no result');
    if (last.deltas.reduce((a, b) => a + b, 0) !== 0) throw new Error('score sum not zero');
    if ([...last.places].sort().join() !== '1,2,3,4') throw new Error('places not unique');
  } else if (awaiting(s).length === 0) {
    throw new Error(`phase ${s.phase} awaits nobody`);
  }
}

// ---------- 自動対戦 ----------

export type Policy = 'cpu' | 'timeout' | 'random';

function pick<T>(rng: RngState, arr: readonly T[]): T {
  return arr[nextInt(rng, arr.length)] as T;
}

/** でたらめな（ただし正しい）操作を選ぶ。 */
export function randomAction(s: MatchState, rng: RngState): Action {
  const ws = awaiting(s);
  const w = pick(rng, ws);
  const m = viewFor(s, w.seat).mine;
  if (m === null) throw new Error('no mine');
  if (m.kind === 'turn') {
    const opts: Action[] = m.plays.map((p) => ({
      type: 'play',
      seat: w.seat,
      awaitId: w.id,
      cards: p.cards,
      shape: p.shape,
      confirmFoul: p.foul,
    }));
    if (m.canPass) opts.push({ type: 'pass', seat: w.seat, awaitId: w.id });
    // 特権（その3）: 持ち主のときだけ候補を足す（特権のない試合では乱数の引き方を変えない）
    if (m.skipAvailable) {
      for (const p of m.plays) {
        if (p.canSkip === true) {
          opts.push({ type: 'play', seat: w.seat, awaitId: w.id, cards: p.cards, shape: p.shape, confirmFoul: p.foul, withSkip: true });
        }
      }
    }
    for (const u of m.abilities) {
      if (!u.usable) continue;
      const base = { type: 'useAbility' as const, seat: w.seat, awaitId: w.id, ability: u.id };
      if (u.id === 'peek') opts.push({ ...base, target: pick(rng, u.targets ?? []) });
      else if (u.id === 'steal') opts.push({ ...base, target: pick(rng, u.targets ?? []), card: pick(rng, u.cards ?? []) });
      else if (u.id === 'ban') opts.push({ ...base, rank: pick(rng, u.ranks ?? []) });
      else opts.push(base);
    }
    return pick(rng, opts);
  }
  if (m.kind === 'abilitySelect') {
    // 0〜枠の数をでたらめに選ぶ。半分の確率で途中の保存（confirm: false）
    const ids = ALL_ABILITY_IDS.slice();
    const n = nextInt(rng, Math.min(m.slots, ids.length) + 1);
    const chosen: AbilityId[] = [];
    for (let i = 0; i < n; i++) chosen.push(...ids.splice(nextInt(rng, ids.length), 1));
    return { type: 'selectAbilities', seat: w.seat, awaitId: w.id, abilities: chosen, confirm: nextInt(rng, 2) === 0 };
  }
  if (m.kind === 'respond') {
    const opts: Action[] = m.plays.map((p) => ({ type: 'respond', seat: w.seat, awaitId: w.id, cards: p.cards }));
    opts.push({ type: 'respond', seat: w.seat, awaitId: w.id, cards: null });
    return pick(rng, opts);
  }
  const hand = viewFor(s, w.seat).game?.hand ?? [];
  if (m.kind === 'choice') {
    // 0〜max 枚をでたらめに選ぶ
    const h = hand.slice();
    const n = nextInt(rng, Math.min(m.max, h.length) + 1);
    const chosen: CardId[] = [];
    for (let i = 0; i < n; i++) chosen.push(...h.splice(nextInt(rng, h.length), 1));
    return { type: 'choose', seat: w.seat, awaitId: w.id, cards: chosen };
  }
  let cards: CardId[];
  if (m.role === 'lower') {
    const cand = m.candidates.slice();
    const chosen: CardId[] = [];
    for (let i = 0; i < m.choose; i++) chosen.push(...cand.splice(nextInt(rng, cand.length), 1));
    cards = [...m.forced, ...chosen];
  } else {
    const h = hand.slice();
    cards = [];
    for (let i = 0; i < m.count; i++) cards.push(...h.splice(nextInt(rng, h.length), 1));
  }
  return { type: 'exchangeGive', seat: w.seat, awaitId: w.id, cards };
}

/** awaitKinds: 待ちの種類（respond はルール付きで 'respond:ルール'）。 */
export type RunStats = { actions: number; games: number; events: GameEvent[] | null; types: Set<string>; awaitKinds: Set<string> };

/** 試合を最後まで回す。maxGames で途中のゲームまでに絞れる。 */
export function runMatch(
  config: MatchConfig,
  seed: [number, number, number, number],
  policy: Policy,
  opts: { check?: boolean; keepEvents?: boolean; maxActions?: number; endUnlimitedAfter?: number } = {},
): { state: MatchState; stats: RunStats } {
  const created = createMatch(config, seed);
  if (!created.ok) throw new Error(created.error.message);
  let s = created.state;
  const rng = rngFromSeed([seed[3] ^ 0x9e3779b9, seed[2] ^ 0x85ebca6b, seed[1] ^ 0xc2b2ae35, seed[0] ^ 0x27d4eb2f].map((x) => x >>> 0) as [number, number, number, number]);
  const stats: RunStats = {
    actions: 0,
    games: 1,
    events: opts.keepEvents ? created.events.slice() : null,
    types: new Set(),
    awaitKinds: new Set(),
  };
  for (const e of created.events) stats.types.add(e.type);
  const max = opts.maxActions ?? 4000;
  for (;;) {
    if (opts.check !== false) checkInvariants(s);
    if (s.phase === 'matchResult') break;
    for (const w of awaiting(s)) {
      const p = s.game?.pending ?? null;
      stats.awaitKinds.add(w.kind === 'respond' && p !== null ? `respond:${p.rule}` : w.kind);
    }
    let action: Action;
    if (s.phase === 'gameResult') {
      if (config.gameCount === null && s.gameNo >= (opts.endUnlimitedAfter ?? 3)) action = { type: 'endMatch' };
      else {
        action = { type: 'nextGame' };
        stats.games++;
      }
    } else if (policy === 'random') {
      action = randomAction(s, rng);
    } else {
      const w = pick(rng, awaiting(s));
      action = { type: 'auto', awaitId: w.id, policy };
    }
    const r = applyAction(s, action);
    if (!r.ok) throw new Error(`action failed at #${stats.actions}: ${JSON.stringify(action)} -> ${r.error.code} ${r.error.message}`);
    s = r.state;
    for (const e of r.events) stats.types.add(e.type);
    if (stats.events !== null) stats.events.push(...r.events);
    stats.actions++;
    if (stats.actions > max) throw new Error(`match did not finish within ${max} actions`);
  }
  return { state: s, stats };
}

export { legalPlays, viewFor, awaiting, applyAction };
