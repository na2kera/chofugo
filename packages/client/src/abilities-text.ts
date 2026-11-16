// 特権の表示名と短い説明（design-3 §4.2）。engine には特権の ID だけがある。表示に関わる文言はこの表だけで持つ。
// 説明は自分たちの言葉で書く（参考商品の文言を写さない）。

import type { AbilityId } from '@chofugo/engine';

export type AbilityText = { name: string; text: string };

export const ABILITY_TEXT: Record<AbilityId, AbilityText> = {
  peek: { name: '透視', text: '相手1人の手札から 3枚を見る' },
  steal: { name: '強奪', text: '自分の1枚と 相手のランダムな1枚を交換' },
  forceFlush: { name: '強制流し', text: '場を流して 自分から始める' },
  ban: { name: '独裁', text: '数字を1つ 場が流れるまで出せなくする' },
  revolution: { name: '革命', text: '強さを逆にする' },
  skip: { name: 'スキップ', text: 'カードを出すとき 次の人を飛ばす' },
};

export function abilityName(id: AbilityId): string {
  return ABILITY_TEXT[id].name;
}
