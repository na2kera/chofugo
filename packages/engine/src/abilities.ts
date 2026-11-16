// 超富豪モードの特権（decisions §5、§17、design-3 §2、§6）。
// 特権の枠、選択、使用、独裁の制限、スキップの条件、CPU の特権をここにまとめる。
// 特権のないゲーム（g.abilities が null）では、どの関数も状態・乱数・出来事に触れない。

import { cardOf, RANKS, sortCardIds, type CardId, type Rank } from './cards.ts';
import { cpuChoice } from './auto.ts';
import {
  activeSeats,
  beginPlay,
  emit,
  flushField,
  gameOf,
  isActive,
  isPlaced,
  isReversed,
  legalTurnPlays,
  placeOf,
  ruleCtx,
  topPlay,
  type Ctx,
} from './game.ts';
import { groupRank, isUnbeatableJokers } from './hand.ts';
import { nextInt, sample } from './rng.ts';
import {
  ABILITY_SLOT_THRESHOLDS,
  ALL_ABILITY_IDS,
  SEATS,
  type AbilityId,
  type AbilityState,
  type Action,
  type ActionError,
  type ActionErrorCode,
  type Awaiting,
  type GameEventBody,
  type GameState,
  type Play,
  type SeatId,
  type UsableAbility,
  type Violation,
} from './types.ts';

function err(code: ActionErrorCode, message: string): ActionError {
  return { code, message };
}

export function isAbilityId(v: unknown): v is AbilityId {
  return typeof v === 'string' && (ALL_ABILITY_IDS as readonly string[]).includes(v);
}

/** ALL_ABILITY_IDS の順に並べる。 */
function orderAbilities(ids: readonly AbilityId[]): AbilityId[] {
  return ALL_ABILITY_IDS.filter((id) => ids.includes(id));
}

/** その席が、選んで未使用の特権 id を持っているか。 */
export function hasUnused(g: GameState, seat: SeatId, id: AbilityId): boolean {
  const a = g.abilities;
  return a !== null && a.holder === seat && a.chosen !== null && a.chosen.includes(id) && !a.used.includes(id);
}

// ---------- 枠（§5.1、design-3 §2.2） ----------

/** 連覇のときの枠の数。相手3人の残り手札の合計で決める。 */
export function slotsForCount(total: number): number {
  return 1 + ABILITY_SLOT_THRESHOLDS.filter((t) => total > t).length;
}

/** ゲームの終わりに、次のゲームの特権の持ち主と枠を決める（config.abilities が真のときだけ呼ぶ）。 */
export function decideAbilityGrant(c: Ctx): void {
  const g = gameOf(c);
  const s = c.s;
  const first = SEATS.find((x) => placeOf(g, x) === 1);
  if (first === undefined) {
    s.abilityGrant = null;
    return;
  }
  const prev = s.prevRanks; // まだ前のゲームの順位（nextGame で書き換わる）
  const streak = prev !== null && prev[first] === 1;
  let slots = 1;
  if (streak) {
    const counts = g.firstPlaceHandCounts ?? [0, 0, 0, 0];
    const total = SEATS.filter((x) => x !== first).reduce<number>((n, x) => n + (counts[x] ?? 0), 0);
    slots = slotsForCount(total);
  }
  s.abilityGrant = { seat: first, slots };
}

// ---------- 選択（design-3 §2.3） ----------

/**
 * 交換が終わった時点で呼ぶ。特権の持ち主がいれば選択のフェーズに入り、いなければ対戦を始める。
 */
export function afterExchange(c: Ctx): void {
  const s = c.s;
  const g = gameOf(c);
  const grant = s.abilityGrant;
  if (s.config.abilities !== true || grant === null || !isActive(g, grant.seat)) {
    beginPlay(c);
    return;
  }
  s.abilityGrant = null;
  g.abilities = { holder: grant.seat, slots: grant.slots, draft: [], chosen: null, used: [] };
  s.phase = 'ability';
  emit(c, { type: 'abilitySelectStart', seat: grant.seat, slots: grant.slots });
  g.awaiting = [{ id: s.nextAwaitId++, seat: grant.seat, kind: 'abilitySelect', timer: 'ability' }];
}

function isAbilityList(v: unknown): v is unknown[] {
  if (!Array.isArray(v) || v.length > ALL_ABILITY_IDS.length * 4) return false;
  for (let i = 0; i < v.length; i++) if (!(i in v)) return false;
  return true;
}

