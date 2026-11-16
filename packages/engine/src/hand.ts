// 手の認識（組と階段）。ルールに依存しない部分だけを置く（design §3.7「手の種類は直接書いてよい」）。

import {
  cardOf,
  compareCardIds,
  rankStrength,
  sortCardIds,
  suitIndex,
  type CardId,
  type Rank,
  type Suit,
} from './cards.ts';
import type { GroupPlay, Play, RunPlay, Shape } from './types.ts';

type Split = { reals: { id: CardId; suit: Suit; rank: Rank }[]; jokers: CardId[] };

/** カード ID の列を、本物のカードとジョーカーに分ける。知らない ID があれば null。 */
export function splitCards(ids: readonly CardId[]): Split | null {
  const reals: Split['reals'] = [];
  const jokers: CardId[] = [];
  for (const id of ids) {
    const c = cardOf(id);
    if (c === null) return null;
    if (c.kind === 'joker') jokers.push(id);
    else reals.push({ id, suit: c.suit, rank: c.rank });
  }
  jokers.sort(compareCardIds);
  return { reals, jokers };
}

/** 組として読む（本物のカードがすべて同じ数字）。読めなければ null。 */
export function interpretGroup(ids: readonly CardId[]): GroupPlay | null {
  if (ids.length === 0) return null;
  const sp = splitCards(ids);
  if (sp === null) return null;
  const first = sp.reals[0];
  const rank = first === undefined ? null : first.rank;
  if (sp.reals.some((r) => r.rank !== rank)) return null;
  return {
    shape: 'group',
    cards: sortCardIds(ids),
    rank,
    jokers: sp.jokers.map((card) => ({ card, rank, suit: null })),
  };
}

/** 階段として読める解釈をすべて返す（ジョーカーの位置ごと）。 */
export function interpretRuns(ids: readonly CardId[]): RunPlay[] {
  const n = ids.length;
  if (n < 3) return [];
  const sp = splitCards(ids);
  if (sp === null) return [];
  const first = sp.reals[0];
  if (first === undefined) return [];
  const suit = first.suit;
  if (sp.reals.some((r) => r.suit !== suit)) return [];
  const ranks = sp.reals.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) if (ranks[i] === ranks[i - 1]) return [];
  const minR = ranks[0] as number;
  const maxR = ranks[ranks.length - 1] as number;
  if (maxR - minR + 1 > n) return [];
  const result: RunPlay[] = [];
  const lowFrom = Math.max(3, maxR - n + 1);
  const lowTo = Math.min(minR, 15 - n + 1);
  const cards = sortCardIds(ids);
  for (let low = lowFrom; low <= lowTo; low++) {
    const missing: Rank[] = [];
    for (let r = low; r < low + n; r++) if (!(ranks as number[]).includes(r)) missing.push(r as Rank);
    const jokers = sp.jokers.map((card, i) => ({ card, rank: missing[i] as Rank, suit }));
    result.push({ shape: 'run', cards, suit, low: low as Rank, high: (low + n - 1) as Rank, jokers });
  }
  return result;
}

/** 指定した形の解釈をすべて返す。 */
export function interpretations(ids: readonly CardId[], shapes: readonly Shape[]): Play[] {
  const out: Play[] = [];
  for (const shape of shapes) {
    if (shape === 'group') {
      const g = interpretGroup(ids);
      if (g !== null) out.push(g);
    } else {
      out.push(...interpretRuns(ids));
    }
  }
  return out;
}

export function playSize(p: Play): number {
  return p.cards.length;
}

export function hasJoker(p: Play): boolean {
  return p.jokers.length > 0;
}

/**
 * 組の有効な数字（design-2 §6.1）。ジョーカーだけの組でも、激縛り中に代わりの数字を決めていればその数字。
 * 強さの比較・いちばん弱いカードの強さ・激縛りの判定と連番の更新に使う。数字の効果の判定には使わない（play.rank のまま）。
 */
export function groupRank(p: GroupPlay): Rank | null {
  return p.rank ?? p.jokers[0]?.rank ?? null;
}

/** 何にも負けないジョーカーだけの手か（数字を決めていないジョーカーだけの組）。スペ3返しと「すぐ流す」の判定に使う。 */
export function isUnbeatableJokers(p: Play): boolean {
  return p.shape === 'group' && p.rank === null && p.jokers.every((j) => j.rank === null);
}

/** 本物のカードのマーク（組はマーク順に並べる。階段は1つ）。 */
export function realSuits(p: Play): Suit[] {
  if (p.shape === 'run') return [p.suit];
  const suits: Suit[] = [];
  for (const id of p.cards) {
    const c = cardOf(id);
    if (c !== null && c.kind === 'normal') suits.push(c.suit);
  }
  return suits.sort((a, b) => suitIndex(a) - suitIndex(b));
}

/**
 * a が b より強いか（同じ形・同じ枚数が前提）。
 * 組: 数字の強さ。ジョーカーだけの組は最強で、何にも負けない。
 * 階段: a のいちばん弱いカードが b のいちばん強いカードより強い（decisions §6.8）。
 */
