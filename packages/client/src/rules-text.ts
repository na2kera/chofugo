// ルールの表示名と短い説明（design-client §5.4）。表示名は decisions §6.0 の表のとおり。
// engine にはルール ID だけがある。表示に関わる文言はこの表だけで持つ。

import type { RuleId } from '@chofugo/engine';

export type RuleText = { name: string; text: string };

export const RULES_TEXT: Partial<Record<RuleId, RuleText>> = {
  flush_on_8: { name: '8切り', text: '8を出すと場が流れて、出した人から次を始める。' },
  revolution: { name: '革命', text: '同じ数字4枚以上か、4枚以上の階段で強さが逆になる。もう一度起きると元に戻る。' },
  temp_reverse_on_j: { name: 'J バック', text: 'J を出すと、場が流れるまで強さが逆になる。' },
  spade3_beats_joker: { name: 'スペ3返し', text: 'ジョーカーが1枚で出たら、スペードの3を1枚出して返せる。返すと場が流れる。' },
  suit_lock: { name: '縛り', text: '同じマークが続けて出ると、場が流れるまでそのマークしか出せない。' },
  runs: { name: '階段', text: '同じマークで数字が3枚以上続く並びを出せる。' },
  forbidden_finish: { name: '禁止上がり', text: 'ジョーカー・いちばん強い数字・8切りの手で上がると、反則で最下位になる。' },
  dethrone: { name: '都落ち', text: '前の大富豪は、ほかの人が先に1位になるとその場で最下位になる。' },
};

/** ロビーに並べる順（見本の並び。左右2列）。 */
export const LOBBY_RULE_ORDER: RuleId[] = [
  'flush_on_8',
  'revolution',
  'runs',
  'spade3_beats_joker',
  'dethrone',
  'temp_reverse_on_j',
  'suit_lock',
  'forbidden_finish',
];

export function ruleName(id: RuleId): string {
  return RULES_TEXT[id]?.name ?? id;
}
