// ルームの状態（design §4.3、§8.2）。ストレージの "room" に1つの値として保存する。
// ここに置く関数は時計・ストレージ・接続に触れない（呼び出し側が now を渡す）。

import {
  DAIFUGO_MODE_DEFAULT_RULES,
  DAIFUGO_MODE_RULE_IDS,
  SEATS,
  awaiting,
  type AwaitKind,
  type AwaitTimer,
  type GameCount,
  type GameEvent,
  type MatchConfig,
  type MatchState,
  type RuleId,
  type SeatId,
} from '@chofugo/engine';
import { humanTimerMs, type Timing } from './timing.ts';

export type SeatRec = {
  kind: 'empty' | 'human' | 'cpu';
  name: string | null;
  /** 本人確認の値のハッシュ（SHA-256 の16進）。人間の席だけ。外へは出さない。 */
  tokenHash: string | null;
  /** 現在の接続の番号（design §8.2「接続の世代」）。接続の添付データにも同じ番号を入れる。 */
  gen: number;
  connected: boolean;
  /** 切断を検出した時刻。接続中は null。 */
  disconnectedAt: number | null;
  /** 切断から猶予がたち、代役（CPU）が操作している。 */
  away: boolean;
};

export type Deadline = {
  awaitId: number;
  seat: SeatId;
  kind: AwaitKind;
  timer: AwaitTimer;
  /** 期限の時刻。一時停止中は null。 */
  at: number | null;
  /** 一時停止中の残り時間。動いている間は null。 */
  remaining: number | null;
};

export type MatchInit = { matchId: string; config: MatchConfig; seed: [number, number, number, number] };

export type RoomState = {
  v: 1;
  roomId: string;
  createdAt: number;
  /** 状態の版番号。保存するたびに増える。 */
  version: number;
  timing: Timing;
  seats: SeatRec[];
  host: SeatId | null;
  /** ロビーで変更中の設定。 */
  draft: { rules: RuleId[]; gameCount: GameCount };
  match: MatchState | null;
  /** 試合の作成に使った設定と種（操作の記録と合わせて試合を再現できる）。 */
  matchInit: MatchInit | null;
  /** 現在のゲームの出来事（復帰した人に最初から送る）。 */
  eventLog: GameEvent[];
  deadlines: Deadline[];
  /** 人間の接続が0になった時刻。動いている間は null。 */
  pausedAt: number | null;
  /** 次に応答を確かめる時刻。 */
  hbCheckAt: number | null;
  /** 設定済みのアラームの時刻（ストレージのアラームと一致させる）。 */
  alarmAt: number | null;
};

export function emptySeat(): SeatRec {
  return { kind: 'empty', name: null, tokenHash: null, gen: 0, connected: false, disconnectedAt: null, away: false };
}

export function initialRoom(roomId: string, now: number, timing: Timing): RoomState {
  return {
    v: 1,
    roomId,
    createdAt: now,
    version: 1,
    timing,
    seats: SEATS.map(() => emptySeat()),
    host: null,
    draft: { rules: DAIFUGO_MODE_DEFAULT_RULES.slice(), gameCount: 5 },
    match: null,
    matchInit: null,
    eventLog: [],
    deadlines: [],
    // 作っただけで誰も来ないルームも 30 分で消すため、最初は一時停止の扱いにする
    pausedAt: now,
    hbCheckAt: null,
    alarmAt: null,
  };
}

/** ルール ID を大富豪モードの一覧の順に並べる。 */
export function orderRules(rules: readonly RuleId[]): RuleId[] {
  return DAIFUGO_MODE_RULE_IDS.filter((r) => rules.includes(r));
}

export function seatRec(s: RoomState, seat: SeatId): SeatRec {
  const r = s.seats[seat];
  if (r === undefined) throw new Error(`bad seat ${seat}`);
  return r;
}

/** CPU が操作する席（はじめから CPU の席と、代役中の人間の席）。 */
export function isBotSeat(s: RoomState, seat: SeatId): boolean {
  const r = seatRec(s, seat);
  return r.kind === 'cpu' || (r.kind === 'human' && r.away);
}

/** ホストになれる人（人間で、代役に切り替わっていない人。切断の猶予の間は含む）。 */
function canHost(r: SeatRec): boolean {
  return r.kind === 'human' && !r.away;
}

/** 接続中の人間の数。 */
export function connectedHumans(s: RoomState): number {
  return s.seats.filter((r) => r.kind === 'human' && r.connected).length;
}

