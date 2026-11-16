// ルールモジュールの形（design §3.7）。中心の処理は、登録されたモジュールに問い合わせるだけにする。

import type { CardId } from '../cards.ts';
import type {
  Effect,
  FieldPlay,
  GameState,
  MatchState,
  Pending,
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

export type RuleModule = {
  id: RuleId;
  /** 前提のルール。 */
  requires?: readonly RuleId[];
  /** 有効にする手の形（階段）。 */
  shapes?: readonly Shape[];
  /** 出せる手を絞る（マーク縛り）。 */
  restrictPlay?(ctx: RuleCtx, play: Play, seat: SeatId): Violation | null;
  /** 解釈を補う（縛り中に、ジョーカーが代わりにするマークを決める）。 */
  refinePlay?(ctx: RuleCtx, play: Play): Play;
  /** 出したあとの効果（8切り、革命、J バック、縛りの成立、返しの一周の開始）。 */
  afterPlay?(ctx: RuleCtx, played: FieldPlay, prev: FieldPlay | null): Effect[];
  /** 反則上がりの判定。判定に使う向きは、出す直前のもの（decisions §14.4）。 */
  isFoulFinish?(ctx: RuleCtx, play: Play): boolean;
  /** 1位が確定したとき（都落ち）。 */
  onFirstPlace?(ctx: RuleCtx, seat: SeatId): Effect[];
  /** 場が流れたとき（縛り・J バックの解除）。 */
  onFieldCleared?(ctx: RuleCtx): Effect[];
  /** 返しの一周を持つルール: 返しの手が無視する制限の種類。 */
  returnIgnores?: readonly ViolationKind[];
  /** 返しの一周を持つルール: その席が返せる手の候補（制限で絞る前）。 */
  returnOptions?(ctx: RuleCtx, seat: SeatId, pending: Pending): Play[];
  /** 返しの一周を持つルール: 誰かが返したときの効果（残りの効果を置き換える）。 */
  onReturned?(ctx: RuleCtx, seat: SeatId, play: Play, pending: Pending): Effect[];
  /** 返しの一周を持つルール: 全員がスキップしたときの効果（残りの効果の前に処理する）。 */
  onReturnFailed?(ctx: RuleCtx, pending: Pending): Effect[];
};
