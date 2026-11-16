// 激縛り（decisions §6.7、§14.8、§16.1、design-2 §2.4、§6.1）。
// 同じマークで数字がちょうど1つ強い組が続くと成立し、その場が流れるまで「同じマークで、ちょうど1つ強い組」しか出せない。

import { RANKS, rankStrength, suitIndex, type Rank, type Suit } from '../cards.ts';
import { groupRank, hasJoker, realSuits } from '../hand.ts';
import type { Play } from '../types.ts';
import type { RuleModule } from './types.ts';

/** その向きで rank よりちょうど1つ強い数字。なければ null（通常の向きで2、逆で3がいちばん上）。 */
export function nextStrongerRank(rank: Rank, reversed: boolean): Rank | null {
  const want = rankStrength(rank, reversed) + 1;
  return RANKS.find((r) => rankStrength(r, reversed) === want) ?? null;
}

/** need（縛りのマーク）から have（本物のカードのマーク）を除いた残り。have が収まらなければ null。 */
function missingSuits(need: readonly Suit[], have: readonly Suit[]): Suit[] | null {
  const rest = need.slice();
  for (const s of have) {
    const i = rest.indexOf(s);
    if (i < 0) return null;
    rest.splice(i, 1);
  }
  return rest.sort((a, b) => suitIndex(a) - suitIndex(b));
}

function sameSuits(a: readonly Suit[], b: readonly Suit[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

export const sequenceLock: RuleModule = {
  id: 'sequence_lock',
  restrictPlay(ctx, play) {
    const lock = ctx.game.seqLock;
    if (lock === null) return null;
    // 組だけ（§14.8）。マークが合い、数字がその時点の向きでちょうど1つ強いこと
    if (play.shape !== 'group') return { kind: 'sequenceLock' };
    const need = nextStrongerRank(lock.rank, ctx.reversed);
    if (need === null || groupRank(play) !== need) return { kind: 'sequenceLock' };
    if (play.cards.length !== lock.suits.length || missingSuits(lock.suits, realSuits(play)) === null) {
      return { kind: 'sequenceLock' };
    }
    return null;
  },
  refinePlay(ctx, play): Play {
    const lock = ctx.game.seqLock;
    if (lock === null || play.shape !== 'group' || play.jokers.length === 0) return play;
    const rest = missingSuits(lock.suits, realSuits(play));
    if (rest === null) return play;
    if (play.rank === null) {
      // ジョーカーだけの手は、必要な数字・マークの代わり（GroupPlay.rank は null のまま、§16.1）
      const need = nextStrongerRank(lock.rank, ctx.reversed);
      if (need === null) return play;
      return { ...play, jokers: play.jokers.map((j, i) => ({ ...j, rank: need, suit: rest[i] ?? null })) };
    }
    // 本物の数字を含む組: マークがまだ決まっていないジョーカーに、足りないマークを割り当てる
    let k = 0;
    return { ...play, jokers: play.jokers.map((j) => (j.suit !== null ? j : { ...j, suit: rest[k++] ?? null })) };
  },
  afterPlay(ctx, played, prev) {
    const b = played.play;
    if (b.shape !== 'group') return [];
    const lock = ctx.game.seqLock;
    if (lock !== null) {
      // 継続: 連番を進める（出来事は出さない）
      const r = groupRank(b);
      return r === null ? [] : [{ type: 'setSeqLock', suits: lock.suits.slice(), rank: r }];
    }
    if (prev === null) return [];
    const a = prev.play;
    // 成立: どちらも組で、ジョーカーを含まず、マークの組み合わせが同じで、出す直前の向きでちょうど1つ強い
    if (a.shape !== 'group' || hasJoker(a) || hasJoker(b) || a.rank === null || b.rank === null) return [];
    const sb = realSuits(b);
    if (!sameSuits(realSuits(a), sb)) return [];
    if (nextStrongerRank(a.rank, ctx.reversed) !== b.rank) return [];
    return [{ type: 'setSeqLock', suits: sb, rank: b.rank }];
  },
  onFieldCleared(ctx) {
    return ctx.game.seqLock !== null ? [{ type: 'clearSeqLock' }] : [];
  },
};