export function beats(a: Play, b: Play, reversed: boolean): boolean {
  if (a.shape === 'group' && b.shape === 'group') {
    const ra = groupRank(a);
    const rb = groupRank(b);
    const sa = ra === null ? Infinity : rankStrength(ra, reversed);
    const sb = rb === null ? Infinity : rankStrength(rb, reversed);
    return sa > sb;
  }
  if (a.shape === 'run' && b.shape === 'run') {
    return reversed ? a.high < b.low : a.low > b.high;
  }
  return false;
}

/** 手のいちばん弱いカードの強さ（その時点の向き）。CPU の並べ替えで使う。 */
export function weakestStrength(p: Play, reversed: boolean): number {
  if (p.shape === 'group') {
    const r = groupRank(p);
    return r === null ? Infinity : rankStrength(r, reversed);
  }
  return rankStrength(reversed ? p.high : p.low, reversed);
}

/** 階段の解釈のうち、その時点の向きでいちばん強いもの。 */
export function strongerRun(a: RunPlay, b: RunPlay, reversed: boolean): RunPlay {
  if (reversed) return a.low <= b.low ? a : b;
  return a.low >= b.low ? a : b;
}

// ---------- 列挙 ----------

function subsets<T>(items: readonly T[], minSize: number): T[][] {
  const out: T[][] = [];
  const total = 1 << items.length;
  for (let mask = 1; mask < total; mask++) {
    const s: T[] = [];
    for (let i = 0; i < items.length; i++) if (mask & (1 << i)) s.push(items[i] as T);
    if (s.length >= minSize) out.push(s);
  }
  return out;
}

function subsetsOfSize<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  return subsets(items, k).filter((s) => s.length === k);
}

/** 手札から作れる組のカード集合をすべて返す（size を指定するとその枚数だけ）。 */
export function enumerateGroupSets(hand: readonly CardId[], size: number | null): CardId[][] {
  const sp = splitCards(hand);
  if (sp === null) return [];
  const byRank = new Map<number, CardId[]>();
  for (const r of sp.reals) {
    const arr = byRank.get(r.rank);
    if (arr === undefined) byRank.set(r.rank, [r.id]);
    else arr.push(r.id);
  }
  const jokerSets: CardId[][] = [[], ...subsets(sp.jokers, 1)];
  const out: CardId[][] = [];
  for (const cards of byRank.values()) {
    for (const realSet of subsets(cards, 1)) {
      for (const js of jokerSets) {
        const n = realSet.length + js.length;
        if (size !== null && n !== size) continue;
        out.push(sortCardIds([...realSet, ...js]));
      }
    }
  }
  for (const js of subsets(sp.jokers, 1)) {
    if (size !== null && js.length !== size) continue;
    out.push(js.slice());
  }
  return out;
}

/** 手札から作れる階段のカード集合をすべて返す（size を指定するとその枚数だけ）。 */
export function enumerateRunSets(hand: readonly CardId[], size: number | null): CardId[][] {
  const sp = splitCards(hand);
  if (sp === null) return [];
  const J = sp.jokers.length;
  const out: CardId[][] = [];
  const bySuit = new Map<Suit, { id: CardId; rank: Rank }[]>();
  for (const r of sp.reals) {
    const arr = bySuit.get(r.suit);
    if (arr === undefined) bySuit.set(r.suit, [{ id: r.id, rank: r.rank }]);
    else arr.push({ id: r.id, rank: r.rank });
  }
  for (const cards of bySuit.values()) {
    cards.sort((a, b) => a.rank - b.rank);
    for (let i = 0; i < cards.length; i++) {
      for (let k = i; k < cards.length; k++) {
        const a = (cards[i] as { rank: Rank }).rank;
        const b = (cards[k] as { rank: Rank }).rank;
        const span = b - a + 1;
        const inRange = cards.slice(i, k + 1);
        const gaps = span - inRange.length;
        if (gaps > J) continue;
        const middle = inRange.slice(1, -1);
        const ends = i === k ? [inRange[0]!] : [inRange[0]!, inRange[inRange.length - 1]!];
        // 真ん中の本物のカードをジョーカーで置き換える選び方も含める
        const excludeSets: { id: CardId; rank: Rank }[][] = [[]];
        for (const s of subsets(middle, 1)) if (s.length <= J - gaps) excludeSets.push(s);
        for (const ex of excludeSets) {
          const included = [...ends, ...middle.filter((m) => !ex.includes(m))];
          const missing = gaps + ex.length;
          for (let used = missing; used <= J; used++) {
            const total = included.length + used;
            if (total < 3) continue;
            if (size !== null && total !== size) continue;
            // 端に置くジョーカーが 3〜2 の範囲に収まるか
            if (Math.max(3, b - total + 1) > Math.min(a, 16 - total)) continue;
            for (const js of subsetsOfSize(sp.jokers, used)) {
              out.push(sortCardIds([...included.map((c) => c.id), ...js]));
            }
          }
        }
      }
    }
  }
  return out;
}
