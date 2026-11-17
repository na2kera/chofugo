// その1と同じ動きの検査（design-2 §2.9）。
// 定番8種だけの試合を、ルールの組み合わせ数通り × 種を数個、決まった操作の選び方で最後まで進め、
// 出来事の列と最後の状態の要点（得点・結果・乱数の状態・通し番号）を記録したファイルと完全に一致することを確かめる。
//
// 定番8種の記録はその2の変更を入れる前の engine（コミット「engine: その1と同じ動きの検査の記録を追加」）で作った。
// s2- で始まる記録（16種すべて ON などの特権なしの試合）は、その3の変更を入れる前の engine（144e637）で作った（design-3 §2.8）。
// s3- で始まる記録（16種すべて ON・特権ありの試合）は、第2段階の変更を入れる前の engine（40fa6ee の時点）で作った（design-4 §6.4）。
// ふだんは比較だけを行う。記録と違えば失敗し、記録のファイルがなくても失敗する（黙って作り直さない。design-2 §6.6）。
//
// 記録を作る・作り直す手順（定番8種の挙動を意図して変えたときだけ。ふつうは作り直さない）:
//   CHOFUGO_COMPAT_RECORD=1 pnpm --filter @chofugo/engine exec vitest run src/compat.test.ts -u
// 環境変数を付けたときだけ、vitest のファイルスナップショットで src/compat/ に書き出す（-u で上書き）。
// 作り直したら差分を確かめてからコミットする。

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
  STAGE1_RULE_IDS,
} from './index.ts';
import { nextInt, rngFromSeed, type RngState } from './rng.ts';

type Seed4 = [number, number, number, number];

/** 第1段階の16種（記録を作ったときの並び）。ALL_RULE_IDS は第2段階で24種に増えたので、記録の試合には使わない。 */
const STAGE1_16: RuleId[] = STAGE1_RULE_IDS.slice();

/** 記録する試合の一覧。ここを変えると記録も作り直しになる。 */
type Combo = { name: string; rules: RuleId[]; abilities?: boolean };

const COMBOS: Combo[] = [
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
/**
 * その2の記録（その3の変更を入れる前の engine で作った。特権なし）。16種すべて ON と、応用のルールを含む組み合わせ。
 * 記録の作り方・比べ方は、上の定番8種の記録と同じ。名前は 's2-' で始める。
 */
const COMBOS_S2: Combo[] = [
  { name: 's2-all16', rules: STAGE1_16.slice() },
  { name: 's2-flushlock', rules: ['flush_on_8', 'block_flush_with_4', 'sequence_lock', 'suit_lock', 'runs', 'spade3_beats_joker'] },
  {
    name: 's2-numbers',
    rules: ['diamond3_start', 'triple3_trump', 'give_on_7', 'discard_on_10', 'dethrone', 'forbidden_finish', 'revolution'],
  },
  { name: 's2-order', rules: ['reverse_order_on_9', 'skip_on_k', 'spade3_beats_joker', 'temp_reverse_on_j', 'flush_on_8', 'runs'] },
];
/**
 * その3の記録（第2段階の変更を入れる前の engine で作った）。16種すべて ON・特権あり（超富豪モードと同じ）。
 * 名前は 's3-' で始める。mixed の選び方は前の記録と同じで、特権の選択と手番での特権の使用は auto に任せる（design-4 §6.4）。
 */
const COMBOS_S3: Combo[] = [{ name: 's3-all16-abilities', rules: STAGE1_16.slice(), abilities: true }];
const ALL_COMBOS = [...COMBOS, ...COMBOS_S2, ...COMBOS_S3];
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
  if (m.kind === 'choice') {
    // 7渡し・10捨て: 手札から 0〜max 枚をでたらめに選ぶ（定番8種の試合ではこの待ちが出ないので、その記録には影響しない）
    const hand = (s.game?.hands[w.seat] ?? []).slice();
    const n = nextInt(rng, Math.min(m.max, hand.length) + 1);
    const cards: string[] = [];
    for (let i = 0; i < n; i++) cards.push(...hand.splice(nextInt(rng, hand.length), 1));
    return { type: 'choose', seat: w.seat, awaitId: w.id, cards };
  }
  return { type: 'auto', awaitId: w.id, policy: 'cpu' };
}

function record(rules: RuleId[], seed: Seed4, mode: Mode, abilities = false): string {
  // 特権なしの記録は、前と同じく abilities を付けずに作る
  const created = createMatch(abilities ? { matchId: 'compat', rules, gameCount: 5, abilities } : { matchId: 'compat', rules, gameCount: 5 }, seed);
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

const RECORD_MODE = process.env['CHOFUGO_COMPAT_RECORD'] === '1';

/** 記録のファイル（ふだんの比較に使う。読むだけ）。キーは './compat/名前.jsonl'。 */
const RECORDS = import.meta.glob('./compat/*.jsonl', { query: '?raw', import: 'default', eager: true });

describe('変更前と同じ動きの検査（定番8種の試合、その2のルールを含む特権なしの試合、16種・特権ありの試合）', () => {
  it('記録のファイルの数が、試合の一覧と同じ', () => {
    if (RECORD_MODE) return;
    const expected = ALL_COMBOS.length * SEEDS.reduce((n, _, si) => n + (si < 2 ? 2 : 1), 0);
    expect(Object.keys(RECORDS)).toHaveLength(expected);
  });

  for (const combo of ALL_COMBOS) {
    SEEDS.forEach((seed, si) => {
      const modes: Mode[] = si < 2 ? ['cpu', 'mixed'] : ['cpu'];
      for (const mode of modes) {
        const path = `./compat/${combo.name}-s${si}-${mode}.jsonl`;
        it(`${combo.name} / 種${si} / ${mode}`, async () => {
          const actual = record(combo.rules, seed, mode, combo.abilities === true);
          if (RECORD_MODE) {
            await expect(actual).toMatchFileSnapshot(path);
            return;
          }
          const saved = RECORDS[path];
          if (saved === undefined) throw new Error(`記録のファイルがありません: ${path}（作る手順はこのファイルの先頭）`);
          // 1行ずつ比べて、最初に違う行を示す
          const a = actual.split('\n');
          const b = saved.split('\n');
          const at = a.findIndex((line, i) => line !== b[i]);
          if (at >= 0 || a.length !== b.length) {
            const i = at >= 0 ? at : Math.min(a.length, b.length);
            expect.fail(`${path} の ${i + 1} 行目が記録と違う\n記録: ${b[i] ?? '(なし)'}\n今回: ${a[i] ?? '(なし)'}`);
          }
          expect(actual).toBe(saved);
        });
      }
    });
  }
});
