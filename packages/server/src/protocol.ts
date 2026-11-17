// client と server の通信の型（design §4.5、§8.2）。
// client は `import type { ... } from '@chofugo/server/protocol'` で使う。型だけを置き、実行時の値は置かない。
//
// 接続の流れ:
//   1. POST /api/rooms → { roomId }
//   2. GET /api/rooms/:roomId/ws（WebSocket）。つながると server は席なしの `state` を1回送る（ロビーの様子を見せるため）。
//   3. client は最初に `hello` を送る。server は席を決め、以後は変化のたびに `state` を送る。
//   4. client は数秒ごとに文字列 "ping" を送る（JSON ではない）。server は "pong" を自動で返す。
//      約15秒 "ping" が届かない接続は切断として扱う。

import type { GameCount, MatchPhase, PlayerView, RuleId, SeatId, Shape, VisibleEvent, AwaitKind } from '@chofugo/engine';

// ---------- 定数（値は server の実装と一致させる。型として表す） ----------

/** 心拍の文字列。client → server。 */
export type PingText = 'ping';
/** 心拍の応答。server → client（Durable Object を起こさずに自動で返る）。 */
export type PongText = 'pong';

// ---------- client → server ----------

/**
 * どのメッセージにも任意で付けられる番号。server は `error` にそのまま付けて返す（どの送信が拒否されたかを知るため）。
 * 0 以上 2^31 未満の整数。
 */
export type ReqId = number;

export type HelloMessage = {
  type: 'hello';
  /** 本人確認の値（ブラウザに1つだけ保存する128ビット以上の乱数）。英数字と `-` `_` で 22〜64 文字。 */
  token: string;
  /** 表示名。前後の空白を除いて 1〜12 文字。制御文字は不可。復帰のときは無視される（ロビーでは名前を更新する）。 */
  name: string;
  reqId?: ReqId;
};

/**
 * ロビーのモード（design-2 §3.1）。選べるルールの範囲を決めるロビーの概念で、engine の MatchConfig にはない。
 * daifugo = 定番8種（DAIFUGO_MODE_RULE_IDS）、custom = 24種（CUSTOM_MODE_RULE_IDS、第2段階から）、
 * chofugo = 超富豪モード（その3。ルールは24種すべてで固定、特権あり。engine には abilities: true で渡す）。
 */
export type GameMode = 'daifugo' | 'custom' | 'chofugo';

/**
 * ホストだけ、ロビーの間だけ。モード・ルールの ON/OFF・ゲーム数。
 * 形（知らないモード、配列でない rules、知らないルール ID、重複、型の違う値）は確かめて拒否する（badMessage）。
 * 形が正しければ、server が中身を直してから保存する（design-2 §3.1、§6.5）：
 * モードで選べないルールを除く → 前提を満たさないルール（8切りのない4止め、J バックのない6戻し）を除く → ALL_RULE_IDS の順に並べる。
 * chofugo では、送られた rules は使わず24種すべてにする（design-3 §3.1、design-4 §3）。
 * 直した結果は次の state の room.config で届く。
 */
export type SetConfigMessage = {
  type: 'setConfig';
  mode: GameMode;
  rules: RuleId[];
  gameCount: GameCount;
  reqId?: ReqId;
};

/** ホストだけ、ロビーの間だけ。空席を CPU にして試合を始める。 */
export type StartMessage = { type: 'start'; reqId?: ReqId };

/** 自分の席の操作。席は server が決めるので含めない。 */
export type ClientAction =
  /** withSkip: 特権のスキップを付けて出す（その3）。 */
  | { type: 'play'; awaitId: number; cards: string[]; shape?: Shape; confirmFoul?: boolean; withSkip?: boolean }
  | { type: 'pass'; awaitId: number }
  | { type: 'respond'; awaitId: number; cards: string[] | null }
  | { type: 'exchangeGive'; awaitId: number; cards: string[] }
  /**
   * 手を出したあとの選択（7渡し・10捨て・銀河鉄道・闇市・Q ボンバー）。cards が空 = 渡さない・捨てない・使わない。
   * target は闇市の相手（席の番号）、ranks は Q ボンバーで宣言する数字（3〜15 か 'joker'）。第2段階、design-4 §3。
   */
  | { type: 'choose'; awaitId: number; cards: string[]; target?: number; ranks?: (number | 'joker')[] }
  /**
   * 特権の選択（その3、design-3 §3.2、§6.2）。abilities は6個以下の文字列。confirm: false は途中の保存（待ちは同じ番号のまま残り、期限も変わらない）。
   * 成功したら、内容が変わらなくても送った人に state を返す。
   */
  | { type: 'selectAbilities'; awaitId: number; abilities: string[]; confirm: boolean }
  /**
   * 特権を使う（スキップ以外、その3）。target は 0〜3、rank は 3〜15 の整数、card はカード ID の形。中身は engine が確かめる。
   * 成功すると手番の待ちは新しい番号になる（continues に元の番号）。人間の期限は元の期限を引き継ぐ（design-3 §6.1）。
   */
  | { type: 'useAbility'; awaitId: number; ability: string; target?: number; card?: string; rank?: number };

/**
 * 試合の識別子（`state.matchId`）。試合に対する操作には必ず付ける（decisions §14.15）。
 * 現在の試合と一致しなければ `staleMatch` で拒否される（rematch をまたいだ古い操作を防ぐ。待ち番号は試合ごとに1から振り直される）。
 * 英数字と `-` `_` で 1〜32 文字。
 */
