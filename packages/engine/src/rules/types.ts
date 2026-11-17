// ルールモジュールの形（design §3.7）。中心の処理は、登録されたモジュールに問い合わせるだけにする。

import type { CardId, Rank } from '../cards.ts';
import type {
  Effect,
  LeaderRule,
  FieldPlay,
  GameState,
  MatchState,
  ReturnRoundPending,
  Play,
  RuleId,
  SeatId,
  Shape,
  Violation,
  ViolationKind,
} from '../types.ts';

/** モジュールに渡す読み取り用の文脈。 */
export type RuleCtx = {
  readonly state: MatchState;
  readonly game: GameState;
  /** いまの強さの向きが逆か（革命と J バックの組み合わせ）。 */
  readonly reversed: boolean;
  isOn(id: RuleId): boolean;
  /** 全員に見えているカードか（捨て札か、いまの場に出ている）。 */
  isPublic(card: CardId): boolean;
  /** まだゲームに残っている席か。 */
  isActive(seat: SeatId): boolean;
};

export type ChoiceKind = 'give' | 'discard' | 'salvage' | 'trade' | 'call';

export type RuleModule = {
  id: RuleId;
  /** 前提のルール。 */
  requires?: readonly RuleId[];
  /** 有効にする手の形（階段）。 */
  shapes?: readonly Shape[];
  /** 出せる手を絞る（マーク縛り、激縛り、ダイヤの3の義務）。 */
  restrictPlay?(ctx: RuleCtx, play: Play, seat: SeatId): Violation | null;
  /** 解釈を補う（縛り中に、ジョーカーが代わりにするマークや数字を決める）。 */
  refinePlay?(ctx: RuleCtx, play: Play): Play;
  /** この手が無視する制限の種類（砂嵐）。場の制限（種類・枚数・強さ）も無視できる。 */
  playIgnores?(ctx: RuleCtx, play: Play): readonly ViolationKind[];
  /** 場の種類と枚数に関係なく、出せる手の候補に足すカードの組（砂嵐）。 */
  extraSets?(ctx: RuleCtx, seat: SeatId): CardId[][];
  /** 手番の対戦を始めるとき（交換のあと）に、最初の親を決める。決めないなら null。 */
  chooseStarter?(ctx: RuleCtx): SeatId | null;
  /** 手番の対戦を始めるとき、最初の1手に含める義務のあるカード（ダイヤの3）。なければ null。 */
  openingCard?(ctx: RuleCtx): CardId | null;
  /** 最初の親の決め方を変えるルール: gameStart の出来事に載せる名前。 */
  leaderRule?: LeaderRule;
  /**
   * 選択の効果（handChoice）を持つルール: 選択の種類。
   * give = 次の人へ渡す（7渡し）、discard = 捨て札へ（10捨て）、salvage = 捨て札と交換（銀河鉄道）、
   * trade = 相手と交換（闇市）、call = 数字を宣言して全員が捨てる（Q ボンバー）。
   */
  choiceKind?: ChoiceKind;
  /** 場を流すかもしれない手か（8切りの8、砂嵐）。特権のスキップを付けられない手の判定に使う（design-3 §2.4）。 */
  mayFlush?(ctx: RuleCtx, play: Play): boolean;
  /** 出したあとの効果（8切り、革命、J バック、縛りの成立、返しの一周の開始）。 */
  afterPlay?(ctx: RuleCtx, played: FieldPlay, prev: FieldPlay | null): Effect[];
  /** 反則上がりの判定。判定に使う向きは、出す直前のもの（decisions §14.4）。 */
  isFoulFinish?(ctx: RuleCtx, play: Play): boolean;
  /** 1位が確定したとき（都落ち）。 */
  onFirstPlace?(ctx: RuleCtx, seat: SeatId): Effect[];
  /** 場が流れたとき（縛り・J バックの解除）。 */
  onFieldCleared?(ctx: RuleCtx): Effect[];
  /** 返しの一周を持つルール: 一周を始める直前の状態で、一周を行うか（省く条件の評価し直し、§14.14）。 */
  canStartReturnRound?(ctx: RuleCtx, source: SeatId): boolean;
  /** 返しの一周を持つルール: 直前で省いたときの効果（残りの効果の前に処理する）。 */
  onReturnRoundSkipped?(ctx: RuleCtx, source: SeatId): Effect[];
  /** 返しの一周を持つルール: 返しに使う数字。独裁でこの数字が封じられていれば、一周を省く（design-3、decisions §17.5）。 */
  returnRank?: Rank;
  /** 返しの一周を持つルール: 返したカードを場ではなく捨て札に置く（4止め）。 */
  returnToDiscard?: boolean;
  /** 返しの一周を持つルール: 返しの手が無視する制限の種類。 */
  returnIgnores?: readonly ViolationKind[];
  /** 返しの一周を持つルール: その席が返せる手の候補（制限で絞る前）。 */
  returnOptions?(ctx: RuleCtx, seat: SeatId, pending: ReturnRoundPending): Play[];
  /** 返しの一周を持つルール: 誰かが返したときの効果（残りの効果を置き換える）。 */
  onReturned?(ctx: RuleCtx, seat: SeatId, play: Play, pending: ReturnRoundPending): Effect[];
  /** 返しの一周を持つルール: 全員がスキップしたときの効果（残りの効果の前に処理する）。 */
  onReturnFailed?(ctx: RuleCtx, pending: ReturnRoundPending): Effect[];
};