/** selectAbilities の処理。検証して、途中の保存か確定を行う。 */
export function doSelectAbilities(c: Ctx, w: Awaiting, abilities: unknown, confirm: unknown): ActionError | null {
  const g = gameOf(c);
  const a = g.abilities;
  if (a === null || a.holder !== w.seat || a.chosen !== null) return err('wrongAwaitKind', 'nothing to select');
  if (!isAbilityList(abilities)) return err('malformed', 'abilities must be a list');
  if (typeof confirm !== 'boolean') return err('malformed', 'confirm must be a boolean');
  for (const id of abilities) if (!isAbilityId(id)) return err('invalidAbility', 'unknown ability');
  const ids = abilities as AbilityId[];
  if (new Set(ids).size !== ids.length) return err('invalidAbility', 'duplicate abilities');
  if (ids.length > a.slots) return err('invalidAbility', `at most ${a.slots} abilities`);
  a.draft = orderAbilities(ids);
  if (!confirm) return null; // 待ちは同じ番号のまま残る
  confirmAbilities(c, a, a.draft);
  return null;
}

function confirmAbilities(c: Ctx, a: AbilityState, ids: readonly AbilityId[]): void {
  const g = gameOf(c);
  a.chosen = orderAbilities(ids);
  a.draft = a.chosen.slice();
  g.awaiting = [];
  emit(c, { type: 'abilitiesChosen', seat: a.holder, count: a.chosen.length, abilities: a.chosen.slice() });
  beginPlay(c);
}

/** 特権の選択の auto。timeout = 途中の内容で確定、cpu = 透視を除く5種から乱数で枠の数だけ（§5.9）。 */
export function decideAbilitySelect(c: Ctx, w: Awaiting, policy: 'timeout' | 'cpu'): Action | null {
  const a = gameOf(c).abilities;
  if (a === null || a.chosen !== null) return null;
  const abilities =
    policy === 'timeout'
      ? a.draft.slice()
      : orderAbilities(sample(c.s.rng, ALL_ABILITY_IDS.filter((id) => id !== 'peek'), a.slots));
  return { type: 'selectAbilities', seat: w.seat, awaitId: w.id, abilities, confirm: true };
}

// ---------- 使える相手・カード・数字（§17.1、§17.2） ----------

/** 透視・強奪の対象: 自分以外で、まだ順位が確定しておらず、手札が1枚以上ある人。 */
export function abilityTargets(g: GameState, seat: SeatId): SeatId[] {
  return activeSeats(g).filter((x) => x !== seat && (g.hands[x] ?? []).length > 0);
}

/** 強奪で渡せるカード: 自分の手札のうち、義務のカード以外。 */
export function stealCards(g: GameState, seat: SeatId): CardId[] {
  return (g.hands[seat] ?? []).filter((id) => id !== g.openingCard);
}

/** 独裁で封じられる数字: 3〜2 の13種類から、義務のカードの数字を除く。 */
export function banRanks(g: GameState): Rank[] {
  const oc = g.openingCard === null ? null : cardOf(g.openingCard);
  const blocked = oc !== null && oc.kind === 'normal' ? oc.rank : null;
  return RANKS.filter((r) => r !== blocked);
}

/** 手番の view に載せる、使える特権（スキップ以外）。持ち主でなければ空。 */
export function usableAbilities(c: Ctx, seat: SeatId): UsableAbility[] {
  const g = gameOf(c);
  const out: UsableAbility[] = [];
  for (const id of ALL_ABILITY_IDS) {
    if (id === 'skip' || !hasUnused(g, seat, id)) continue;
    switch (id) {
      case 'peek': {
        const targets = abilityTargets(g, seat);
        out.push({ id, usable: targets.length > 0, targets });
        break;
      }
      case 'steal': {
        const targets = abilityTargets(g, seat);
        const cards = stealCards(g, seat);
        out.push({ id, usable: targets.length > 0 && cards.length > 0, targets, cards });
        break;
      }
      case 'forceFlush':
        out.push({ id, usable: topPlay(g) !== null });
        break;
      case 'ban': {
        const ranks = banRanks(g);
        out.push({ id, usable: ranks.length > 0, ranks });
        break;
      }
      case 'revolution':
        out.push({ id, usable: true });
        break;
    }
  }
  return out;
}

// ---------- 使用（design-3 §2.4、§6.1） ----------

