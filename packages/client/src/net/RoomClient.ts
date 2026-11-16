// ルームとの通信（design-client §5.1〜§5.3、§7.1〜§7.3、§7.9、§7.10）。
// React の外に置き、useSyncExternalStore で画面に渡す。画面はここが持つ最新の state から描く。

import type { ClientAction, ClientMessage, ErrorMessage, ServerMessage, StateMessage } from '@chofugo/server/protocol';
import type { SeatId } from '@chofugo/engine';
import { animsFor, emptyFeed, enqueueAnims, eventMessage, ingest, type Anim, type Feed } from '../lib/events.ts';
import { nextReqId, pendingAfter, PENDING_TIMEOUT_MS, type Pending } from '../lib/pending.ts';
import { backoffMs, closeOutcome, PING_MS, shouldGiveUp, SILENCE_MS } from '../lib/reconnect.ts';
import { ClockSkew } from '../lib/timer.ts';
import { getSavedName, getToken, isKnownRoom, rememberRoom, saveName } from '../lib/storage.ts';
import { errorText } from '../lib/errors.ts';
import { seatName } from '../lib/seats.ts';

export type ConnStatus =
  | 'connecting' // 初回の接続中
  | 'open' // つながっている
  | 'reconnecting' // 切れて、つなぎ直している
  | 'gaveUp' // 一度もつながらないまま3回失敗した
  | 'replaced' // 同じ席が別の画面で開かれた
  | 'closed' // ルームが閉じられた
  | 'cannotJoin'; // 入れる席がない・途中参加できない

export type JoinStage = 'needName' | 'joining' | 'joined';

export type Snapshot = {
  status: ConnStatus;
  joinStage: JoinStage;
  /** hello のあとに自分の席が入った state を受け取った（操作できる）。 */
  ready: boolean;
  state: StateMessage | null;
  feed: Feed;
  /** メッセージの欄の1行。 */
  line: string | null;
  /** いま再生中の演出。 */
  anim: Anim | null;
  pending: Pending;
  /** サーバーの時刻 − 端末の時刻。 */
  offset: number;
  /** 最後の試合の結果を「ゲームの結果 → 試合の結果」の順に見せる試合（§7.3）。 */
  gameResultFirst: ReadonlySet<string>;
  /** 入れなかった理由（席がない・途中参加できない）。 */
  joinError: 'roomFull' | 'cannotJoin' | null;
  /**
   * 一時的な知らせ（拒否の理由・ホストの交代）。どの画面でも1行で出し、交換や返しの一周の案内より優先する（§7.13）。
   * NOTICE_MS たつと消える。
   */
  notice: string | null;
};

const MESSAGE_STEP_MS = 600;
export const NOTICE_MS = 4000;
const OPEN = 1;

/** テストで差し替える WebSocket の形。 */
export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};
export type SocketFactory = (url: string) => SocketLike;

const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;
const ANIM_MS: Record<Anim['kind'], number> = { play: 360, sweep: 360, revolution: 480, placed: 600 };

function reducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * 「ゲームの結果を先に見せる」試合の印（§7.3、§7.13）。
 * - 同じ state に gameEnd と matchEnd が入っていたら（最後のゲームが終わった瞬間）印を付ける。
 * - eventsFull で matchResult を受けたら（切れて戻ったなど）、その試合の印を消して試合の結果を直接見せる。
 * - 試合の識別子が変わったら、ほかの試合の印を片付ける。
 */
export function nextGameResultFirst(
  prev: ReadonlySet<string>,
  msg: Pick<StateMessage, 'matchId' | 'matchPhase' | 'eventsFull'>,
  fresh: readonly { type: string }[],
): ReadonlySet<string> {
  const s = new Set([...prev].filter((id) => id === msg.matchId));
  if (msg.matchId === null) return s;
  if (msg.eventsFull && msg.matchPhase === 'matchResult') s.delete(msg.matchId);
  else if (fresh.some((e) => e.type === 'matchEnd') && fresh.some((e) => e.type === 'gameEnd')) s.add(msg.matchId);
  return s;
}

export class RoomClient {
  private ws: SocketLike | null = null;
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private everConnected = false;
  private failures = 0;
  private attempt = 0;
  private openedThisSocket = false;
  private helloSentThisSocket = false;
  private reqId = 0;
  private skew = new ClockSkew();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private msgTimer: ReturnType<typeof setTimeout> | null = null;
  private animTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private msgQueue: string[] = [];
  private animQueue: Anim[] = [];
  private running = false;
  private readonly token: string;

  constructor(
    readonly roomId: string,
    private readonly wsUrl: string,
    private readonly factory: SocketFactory = defaultFactory,
  ) {
    this.token = getToken();
    this.snap = {
      status: 'connecting',
      joinStage: isKnownRoom(roomId) ? 'joining' : 'needName',
      ready: false,
      state: null,
      feed: emptyFeed(),
      line: null,
      anim: null,
      pending: null,
      offset: 0,
      gameResultFirst: new Set(),
      joinError: null,
      notice: null,
    };
  }

