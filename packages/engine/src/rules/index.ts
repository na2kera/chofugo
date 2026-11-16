// ルールモジュールの登録表。並び順は効果を積む順（革命を先に、§6.0.1）。

import type { RuleId } from '../types.ts';
import { blockFlushWith4 } from './block_flush_with_4.ts';
import { dethrone } from './dethrone.ts';
import { diamond3Start } from './diamond3_start.ts';
import { discardOn10 } from './discard_on_10.ts';
import { flushOn8 } from './flush_on_8.ts';
import { forbiddenFinish } from './forbidden_finish.ts';
import { giveOn7 } from './give_on_7.ts';
import { reverseOrderOn9 } from './reverse_order_on_9.ts';
import { revolution } from './revolution.ts';
import { runs } from './runs.ts';
import { sequenceLock } from './sequence_lock.ts';
import { skipOnK } from './skip_on_k.ts';
import { spade3BeatsJoker } from './spade3_beats_joker.ts';
import { suitLock } from './suit_lock.ts';
import { tempReverseOnJ } from './temp_reverse_on_j.ts';
import { triple3Trump } from './triple3_trump.ts';
import type { RuleModule } from './types.ts';

export type { RuleCtx, RuleModule } from './types.ts';

/**
 * 実装済みのモジュール（登録順 = 処理順）。効果は優先順で並べ直すので、登録順が効くのは同じ優先順の効果と、
 * 解釈の補い（refinePlay：マーク縛り → 激縛り）、出せない理由の先に見つかったものだけ。
 * その2の8種は、その1の8種の後ろに足した（定番8種だけの試合の動きを変えないため）。
 */
export const RULE_MODULES: readonly RuleModule[] = [
  revolution,
  flushOn8,
  tempReverseOnJ,
  suitLock,
  spade3BeatsJoker,
  runs,
  forbiddenFinish,
  dethrone,
  blockFlushWith4,
  sequenceLock,
  diamond3Start,
  triple3Trump,
  giveOn7,
  reverseOrderOn9,
  discardOn10,
  skipOnK,
];

export function findModule(id: RuleId): RuleModule | null {
  return RULE_MODULES.find((m) => m.id === id) ?? null;
}

/** 有効なルールのモジュールを登録順で返す。 */
export function activeModules(rules: readonly RuleId[]): RuleModule[] {
  return RULE_MODULES.filter((m) => rules.includes(m.id));
}
