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

/** ホストだけ、ロビーの間だけ。大富豪モードの8種の ON/OFF とゲーム数。 */
export type SetConfigMessage = {
  type: 'setConfig';
  rules: RuleId[];
  gameCount: GameCount;
  reqId?: ReqId;
};

/** ホストだけ、ロビーの間だけ。空席を CPU にして試合を始める。 */
export type StartMessage = { type: 'start'; reqId?: ReqId };

/** 自分の席の操作。席は server が決めるので含めない。 */
export type ClientAction =
  | { type: 'play'; awaitId: number; cards: string[]; shape?: Shape; confirmFoul?: boolean }
  | { type: 'pass'; awaitId: number }
  | { type: 'respond'; awaitId: number; cards: string[] | null }
  | { type: 'exchangeGive'; awaitId: number; cards: string[] };

export type ActionMessage = { type: 'action'; action: ClientAction; reqId?: ReqId };

/** ホストだけ。ゲームの結果画面で次のゲームを配る。 */
export type NextGameMessage = { type: 'nextGame'; reqId?: ReqId };
/** ホストだけ。無制限の試合で、ゲームの結果画面のときに試合を終える。 */
export type EndMatchMessage = { type: 'endMatch'; reqId?: ReqId };
/** ホストだけ。試合の結果画面で、同じ席・同じ設定のまま点数と階級を戻して新しい試合を始める。 */
export type RematchMessage = { type: 'rematch'; reqId?: ReqId };

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
};

export type ErrorCode =
  | 'tooLarge' // 大きすぎるメッセージ
  | 'badMessage' // JSON でない、形・長さ・値の範囲が違う
  | 'notJoined' // hello の前に操作した
  | 'alreadyJoined' // 2回目の hello
  | 'roomFull' // 入れる席がない
  | 'cannotJoin' // いまは途中参加できない
  | 'notHost' // ホスト以外のホスト操作
  | 'wrongPhase' // その段階ではできない
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

/** POST /api/rooms の応答。 */
export type CreateRoomResponse = { roomId: string };
