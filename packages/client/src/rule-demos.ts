// ルールの説明の見本（design-5 §4、§6.1〜§6.3）。カードの小さなアニメーションを、コマの並びのデータで持つ。
// 再生は components/RuleDemo.tsx がどの見本も同じやり方で行う。データの検査は lib/help.ts の demoProblems。
// 見本は試合の設定とは関係のない決まった場面。通常の強さから始め、そのルールと前提のルールだけが ON のつもりで描く（§6.1）。
// ルール24種と特権6種の30個（並びは一覧と同じ）。§6.3 に同じ ID があるものは §6.3 の表、ほかは §4.3 の表。表から直した点は client-assumptions.md の L 節。

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

export const RULE_DEMOS: Record<RuleId, RuleDemoData> = {
  // ---------- 定番 ----------
  flush_on_8: [
    { field: ['spade-6'], note: '場に 6' },
    { field: ['heart-8'], note: '8 を出す' },
    { field: [], note: '場が流れて 出した人から' },
  ],
  revolution: [
    { field: ['spade-5', 'heart-5', 'diamond-5', 'club-5'], note: '同じ数字を 4枚' },
    { field: ['spade-5', 'heart-5', 'diamond-5', 'club-5'], badges: [{ kind: 'revolution' }], note: '強さが 逆になる' },
    { field: [], badges: [{ kind: 'revolution' }], note: '場が流れても 革命は続く' },
    { field: ['diamond-3'], badges: [{ kind: 'revolution' }], note: '数字は 3がいちばん強い' },
  ],
  runs: [
    { field: ['heart-4', 'heart-5', 'heart-6'], note: '同じマークで 3枚以上続く' },
    // 別のマークでも出せることが分かるように、2コマ目はスペードにする
    { field: ['spade-7', 'spade-8', 'spade-9'], note: '同じ枚数で もっと強い並び' },
  ],
  spade3_beats_joker: [
    { field: ['joker-0'], note: 'ジョーカーが 1枚' },
    { field: ['spade-3'], note: 'スペードの3で 返せる' },
    { field: [], note: '返すと 場が流れる' },
  ],
  dethrone: [
    { field: [], rows: [{ label: '前の大富豪', cards: [B, B, B] }], note: '前のゲームの 大富豪' },
    { field: ['club-6'], rows: [{ label: '前の大富豪', cards: [B, B, B] }], note: 'ほかの人が 先に1位になると' },
    { field: ['club-6'], rows: [{ label: '捨て札', cards: ['spade-13', 'heart-9', 'diamond-5'] }], note: '手札を捨てて 最下位になる' },
  ],
  temp_reverse_on_j: [
    { field: ['spade-9'], note: '場に 9' },
    { field: ['heart-11'], badges: [{ kind: 'tempReverse' }], note: 'J を出すと 強さが逆に' },
    { field: ['club-7'], badges: [{ kind: 'tempReverse' }], note: 'J より弱い数字を出す' },
    { field: [], note: '場が流れると 元に戻る' },
  ],
  suit_lock: [
    { field: ['heart-6'], note: '場に ハートの6' },
    { field: ['heart-9'], badges: [{ kind: 'suitLock', suits: ['heart'] }], note: '同じマークが続くと 縛り' },
    { field: ['heart-13'], badges: [{ kind: 'suitLock', suits: ['heart'] }], note: 'ハートしか 出せない' },
  ],
  forbidden_finish: [
    { field: ['spade-13'], rows: [{ label: 'あなた', cards: ['joker-0'] }], note: '最後の1枚が ジョーカー' },
    { field: ['joker-0'], rows: [{ label: 'あなた', cards: [] }], note: 'これで上がると 反則' },
    { field: ['joker-0'], note: '最下位になる' },
  ],

  // ---------- 応用 ----------
  block_flush_with_4: [
    { field: ['diamond-8'], note: '8 を出すと 8切り' },
    { field: ['diamond-8'], rows: [{ label: '相手', cards: ['spade-4', 'heart-4'], mark: ['spade-4', 'heart-4'] }], note: '4を2枚で 止められる' },
    { field: ['diamond-8'], rows: [{ label: '捨て札', cards: ['spade-4', 'heart-4'] }], note: '4 は捨て札へ 8 は残る' },
    { field: ['diamond-8'], note: '8を出した人の 次から続く' },
  ],
  sequence_lock: [
    { field: ['heart-6'], note: '場に ハートの6' },
    { field: ['heart-7'], badges: [{ kind: 'seqLock', suits: ['heart'] }], note: '同じマークで 1つ上' },
    // 設計の表は「場 ♥8・次は ハートの8 だけ」。場の8と食い違うので、場が ♥8 なら次は ♥9 と言う
    { field: ['heart-8'], badges: [{ kind: 'seqLock', suits: ['heart'] }], note: '次は ハートの9 だけ' },
  ],
  diamond3_start: [
    { field: [], rows: [{ label: 'あなた', cards: ['diamond-3', 'spade-5', 'heart-9'] }], note: 'ダイヤの3を 持つ人から' },
    { field: ['diamond-3'], rows: [{ label: 'あなた', cards: ['spade-5', 'heart-9'] }], note: '最初の1手に 必ず入れる' },
  ],
  triple3_trump: [
    { field: ['spade-15'], note: '場に 2' },
    { field: ['spade-3', 'heart-3', 'diamond-3'], note: '3を3枚。何にでも勝つ' },
    { field: [], note: 'すぐに 場が流れる' },
  ],
  give_on_7: [
    {
      field: ['club-7'],
      rows: [
        { label: 'あなた', cards: ['spade-4', 'heart-11'] },
        { label: '次の人', cards: [B, B] },
      ],
      note: '7 を1枚 出したら',
    },
    {
      field: ['club-7'],
      rows: [
        { label: 'あなた', cards: ['heart-11'] },
        { label: '次の人', cards: [B, B, 'spade-4'], mark: ['spade-4'] },
      ],
      note: '手札を1枚 次の人に渡せる',
    },
  ],
  discard_on_10: [
    { field: ['club-10'], rows: [{ label: 'あなた', cards: ['spade-4', 'heart-11'] }], note: '10 を1枚 出したら' },
    {
      field: ['club-10'],
      rows: [
        { label: 'あなた', cards: ['heart-11'] },
        { label: '捨て札', cards: ['spade-4'] },
      ],
      note: '手札を1枚 捨てられる',
    },
  ],
  reverse_order_on_9: [
    { field: ['club-9'], badges: [{ kind: 'orderReverse' }], note: '9 を出すと 逆回りに' },
    { field: [], note: '場が流れると 元に戻る' },
  ],
  // 3コマ目は、飛ばされた人のその次の人が、場の K より強い A を出した場面
  skip_on_k: [
    { field: ['club-13'], rows: [{ label: '次の人', cards: [B, B, B] }], note: 'K を1枚 出すと' },
    { field: ['club-13'], rows: [{ label: '飛ばされる人', cards: [B, B, B] }], note: '次の人を 1人飛ばす' },
    { field: ['diamond-14'], rows: [{ label: 'その次の人', cards: [B, B] }], note: 'その次の人が 出す' },
  ],

  // ---------- 特殊 ----------
  color_lock_on_5: [
    { field: ['heart-5'], badges: [{ kind: 'colorLock', color: 'red' }], note: '赤の5 を出すと' },
    { field: ['diamond-9'], badges: [{ kind: 'colorLock', color: 'red' }], note: '赤しか 出せない' },
    { field: [], note: '場が流れると 解除' },
  ],
  cancel_reverse_on_6: [
    { field: ['heart-11'], badges: [{ kind: 'tempReverse' }], note: 'J バック中に' },
    { field: ['spade-6'], note: '6 を出すと 解除' },
  ],
  triple6_revolution: [
    { field: ['spade-6', 'heart-6', 'diamond-6'], note: '6 を3枚（本物だけ）' },
    { field: ['spade-6', 'heart-6', 'diamond-6'], badges: [{ kind: 'revolution' }], note: '革命が起きる' },
  ],
  triple4_purge: [
    { field: ['spade-4', 'heart-4', 'diamond-4'], note: '4 を3枚（本物だけ）' },
    {
      field: ['spade-4', 'heart-4', 'diamond-4'],
      rows: [{ label: '捨て札', cards: ['joker-0', 'spade-15', 'heart-14'] }],
      note: 'ほかの全員が 強い1枚を捨てる',
    },
  ],
  triple9_salvage: [
    {
      field: ['spade-9', 'heart-9', 'diamond-9'],
      rows: [
        { label: 'あなた', cards: ['club-3', 'diamond-4', 'heart-13'] },
        { label: '捨て札', cards: ['spade-14', 'club-12'] },
      ],
      note: '9 を3枚（本物だけ）',
    },
    {
      // 置いた2枚は捨て札に加わり、全員に見える（decisions §15.6）
      field: ['spade-9', 'heart-9', 'diamond-9'],
      rows: [
        { label: 'あなた', cards: ['heart-13'] },
        { label: '捨て札', cards: ['spade-14', 'club-12', 'club-3', 'diamond-4'], mark: ['club-3', 'diamond-4'] },
      ],
      note: '手札を 2枚まで置く',
    },
    {
      field: ['spade-9', 'heart-9', 'diamond-9'],
      rows: [
        { label: 'あなた', cards: ['heart-13', 'spade-14', 'club-12'], mark: ['spade-14', 'club-12'] },
        { label: '捨て札', cards: ['club-3', 'diamond-4'] },
      ],
      note: '前からの捨て札を 受け取る',
    },
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
  call_discard_on_q: [
    { field: ['spade-12', 'heart-12'], note: 'Q を2枚 出したら' },
    { field: ['spade-12', 'heart-12'], badges: [{ kind: 'call', ranks: [7, 13] }], note: '数字を 2つまで宣言' },
    {
      field: ['spade-12', 'heart-12'],
      badges: [{ kind: 'call', ranks: [7, 13] }],
      rows: [{ label: '捨て札', cards: ['spade-7', 'heart-7', 'club-13'] }],
      note: '全員が その数字を捨てる',
    },
  ],
  quad2_instant_win: [
    { field: ['spade-15', 'heart-15', 'diamond-15', 'club-15'], rows: [{ label: 'あなた', cards: ['club-5', 'diamond-9'] }], note: '2 を4枚（本物だけ）' },
    {
      field: ['spade-15', 'heart-15', 'diamond-15', 'club-15'],
      badges: [{ kind: 'revolution' }],
      rows: [{ label: '捨て札', cards: ['club-5', 'diamond-9'] }],
      note: '残りを捨てて すぐ上がり',
    },
    { field: [], badges: [{ kind: 'revolution' }], note: '革命が起き 場は流れる' },
  ],
};

export const ABILITY_DEMOS: Record<AbilityId, RuleDemoData> = {
  peek: [
    { field: [], rows: [{ label: '相手', cards: [B, B, B, B] }], note: '相手を 1人選ぶ' },
    { field: [], rows: [{ label: '相手', cards: ['spade-15', 'heart-9', 'club-4', B] }], note: 'ランダムな3枚を 見る' },
  ],
  steal: [
    {
      field: [],
      rows: [
        { label: 'あなた', cards: ['club-3'] },
        { label: '相手', cards: [B, B, B] },
      ],
      note: '渡すカードと 相手を選ぶ',
    },
    {
      field: [],
      rows: [
        { label: 'あなた', cards: ['heart-14'], mark: ['heart-14'] },
        { label: '相手', cards: ['club-3', B, B] },
      ],
      note: 'ランダムな1枚と 交換',
    },
  ],
  forceFlush: [
    { field: ['spade-15'], note: '強いカードが 出ていても' },
    { field: [], note: '場を流して 自分から' },
  ],
  ban: [
    { field: ['spade-9'], note: '自分の番に 数字を選ぶ' },
    { field: ['spade-9'], badges: [{ kind: 'ban', rank: 15 }], note: '場が流れるまで 2は出せない' },
  ],
  revolution: [
    { field: [], note: '自分の番に 使うと' },
    { field: [], badges: [{ kind: 'revolution' }], note: '強さが 逆になる' },
  ],
  // 3コマ目は、飛ばされた人のその次の人が、場の 6 より強い 9 を出した場面
  skip: [
    { field: ['club-6'], rows: [{ label: '次の人', cards: [B, B, B] }], note: 'カードを 出すときに付ける' },
    { field: ['club-6'], rows: [{ label: '飛ばされる人', cards: [B, B, B] }], note: '次の人を 飛ばす' },
    { field: ['heart-9'], rows: [{ label: 'その次の人', cards: [B, B] }], note: 'その次の人が 出す' },
  ],
};
