// ルールの表示名と短い説明（design-client §5.4）。表示名は decisions §6.0 の表のとおり。
// engine にはルール ID だけがある。表示に関わる文言はこの表だけで持つ。

import type { RuleId } from '@chofugo/engine';

/**
 * name：表示名。text：短い説明。
 * lobbyLines：ロビーの2列に1行で入りきらない表示名を、2行に分けて出すときの分け方（design-2 §4.1。名前は縮めない・変えない）。
 */
export type RuleText = { name: string; text: string; lobbyLines?: [string, string] };

export const RULES_TEXT: Record<RuleId, RuleText> = {
  flush_on_8: { name: '8切り', text: '8を出すと場が流れて、出した人から次を始める。' },
  revolution: { name: '革命', text: '同じ数字4枚以上か、4枚以上の階段で強さが逆になる。もう一度起きると元に戻る。' },
  temp_reverse_on_j: { name: 'J バック', text: 'J を出すと、場が流れるまで強さが逆になる。' },
  spade3_beats_joker: { name: 'スペ3返し', text: 'ジョーカーが1枚で出たら、スペードの3を1枚出して返せる。返すと場が流れる。' },
  suit_lock: { name: '縛り', text: '同じマークが続けて出ると、場が流れるまでそのマークしか出せない。' },
  runs: { name: '階段', text: '同じマークで数字が3枚以上続く並びを出せる。' },
  forbidden_finish: { name: '禁止上がり', text: 'ジョーカー・いちばん強い数字・8切りの手で上がると、反則で最下位になる。' },
  dethrone: { name: '都落ち', text: '前の大富豪は、ほかの人が先に1位になるとその場で最下位になる。' },
  // その2（応用の8種）。説明文は自分たちの言葉で書く（参考商品の文言を写さない）
  block_flush_with_4: { name: '4止め', text: '8切りが起きたとき、4を2枚出すと8切りを止められる。止めたあとも8は場に残る。' },
  sequence_lock: { name: '激縛り', text: '同じマークで数字が1つ上のカードが続くと、場が流れるまで同じマークで次の数字しか出せない。' },
  diamond3_start: { name: 'ダイヤの3スタート', text: 'ダイヤの3を持つ人から始める。最初の1手には、ダイヤの3を必ず入れる。', lobbyLines: ['ダイヤの3', 'スタート'] },
  triple3_trump: { name: '砂嵐', text: '3を3枚そろえて出すと、場に何が出ていても勝ち、すぐに場が流れる。' },
  give_on_7: { name: '7渡し', text: '7を出したら、出した枚数まで手札を次の人に渡せる。渡さなくてもよい。' },
  reverse_order_on_9: { name: '9リバース', text: '9を出すと、場が流れるまで順番の回る向きが逆になる。' },
  discard_on_10: { name: '10捨て', text: '10を出したら、出した枚数まで手札を捨てられる。捨てなくてもよい。' },
  skip_on_k: { name: 'K スキップ', text: 'K を出すと、出した枚数の人数だけ順番を飛ばす。' },
};

/** ロビーに並べる順（見本の並び。左右2列）。大富豪モードの8種、カスタムモードでは「定番」の見出しの下。 */
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

/** カスタムモードの「応用」の見出しの下に並べる順（design-2 §4.1。左右2列）。 */
export const ADVANCED_RULE_ORDER: RuleId[] = [
  'block_flush_with_4',
  'sequence_lock',
  'diamond3_start',
  'triple3_trump',
  'give_on_7',
  'discard_on_10',
  'reverse_order_on_9',
  'skip_on_k',
];

export function ruleName(id: RuleId): string {
  return RULES_TEXT[id].name;
}