function isSeat(v: unknown): v is SeatId {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

function isRank(v: unknown): v is Rank {
  return typeof v === 'number' && (RANKS as readonly number[]).includes(v);
}

type UseArgs = { ability: unknown; target?: unknown; card?: unknown; rank?: unknown };

/** useAbility の処理。成功したら、手番の待ちを新しい番号で作り直す（強制流しは新しい場の親としての手番）。 */
export function doUseAbility(c: Ctx, w: Awaiting, args: UseArgs): ActionError | null {
  const g = gameOf(c);
  const seat = w.seat;
  if (typeof args.ability !== 'string') return err('malformed', 'ability must be a string');
  if (!isAbilityId(args.ability)) return err('invalidAbility', 'unknown ability');
  const id = args.ability;
  if (id === 'skip') return err('invalidAbility', 'skip is attached to a play (withSkip)');
  if (!hasUnused(g, seat, id)) return err('invalidAbility', `seat ${seat} has no unused ${id}`);
  const a = g.abilities as AbilityState;
  const body: GameEventBody & { type: 'ability' } = { type: 'ability', seat, ability: id };

  switch (id) {
    case 'peek':
    case 'steal': {
      if (!isSeat(args.target)) return err('malformed', 'target must be 0..3');
      const target = args.target;
      if (!abilityTargets(g, seat).includes(target)) return err('abilityNotUsable', `seat ${target} cannot be targeted`);
      body.target = target;
      if (id === 'peek') {
        const cards = sortCardIds(sample(c.s.rng, g.hands[target] ?? [], 3));
        g.peek = { target, cards };
        body.cards = cards.slice();
      } else {
        if (typeof args.card !== 'string') return err('malformed', 'card must be a card id');
        const card = args.card;
        if (!(g.hands[seat] ?? []).includes(card)) return err('cardNotInHand', 'card not in hand');
        if (!stealCards(g, seat).includes(card)) return err('abilityNotUsable', 'the opening card cannot be given');
        const theirs = g.hands[target] ?? [];
        const taken = theirs[nextInt(c.s.rng, theirs.length)] as CardId;
        g.hands[seat] = sortCardIds([...(g.hands[seat] ?? []).filter((x) => x !== card), taken]);
        g.hands[target] = sortCardIds([...theirs.filter((x) => x !== taken), card]);
        body.given = card;
        body.taken = taken;
      }
      break;
    }
    case 'forceFlush':
      if (topPlay(g) === null) return err('abilityNotUsable', 'the field is empty');
      break;
    case 'ban': {
      if (!isRank(args.rank)) return err('malformed', 'rank must be 3..15');
      if (!banRanks(g).includes(args.rank)) return err('abilityNotUsable', 'the rank of the opening card cannot be banned');
      g.ban = args.rank;
      body.rank = args.rank;
      break;
    }
    case 'revolution':
      break;
  }

  a.used.push(id);
  emit(c, body);
  if (id === 'forceFlush') {
    // ふつうに場を流し、持ち主が親になる。新しい場の親としての手番なので continues を付けない（§6.1）
    g.awaiting = [];
    flushField(c, seat, 'forceFlush');
    return null;
  }
  if (id === 'revolution') {
    // 4枚組の革命と同じ効果と出来事
    g.revolution = !g.revolution;
    g.revolutionBy = seat;
    emit(c, { type: 'revolution', active: g.revolution });
  }
  // 手番は終わらない。待ちを新しい番号で作り直し、元の番号を continues に入れる（turnCount・パス状態は変えない）
  g.awaiting = [{ id: c.s.nextAwaitId++, seat, kind: 'turn', timer: 'turn', continues: w.id }];
  return null;
}

/** 透視の記録から、対象の手札を離れたカードを消す（§17.3、design-3 §6.8）。操作のたびに呼ぶ。 */
export function prunePeek(g: GameState | null): void {
  if (g === null || g.peek === null) return;
  const hand = g.hands[g.peek.target] ?? [];
  if (g.peek.cards.every((id) => hand.includes(id))) return;
  g.peek = { target: g.peek.target, cards: g.peek.cards.filter((id) => hand.includes(id)) };
}

// ---------- 独裁（design-3 §2.4） ----------

/** 独裁の制限。組は有効な数字（ジョーカーの代わりを含む）、階段は範囲に封じた数字を含むか。 */
export function banViolation(g: GameState, play: Play): Violation | null {
  const ban = g.ban;
  if (ban === null) return null;
  if (play.shape === 'group') return groupRank(play) === ban ? { kind: 'ban' } : null;
  return play.low <= ban && ban <= play.high ? { kind: 'ban' } : null;
}

// ---------- スキップ（design-3 §2.4、§6.4） ----------

/** 場を流すかもしれない手（8切りの8、砂嵐、何にも負けないジョーカーだけの手）。出す時点で決まる条件。 */
export function mayFlush(c: Ctx, play: Play): boolean {
  if (isUnbeatableJokers(play)) return true;
  const rc = ruleCtx(c);
  return c.mods.some((m) => m.mayFlush?.(rc, play) ?? false);
}

/** その手にスキップを付けられるか（未使用のスキップ、場を流すかもしれない手でない、出した直後の手札が1枚以上）。 */
export function canSkipPlay(c: Ctx, seat: SeatId, play: Play): boolean {
  const g = gameOf(c);
  if (!hasUnused(g, seat, 'skip')) return false;
  if ((g.hands[seat] ?? []).length <= play.cards.length) return false;
  return !mayFlush(c, play);
}

// ---------- CPU（design-3 §2.5） ----------

/** 手番の CPU: 特権を使うなら、その操作（1回の auto で1つ）。使わないなら null。乱数は使うときだけ引く。 */
export function cpuAbilityAction(c: Ctx, w: Awaiting): Action | null {
  const g = gameOf(c);
  const seat = w.seat;
  const a = g.abilities;
  if (a === null || a.holder !== seat || a.chosen === null) return null;
  const base = { type: 'useAbility' as const, seat, awaitId: w.id };
  // 1. 強奪: 渡せるカードと選べる相手があれば使う。渡すのはその時点の向きでいちばん弱いカード、相手は乱数
  if (hasUnused(g, seat, 'steal')) {
    const cards = stealCards(g, seat);
    const targets = abilityTargets(g, seat);
    const card = cpuChoice(cards, 1, isReversed(g))[0];
    if (card !== undefined && targets.length > 0) {
      const target = targets[nextInt(c.s.rng, targets.length)] as SeatId;
      return { ...base, ability: 'steal', target, card };
    }
  }
  // 2. 革命: (a) 最初の手番で、革命中でなく、手札の半分以上が8より弱い本物のカード (b) 革命中で、最後に切り替えたのが自分でない
  if (hasUnused(g, seat, 'revolution')) {
    const hand = g.hands[seat] ?? [];
    const weak = hand.filter((id) => {
      const card = cardOf(id);
      return card !== null && card.kind === 'normal' && card.rank < 8;
    }).length;
    const first = (g.turnCount[seat] ?? 0) === 0 && !g.revolution && hand.length > 0 && weak * 2 >= hand.length;
    const undo = g.revolution && g.revolutionBy !== seat;
    if (first || undo) return { ...base, ability: 'revolution' };
  }
  // 3. 独裁: 場が空（自分が親）なら、その時点の向きでいちばん強い数字を封じる。指定できなければ今回は使わない
  if (hasUnused(g, seat, 'ban') && topPlay(g) === null) {
    const rank: Rank = isReversed(g) ? 3 : 15;
    if (banRanks(g).includes(rank)) return { ...base, ability: 'ban', rank };
  }
  // 4. 強制流し: 場にカードが出ていて、出せる手が1つもない
  if (hasUnused(g, seat, 'forceFlush') && topPlay(g) !== null && legalTurnPlays(c, seat).length === 0) {
    return { ...base, ability: 'forceFlush' };
  }
  return null;
}

/** CPU がカードを出すときにスキップを付けるか（未使用、出す前の手札が3枚以下、その手に canSkip）。 */
export function cpuWantsSkip(g: GameState, seat: SeatId, canSkip: boolean): boolean {
  return canSkip && hasUnused(g, seat, 'skip') && (g.hands[seat] ?? []).length <= 3;
}

// ---------- 見える情報（design-3 §2.6） ----------

/** 全員に見える特権の要約。 */
export function publicAbilities(g: GameState): { holder: SeatId; slots: number; remaining: number; selecting: boolean } | null {
  const a = g.abilities;
  if (a === null) return null;
  let remaining = a.chosen === null ? a.slots : a.chosen.length - a.used.length;
  if (isPlaced(g, a.holder)) remaining = 0;
  return { holder: a.holder, slots: a.slots, remaining, selecting: a.chosen === null };
}