  // ---------- React との接続 ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  // ---------- 接続 ----------

  /**
   * 接続を始める。dispose のあとにもう一度呼んでよい（React の StrictMode の「開始 → 後始末 → 開始」）。
   * 再開始では、新しい接続を作り直す（前の接続は dispose で閉じている）。
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.failures = 0;
    this.attempt = 0;
    this.connect();
  }

  /** 接続とタイマーを片付ける。購読（useSyncExternalStore）は React が外すので、ここでは触らない。 */
  dispose(): void {
    this.running = false;
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearMessages();
    if (this.animTimer) clearTimeout(this.animTimer);
    this.animTimer = null;
    this.animQueue = [];
    this.dropSocket();
  }

  private dropSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws === null) return;
    ws.onopen = ws.onclose = ws.onmessage = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // すでに閉じている
    }
  }

  /** 「もう一度」（諦めたあと）。 */
  retry(): void {
    this.failures = 0;
    this.attempt = 0;
    this.set({ status: 'connecting' });
    this.connect();
  }

  private connect(): void {
    if (!this.running) return;
    this.openedThisSocket = false;
    this.helloSentThisSocket = false;
    let ws: SocketLike;
    try {
      ws = this.factory(this.wsUrl);
    } catch {
      this.onClosed(1006);
      return;
    }
    this.ws = ws;
    // つながる前から無応答の期限を数える（つながらないまま固まった接続も、失敗として数えてつなぎ直す）
    this.touch();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.openedThisSocket = true;
      this.everConnected = true;
      this.failures = 0;
      // 1回も送信していない接続はサーバーから閉じきれないので、すぐ ping を送る（server-assumptions C4）
      ws.send('ping');
      this.pingTimer = setInterval(() => {
        if (ws.readyState === OPEN) ws.send('ping');
      }, PING_MS);
      this.touch();
      this.set({ status: 'open' });
      if (this.snap.joinStage !== 'needName') this.sendHello(getSavedName());
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.touch();
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'state') this.onState(msg);
      else if (msg.type === 'error') this.onError(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.onClosed(e.code);
    };
    ws.onerror = () => {
      // close が続けて届く
    };
  }

  private touch(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      // 15秒間何も届かない（つながる前を含む）：接続を捨ててつなぎ直す
      if (this.ws === null) return;
      this.dropSocket();
      this.onClosed(4000);
    }, SILENCE_MS);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pingTimer = this.silenceTimer = this.pendingTimer = null;
  }

  private onClosed(code: number): void {
    this.clearTimers();
    this.ws = null;
    const pending = pendingAfter(this.snap.pending, { type: 'disconnected' });
    const out = closeOutcome(code);
    if (out.kind !== 'retry') {
      this.set({ status: out.kind, ready: false, pending });
      return;
    }
    if (!this.openedThisSocket) this.failures += 1;
    if (shouldGiveUp(this.everConnected, this.failures)) {
      this.set({ status: 'gaveUp', ready: false, pending });
      return;
    }
    const delay = backoffMs(this.attempt);
    this.attempt += 1;
    this.set({ status: this.everConnected ? 'reconnecting' : 'connecting', ready: false, pending });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  // ---------- 受信 ----------

  private onState(msg: StateMessage): void {
    this.skew.add(msg.serverTime, Date.now());
    const prev = this.snap.state;
    const patch: Partial<Snapshot> = {
      state: msg,
      offset: this.skew.offset,
      pending: pendingAfter(this.snap.pending, { type: 'state' }),
    };
    if (msg.seat !== null) {
      // 操作できる状態に戻すのは、hello のあとに自分の席が入った state を受け取った時点（§7.9）
      if (this.helloSentThisSocket) {
        patch.ready = true;
        patch.joinStage = 'joined';
        this.attempt = 0;
        rememberRoom(this.roomId);
      }
    }
    // 出来事
    const before = this.snap.feed.matchId === msg.matchId ? this.snap.feed.top : null;
    const { feed, fresh } = ingest(this.snap.feed, msg);
    patch.feed = feed;
    patch.gameResultFirst = nextGameResultFirst(this.snap.gameResultFirst, msg, fresh);
    const names = (seat: SeatId) => seatName(msg.room.seats, seat, msg.seat);
    const lines: string[] = [];
    for (const e of fresh) {
      const t = eventMessage(e, names);
      if (t !== null) lines.push(t);
    }
    const reset = msg.eventsFull || (prev !== null && prev.matchId !== msg.matchId);
    if (reset) {
      // 接続・復帰の直後・新しい試合：前のメッセージ・演出は捨て、最新の状態だけを描く
      this.clearMessages();
      patch.line = null;
      patch.notice = null;
      this.animQueue = [];
      patch.anim = null;
      if (this.animTimer) clearTimeout(this.animTimer);
      this.animTimer = null;
    } else if (!reducedMotion()) {
      const anims = animsFor(before, fresh);
      if (anims.length > 0) {
        const playing = this.snap.anim;
        const all = enqueueAnims(playing === null ? this.animQueue : [playing, ...this.animQueue], anims);
        if (all.length === 0) {
          // たまった（3つ以上）：残りを省いて最新の状態に合わせる
          this.animQueue = [];
          if (this.animTimer) clearTimeout(this.animTimer);
          this.animTimer = null;
          patch.anim = null;
        } else {
          this.animQueue = playing === null ? all : all.slice(1);
        }
      }
    }
    this.set(patch);
    // ホストが替わったら1行出す（§7.10、§7.13。どの画面でも出す）
    if (prev !== null && prev.room.host !== null && msg.room.host !== null && prev.room.host !== msg.room.host && msg.seat !== null) {
      this.showNotice(msg.room.host === msg.seat ? 'あなたが ホストになった' : `${names(msg.room.host)} が ホストになった`);
    }
    if (lines.length > 0) this.pushLines(lines);
    if (this.snap.anim === null) this.nextAnim();
  }

  private onError(msg: ErrorMessage): void {
    const pending = pendingAfter(this.snap.pending, { type: 'error', reqId: msg.reqId });
    if (msg.code === 'roomFull' || msg.code === 'cannotJoin') {
      this.set({ pending, joinError: msg.code });
      return;
    }
    this.set({ pending });
    this.showNotice(errorText(msg));
  }

  // ---------- 一時的な知らせ ----------

  private showNotice(text: string): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.set({ notice: text });
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.set({ notice: null });
    }, NOTICE_MS);
  }

  // ---------- メッセージの欄 ----------

  /** メッセージの行の待ち行列とタイマーを捨てる。 */
  private clearMessages(): void {
    this.msgQueue = [];
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = null;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }

  /** 画面の側の1行（出せない理由など）。待っているメッセージは捨てて、すぐ出す。 */
  showLine(text: string): void {
    this.msgQueue = [];
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = null;
    this.set({ line: text });
  }

  private pushLines(lines: string[]): void {
    if (this.msgTimer === null) {
      const [first, ...rest] = lines;
      this.msgQueue.push(...rest);
      this.set({ line: first ?? null });
      if (this.msgQueue.length > 0) this.msgTimer = setTimeout(() => this.stepLine(), MESSAGE_STEP_MS);
    } else {
      this.msgQueue.push(...lines);
    }
  }

  private stepLine(): void {
    this.msgTimer = null;
    // たまりすぎたら最後の2つだけにする
    if (this.msgQueue.length > 2) this.msgQueue = this.msgQueue.slice(-2);
    const next = this.msgQueue.shift();
    if (next === undefined) return;
    this.set({ line: next });
    if (this.msgQueue.length > 0) this.msgTimer = setTimeout(() => this.stepLine(), MESSAGE_STEP_MS);
  }

  // ---------- 演出 ----------

  private nextAnim(): void {
    const a = this.animQueue.shift();
    if (a === undefined) {
      if (this.snap.anim !== null) this.set({ anim: null });
      return;
    }
    this.set({ anim: a });
    this.animTimer = setTimeout(() => {
      this.animTimer = null;
      this.set({ anim: null });
      this.nextAnim();
    }, ANIM_MS[a.kind]);
  }

  // ---------- 送信 ----------

  /** 名前を入れて参加する（初めてのルーム。1回だけ hello を送る）。 */
  join(name: string): void {
    saveName(name);
    this.set({ joinStage: 'joining', joinError: null });
    this.sendHello(name);
  }

  private sendHello(name: string): void {
    const ws = this.ws;
    if (ws === null || ws.readyState !== OPEN || this.helloSentThisSocket) return;
    this.helloSentThisSocket = true;
    this.reqId = nextReqId(this.reqId);
    ws.send(JSON.stringify({ type: 'hello', token: this.token, name: name.trim() === '' ? 'プレイヤー' : name, reqId: this.reqId }));
  }

  /** 操作を送る。送れなければ false。what はどのボタンの送信かの印（押せなくするボタンを決める）。 */
  send(msg: ClientMessage, what: string): boolean {
    const ws = this.ws;
    if (ws === null || ws.readyState !== OPEN || !this.snap.ready) return false;
    if (this.snap.pending !== null) return false;
    this.reqId = nextReqId(this.reqId);
    const withId = { ...msg, reqId: this.reqId };
    ws.send(JSON.stringify(withId));
    const pending: Pending = { reqId: this.reqId, what, sentAt: Date.now() };
    this.set({ pending });
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.set({ pending: pendingAfter(this.snap.pending, { type: 'tick', now: Date.now() }) });
    }, PENDING_TIMEOUT_MS);
    return true;
  }

  sendAction(action: ClientAction, what: string): boolean {
    const matchId = this.snap.state?.matchId;
    if (matchId === null || matchId === undefined) return false;
    return this.send({ type: 'action', matchId, action }, what);
  }

  /** 最後のゲームの結果から試合の結果へ（自分の画面だけ。サーバーには送らない）。 */
  showMatchResult(matchId: string): void {
    const s = new Set(this.snap.gameResultFirst);
    s.delete(matchId);
    this.set({ gameResultFirst: s });
  }
}
