// ルールモジュールの登録表。並び順は効果を積む順（革命を先に、§6.0.1）。

import type { RuleId } from '../types.ts';
import { dethrone } from './dethrone.ts';
import { flushOn8 } from './flush_on_8.ts';
import { forbiddenFinish } from './forbidden_finish.ts';
import { revolution } from './revolution.ts';
import { runs } from './runs.ts';
import { spade3BeatsJoker } from './spade3_beats_joker.ts';
import { suitLock } from './suit_lock.ts';
import { tempReverseOnJ } from './temp_reverse_on_j.ts';
import type { RuleModule } from './types.ts';

export type { RuleCtx, RuleModule } from './types.ts';

/** 実装済みのモジュール（登録順 = 処理順）。その2以降はここに足す。 */
export const RULE_MODULES: readonly RuleModule[] = [
  revolution,
  flushOn8,
  tempReverseOnJ,
  suitLock,
  spade3BeatsJoker,
  runs,
  forbiddenFinish,
  dethrone,
];

export function findModule(id: RuleId): RuleModule | null {
  return RULE_MODULES.find((m) => m.id === id) ?? null;
}

/** 有効なルールのモジュールを登録順で返す。 */
export function activeModules(rules: readonly RuleId[]): RuleModule[] {
  return RULE_MODULES.filter((m) => rules.includes(m.id));
}
