// その1と同じ動きの検査（design-2 §2.9）。
// 定番8種だけの試合を、ルールの組み合わせ数通り × 種を数個、決まった操作の選び方で最後まで進め、
// 出来事の列と最後の状態の要点（得点・結果・乱数の状態・通し番号）を記録したファイルと完全に一致することを確かめる。
//
// 記録はその2の変更を入れる前の engine（コミット「engine: その1と同じ動きの検査の記録を追加」）で作った。
// ふだんは比較だけを行う（記録と違えば失敗する）。
//
// 記録を作り直す手順（定番8種の挙動を意図して変えたときだけ。ふつうは作り直さない）:
//   pnpm --filter @chofugo/engine exec vitest run src/compat.test.ts -u
// 記録のファイルは src/compat/ にある。作り直したら差分を確かめてからコミットする。
// 注意: 記録のファイルを消して実行すると、CI 以外では新しく書き出される（vitest のファイルスナップショットの決まり）。

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  awaiting,
  createMatch,
  viewFor,
  type Action,
  type GameEvent,
  type MatchState,
  type RuleId,
} from './index.ts';
import { nextInt, rngFromSeed, type RngState } from './rng.ts';

type Seed4 = [number, number, number, number];

/** 記録する試合の一覧。ここを変えると記録も作り直しになる。 */
const COMBOS: { name: string; rules: RuleId[] }[] = [
  { name: 'none', rules: [] },
  { name: 'recommended', rules: ['flush_on_8', 'revolution', 'spade3_beats_joker', 'runs', 'dethrone'] },
  {
    name: 'all8',
    rules: ['flush_on_8', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'runs', 'forbidden_finish', 'dethrone'],
  },
  { name: 'locks', rules: ['temp_reverse_on_j', 'suit_lock', 'forbidden_finish', 'runs'] },
  { name: 'flush', rules: ['flush_on_8', 'spade3_beats_joker', 'forbidden_finish', 'dethrone'] },
  { name: 'reverse', rules: ['revolution', 'temp_reverse_on_j', 'suit_lock'] },
];
const SEEDS: Seed4[] = [
  [1, 2, 3, 4],
  [20261117, 7, 0xabcdef, 99],
  [0xffffffff, 31337, 5, 271828],
];
/** cpu = いつも auto の cpu。mixed = 選べる操作から決まった乱数で選ぶ（反則上がりや返しの見送りの分岐も通す）。 */
type Mode = 'cpu' | 'mixed';

function pick<T>(rng: RngState, arr: readonly T[]): T {
  return arr[nextInt(rng, arr.length)] as T;
}

/** mixed の操作の選び方（この検査のためだけに固定した選び方。helpers.ts の randomAction とは独立させる）。 */
function mixedAction(s: MatchState, rng: RngState): Action {
  const w = awaiting(s)[0]!;
  const m = viewFor(s, w.seat).mine;
  if (m === null || m.kind === 'exchangeGive' || nextInt(rng, 3) === 0) {
    return { type: 'auto', awaitId: w.id, policy: nextInt(rng, 2) === 0 ? 'cpu' : 'timeout' };
  }
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
    return pick(rng, opts);
  }
  if (m.kind === 'respond') {
    const opts: Action[] = m.plays.map((p) => ({ type: 'respond', seat: w.seat, awaitId: w.id, cards: p.cards }));
    opts.push({ type: 'respond', seat: w.seat, awaitId: w.id, cards: null });
    return pick(rng, opts);
  }
  return { type: 'auto', awaitId: w.id, policy: 'cpu' };
}

function record(rules: RuleId[], seed: Seed4, mode: Mode): string {
  const created = createMatch({ matchId: 'compat', rules, gameCount: 5 }, seed);
  if (!created.ok) throw new Error(created.error.message);
  let s = created.state;
  const events: GameEvent[] = created.events.slice();
  const rng = rngFromSeed([seed[0] ^ 0x5bd1e995, seed[1], seed[2], (seed[3] + 1) >>> 0].map((x) => x >>> 0) as Seed4);
  let steps = 0;
  while (s.phase !== 'matchResult') {
    if (++steps > 20000) throw new Error('match did not finish');
    let a: Action;
    if (s.phase === 'gameResult') a = { type: 'nextGame' };
    else if (mode === 'cpu') a = { type: 'auto', awaitId: awaiting(s)[0]!.id, policy: 'cpu' };
    else a = mixedAction(s, rng);
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)} -> ${r.error.code}`);
    s = r.state;
    events.push(...r.events);
  }
  const summary = {
    scores: s.scores,
    results: s.results,
    rng: s.rng,
    nextAwaitId: s.nextAwaitId,
    nextEventSeq: s.nextEventSeq,
    actions: steps,
  };
  return [JSON.stringify(summary), ...events.map((e) => JSON.stringify(e))].join('\n') + '\n';
}

describe('その1と同じ動きの検査（定番8種だけの試合）', () => {
  for (const combo of COMBOS) {
    SEEDS.forEach((seed, si) => {
      const modes: Mode[] = si < 2 ? ['cpu', 'mixed'] : ['cpu'];
      for (const mode of modes) {
        it(`${combo.name} / 種${si} / ${mode}`, async () => {
          await expect(record(combo.rules, seed, mode)).toMatchFileSnapshot(`./compat/${combo.name}-s${si}-${mode}.jsonl`);
        });
      }
    });
  }
});
