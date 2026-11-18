// ルールの説明の見本（design-5 §4、§6.1〜§6.3）。カードの小さなアニメーションを、コマの並びのデータで持つ。
// 再生は components/RuleDemo.tsx がどの見本も同じやり方で行う。データの検査は lib/help.ts の demoProblems。
// 見本は試合の設定とは関係のない決まった場面。通常の強さから始め、そのルールと前提のルールだけが ON のつもりで描く（§6.1）。
// 第1弾は先に作る3つ（J バック・砂嵐・闇市）だけ。残りの27個は見た目の OK のあとで足し、そろったら Partial を外す。

import type { AbilityId, CallRank, CardId, Color, Rank, RuleId, Suit } from '@chofugo/engine';

/** 状態の札（対戦の画面の場の札と同じ部品で描く）。宣言（call）だけは見本にしかない札。 */
export type DemoBadge =
  | { kind: 'revolution' }
  | { kind: 'tempReverse' }
  | { kind: 'orderReverse' }
  | { kind: 'suitLock'; suits: Suit[] }
  | { kind: 'seqLock'; suits: Suit[] }
  | { kind: 'colorLock'; color: Color }
  | { kind: 'ban'; rank: Rank }
  | { kind: 'call'; ranks: CallRank[] };

export type DemoRow = {
  /** 行の見出し。「あなた」「相手」「次の人」は手札、「捨て札」は捨て札（§6.2）。 */
  label: string;
  /** その行のカード。'back' は裏向き（表と同じ大きさ）。0枚でも見出しとカード1枚ぶんの高さを残す。 */
  cards: (CardId | 'back')[];
  /** 強調するカード（受け取ったカードと同じ見せ方）。 */
  mark?: CardId[];
};

export type DemoFrame = {
  /** 場に出ているカード（いちばん上の手だけ）。空なら場は空。最大4枚。 */
  field: CardId[];
  /** 状態の札。 */
  badges?: DemoBadge[];
  /** 場の下に出す行。0〜2行、各4枚まで。 */
  rows?: DemoRow[];
  /** コマの説明（1行。16文字まで）。 */
  note: string;
};

/** 2〜4コマ。 */
export type RuleDemoData = DemoFrame[];

const B = 'back' as const;

export const RULE_DEMOS: Partial<Record<RuleId, RuleDemoData>> = {
  temp_reverse_on_j: [
    { field: ['spade-9'], note: '場に 9' },
    { field: ['heart-11'], badges: [{ kind: 'tempReverse' }], note: 'J を出すと 強さが逆に' },
    { field: ['club-7'], badges: [{ kind: 'tempReverse' }], note: 'J より弱い数字を出す' },
    { field: [], note: '場が流れると 元に戻る' },
  ],
  triple3_trump: [
    { field: ['spade-15'], note: '場に 2' },
    { field: ['spade-3', 'heart-3', 'diamond-3'], note: '3を3枚。何にでも勝つ' },
    { field: [], note: 'すぐに 場が流れる' },
  ],
  triple_a_trade: [
    { field: ['spade-14', 'heart-14', 'diamond-14'], note: 'A を3枚 出す' },
    {
      field: ['spade-14', 'heart-14', 'diamond-14'],
      rows: [
        { label: 'あなた', cards: ['club-3', 'diamond-4'] },
        { label: '相手', cards: [B, B, B] },
      ],
      note: '相手を選び 2枚を渡す',
    },
    {
      field: ['spade-14', 'heart-14', 'diamond-14'],
      rows: [
        { label: 'あなた', cards: ['spade-15', 'joker-0'], mark: ['spade-15', 'joker-0'] },
        { label: '相手', cards: ['club-3', 'diamond-4', B] },
      ],
      note: '相手のいちばん強い2枚と交換',
    },
  ],
};

export const ABILITY_DEMOS: Partial<Record<AbilityId, RuleDemoData>> = {};