/** ホストの確認（design §4.6）。いまのホストがなれない人なら、接続中の人間のうち席順で次の人に移す。 */
export function ensureHost(s: RoomState): void {
  if (s.host !== null && canHost(seatRec(s, s.host))) return;
  const start = s.host ?? 3;
  for (let i = 1; i <= 4; i++) {
    const seat = ((start + i) % 4) as SeatId;
    const r = seatRec(s, seat);
    if (canHost(r) && r.connected) {
      s.host = seat;
      return;
    }
  }
}

/** 期限の長さを付け直す（一時停止中なら残り時間として持つ）。 */
export function setDeadlineIn(s: RoomState, d: Deadline, ms: number, now: number): void {
  if (s.pausedAt !== null) {
    d.at = null;
    d.remaining = ms;
  } else {
    d.at = now + ms;
    d.remaining = null;
  }
}

function durationFor(s: RoomState, seat: SeatId, timer: AwaitTimer): number {
  return isBotSeat(s, seat) ? s.timing.cpuDelayMs : humanTimerMs(s.timing, timer);
}

/** engine の待ちと期限の一覧を合わせる。なくなった待ちの期限を消し、新しい待ちに期限を付ける。 */
export function syncDeadlines(s: RoomState, now: number): void {
  const list = s.match === null ? [] : awaiting(s.match);
  const ids = new Set(list.map((a) => a.id));
  s.deadlines = s.deadlines.filter((d) => ids.has(d.awaitId));
  for (const a of list) {
    if (s.deadlines.some((d) => d.awaitId === a.id)) continue;
    const d: Deadline = { awaitId: a.id, seat: a.seat, kind: a.kind, timer: a.timer, at: null, remaining: null };
    setDeadlineIn(s, d, durationFor(s, a.seat, a.timer), now);
    s.deadlines.push(d);
  }
  s.deadlines.sort((x, y) => x.awaitId - y.awaitId);
}

/** 席の待ちの期限を付け直す（代役への切り替え・復帰のとき）。 */
export function resetSeatDeadlines(s: RoomState, seat: SeatId, now: number): void {
  for (const d of s.deadlines) {
    if (d.seat === seat) setDeadlineIn(s, d, durationFor(s, seat, d.timer), now);
  }
}

export function pause(s: RoomState, now: number): void {
  if (s.pausedAt !== null) return;
  for (const d of s.deadlines) {
    d.remaining = Math.max(0, (d.at ?? now) - now);
    d.at = null;
  }
  s.pausedAt = now;
  s.hbCheckAt = null;
}

export function resume(s: RoomState, now: number): void {
  if (s.pausedAt === null) return;
  s.pausedAt = null;
  for (const d of s.deadlines) {
    d.at = now + (d.remaining ?? 0);
    d.remaining = null;
  }
}

/**
 * 応答の確認が必要な間か（decisions §14.15、design §8.2）。
 * 席のない接続（hello 前）がある間、ロビーで接続中の人間がいる間、人間の操作を待っている間、結果画面でホストを待っている間。
 */
export function needsHeartbeat(s: RoomState, hasUnseatedSocket: boolean): boolean {
  if (hasUnseatedSocket) return true;
  if (s.pausedAt !== null) return false;
  if (s.match === null) return connectedHumans(s) > 0;
  if (s.match.phase === 'gameResult' || s.match.phase === 'matchResult') return true;
  return s.deadlines.some((d) => {
    const r = seatRec(s, d.seat);
    return r.kind === 'human' && r.connected && !r.away;
  });
}

/** 次にアラームを鳴らす時刻。 */
export function nextAlarm(s: RoomState): number | null {
  if (s.pausedAt !== null) {
    const close = s.pausedAt + s.timing.pausedCloseMs;
    return s.hbCheckAt !== null && s.hbCheckAt < close ? s.hbCheckAt : close;
  }
  let t: number | null = null;
  const take = (x: number): void => {
    if (t === null || x < t) t = x;
  };
  for (const d of s.deadlines) if (d.at !== null) take(d.at);
  for (const r of s.seats) {
    if (r.kind === 'human' && !r.connected && !r.away && r.disconnectedAt !== null) take(r.disconnectedAt + s.timing.disconnectGraceMs);
  }
  if (s.hbCheckAt !== null) take(s.hbCheckAt);
  return t;
}

/** 一時停止の30分を過ぎて失効しているか（decisions §14.15）。 */
export function isExpired(s: RoomState, now: number): boolean {
  return s.pausedAt !== null && now >= s.pausedAt + s.timing.pausedCloseMs;
}

/** 全員に見える段階。 */
export function roomPhase(s: RoomState): 'lobby' | 'playing' | 'finished' {
  if (s.match === null) return 'lobby';
  return s.match.phase === 'matchResult' ? 'finished' : 'playing';
}
