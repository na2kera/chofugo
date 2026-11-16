// 秒数の定数（decisions §8、§9、§14.11、design §4.6、§8.2）。秒数はここだけで決める。
// テストでは、開発サーバーに CHOFUGO_TEST_MODE=1 を渡したときだけ、ルーム作成時に短い値へ差し替えられる（index.ts）。
// 本番の設定（wrangler.jsonc の vars）には CHOFUGO_TEST_MODE を入れないので、第三者は秒数を変えられない。

import type { AwaitTimer } from '@chofugo/engine';

export type Timing = {
  /** 自分の手番（30秒）。 */
  turnMs: number;
  /** 返しの一周（10秒）。 */
  respondMs: number;
  /** 7渡し・10捨ての選択（15秒、その2）。 */
  choiceMs: number;
  /** カード交換（60秒）。 */
  exchangeMs: number;
  /** 特権の選択（60秒、その3）。 */
  abilityMs: number;
  /** CPU と代役が考えているように見せる間（約1秒）。 */
  cpuDelayMs: number;
  /** 切断を検出してから代役に切り替えるまで（10秒）。 */
  disconnectGraceMs: number;
  /** 自動応答がこの時間なければ切断として扱う（約15秒）。 */
  heartbeatTimeoutMs: number;
  /** 人間の操作を待っている間・結果画面の間に、応答を確かめる間隔（15秒）。 */
  heartbeatCheckMs: number;
  /** 人間の接続が0になってからルームを閉じるまで（30分）。 */
  pausedCloseMs: number;
};

export const DEFAULT_TIMING: Readonly<Timing> = Object.freeze({
  turnMs: 30_000,
  respondMs: 10_000,
  choiceMs: 15_000,
  exchangeMs: 60_000,
  abilityMs: 60_000,
  cpuDelayMs: 1_000,
  disconnectGraceMs: 10_000,
  heartbeatTimeoutMs: 15_000,
  heartbeatCheckMs: 15_000,
  pausedCloseMs: 30 * 60_000,
});

const TIMING_KEYS = Object.keys(DEFAULT_TIMING) as (keyof Timing)[];

/** 待ちの種類ごとの人間の秒数。 */
export function humanTimerMs(t: Timing, timer: AwaitTimer): number {
  switch (timer) {
    case 'turn':
      return t.turnMs;
    case 'respond':
      return t.respondMs;
    case 'choice':
      return t.choiceMs;
    case 'exchange':
      return t.exchangeMs;
    case 'ability':
      return t.abilityMs;
  }
}

/**
 * テスト用の差し替えを読む。知らないキー、整数でない値、範囲外（10ms〜1時間）は null（ルーム作成を拒否する）。
 * 指定のないキーは既定値のまま。
 */
export function parseTimingOverride(v: unknown): Timing | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Timing = { ...DEFAULT_TIMING };
  for (const [k, val] of Object.entries(v)) {
    if (!(TIMING_KEYS as string[]).includes(k)) return null;
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 10 || val > 3_600_000) return null;
    out[k as keyof Timing] = val;
  }
  return out;
}