export type MatchId = string;

export type ActionMessage = { type: 'action'; matchId: MatchId; action: ClientAction; reqId?: ReqId };

/** ホストだけ。ゲームの結果画面で次のゲームを配る。 */
export type NextGameMessage = { type: 'nextGame'; matchId: MatchId; reqId?: ReqId };
/** ホストだけ。無制限の試合で、ゲームの結果画面のときに試合を終える。 */
export type EndMatchMessage = { type: 'endMatch'; matchId: MatchId; reqId?: ReqId };
/** ホストだけ。試合の結果画面で、同じ席・同じ設定のまま点数と階級を戻して新しい試合を始める。matchId は終わった試合のもの。 */
export type RematchMessage = { type: 'rematch'; matchId: MatchId; reqId?: ReqId };

export type ClientMessage =
  | HelloMessage
  | SetConfigMessage
  | StartMessage
  | ActionMessage
  | NextGameMessage
  | EndMatchMessage
  | RematchMessage;

// ---------- server → client ----------

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export type SeatKind = 'empty' | 'human' | 'cpu';

export type SeatInfo = {
  seat: SeatId;
  kind: SeatKind;
  /** 表示名。空席は null。CPU は "CPU 1" など。 */
  name: string | null;
  /** 人間がいま接続しているか（CPU と空席は false）。 */
  connected: boolean;
  /** 切断から猶予がたち、CPU が代わりに操作している（人間の席だけ）。 */
  away: boolean;
};

export type RoomConfigView = {
  mode: GameMode;
  rules: RuleId[];
  gameCount: GameCount;
};

/** 外へ出すルームの情報（許可した項目だけ、design §8.2）。 */
export type RoomView = {
  roomId: string;
  phase: RoomPhase;
  seats: SeatInfo[];
  host: SeatId | null;
  /** ロビーでは設定の下書き、試合中はその試合の設定。 */
  config: RoomConfigView;
  /** 人間の接続が0で一時停止している。 */
  paused: boolean;
};

/** 待ちの期限。`at` はサーバーの時計の時刻（ミリ秒）。一時停止中は `at` が null で、`remainingMs` に残り時間が入る。 */
export type DeadlineView = {
  awaitId: number;
  seat: SeatId;
  kind: AwaitKind;
  at: number | null;
  remainingMs: number | null;
};

export type StateMessage = {
  type: 'state';
  room: RoomView;
  /** 自分の席。`hello` の前は null。 */
  seat: SeatId | null;
  /** 自分がホストか。 */
  isHost: boolean;
  /** 試合の識別子。ロビーでは null。変わったら client は出来事の記録を捨てる。 */
  matchId: string | null;
  /** 試合の段階（engine の phase）。ロビーでは null。 */
  matchPhase: MatchPhase | null;
  /** ルームの状態の版番号。変化のたびに増える。 */
  version: number;
  /** 自分から見えるゲームの状態（engine の viewFor）。ロビーと `hello` の前は null。 */
  view: PlayerView | null;
  /**
   * 出来事（engine の eventsFor）。`eventsFull` が true なら現在のゲームの最初からすべて、false なら前回の `state` 以降の新しい分。
   * client は `seq` で重複を除く。
   */
  events: VisibleEvent[];
  eventsFull: boolean;
  deadlines: DeadlineView[];
  /** 送った時点のサーバーの時刻（ミリ秒）。client は自分の時計との差を補正に使う。 */
  serverTime: number;
  /**
   * この接続が送った操作（`action`）を engine が受け付けたとき、その操作の reqId（その入力の処理で送る、本人への state だけに付く）。
   * 拒否された操作・時間切れの自動の操作・他人の操作で進んだ state には付かない。client は「自分の操作が受理された」をこれで見分ける
   * （7渡しで受け取ったカードの強調を消す時点、design-2 §6.3）。reqId を付けずに送った操作には付かない。
   */
  acceptedReqId?: ReqId;
};

export type ErrorCode =
  | 'tooLarge' // 大きすぎるメッセージ
  | 'badMessage' // JSON でない、形・長さ・値の範囲が違う
  | 'notJoined' // hello の前に操作した
  | 'alreadyJoined' // 2回目の hello
  | 'roomFull' // 入れる席がない
  | 'cannotJoin' // いまは途中参加できない
  | 'notHost' // ホスト以外のホスト操作
  | 'wrongPhase' // その段階ではできない（試合がないときの試合への操作を含む）
  | 'staleMatch' // matchId が現在の試合と違う
  | 'invalidConfig' // ルール設定の誤り
  | 'actionRejected'; // engine が操作を拒否した（engineError に理由）

export type ErrorMessage = {
  type: 'error';
  code: ErrorCode;
  message: string;
  /** 拒否したメッセージに付いていた reqId。 */
  reqId: ReqId | null;
  /** actionRejected のときの engine のエラーの種類（ActionErrorCode）。 */
  engineError?: string;
};

export type ServerMessage = StateMessage | ErrorMessage;

/** WebSocket を server が閉じるときのコード。 */
export type CloseCode =
  | 4000 // 応答がない
  | 4001 // 同じ席に新しい接続が来た
  | 4002 // 入れる席がない・途中参加できない
  | 4003 // ルームが閉じられた
  | 4004; // 接続が多すぎる
// 保存の形式が古いルーム（サーバーの更新をまたいだルーム）は、失効と同じく 4003 で閉じる（design-2 §3.3）。

/** POST /api/rooms の応答。 */
export type CreateRoomResponse = { roomId: string };
