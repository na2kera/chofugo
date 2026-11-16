// ルームの Durable Object（design §4、§8.2）。
//
// 決まり:
// - 状態はすべてストレージ（同期 KV の "room"）に置き、入力（メッセージ・接続・切断・アラーム）のたびに読み直す。メモリには持たない。
// - 1つの入力の処理では、計算をすべて終えてから、保存とアラームの設定を await を挟まずに続けて行う。
//   書き込みはまとめて反映され、送信はその書き込みが終わるまで保留される（output gate）。
// - ゲームのルールと結果は engine の関数だけで決める。外へ送るのは viewFor / eventsFor と、許可した項目だけのルーム情報。
// - setTimeout / setInterval は使わない。期限はアラームで扱う。

import { DurableObject } from 'cloudflare:workers';
import {
  SEATS,
  applyAction,
  createMatch,
  eventsFor,
  validateConfig,
  viewFor,
  type Action,
  type GameEvent,
  type MatchConfig,
  type SeatId,
} from '@chofugo/engine';
import type { ClientMessage, CloseCode, ErrorCode, ReqId, RoomView, ServerMessage, StateMessage } from './protocol.ts';
import {
  connectedHumans,
  emptySeat,
  ensureHost,
  initialRoom,
  isExpired,
  isBotSeat,
  needsHeartbeat,
  nextAlarm,
  orderRules,
  pause,
  resetSeatDeadlines,
  resume,
  roomPhase,
  seatRec,
  syncDeadlines,
  type MatchInit,
  type RoomState,
} from './state.ts';
import { parseClientMessage } from './validate.ts';
import type { Timing } from './timing.ts';

const ROOM_KEY = 'room';
const ACTIONS_PREFIX = 'actions:';
/** 1つのルームに同時に開ける接続の数（hello 前の接続を含む）。 */
const MAX_SOCKETS = 12;

/** 接続の添付データ。 */
type Attachment = {
  /** hello で決まった席。hello の前は null。 */
  seat: SeatId | null;
  /** 席の接続の番号（hello の前は 0）。 */
  gen: number;
  /** 最後にメッセージを受け取った時刻（接続した時刻を含む）。 */
  lastSeen: number;
};

type LoggedAction = { at: number; action: Action };

/** 外へ見える内容（席・ホスト・設定・試合・期限・一時停止）。これが変わったときだけ版番号を上げて全員に送る。 */
function publicSignature(s: RoomState): string {
  return JSON.stringify([
    s.seats.map((r) => [r.kind, r.name, r.connected, r.away]),
    s.host,
    s.draft,
    s.match,
    s.deadlines,
    s.pausedAt !== null,
  ]);
}

/** 1つの入力の処理の作業領域。 */
class Tx {
  readonly before: string;
  readonly beforePublic: string;
  readonly newEvents: GameEvent[] = [];
  /** 現在のゲームの出来事を最初から送る接続。 */
  readonly fullFor = new Set<WebSocket>();
  readonly direct: { ws: WebSocket; msg: ServerMessage }[] = [];
  readonly closes: { ws: WebSocket; code: CloseCode; reason: string }[] = [];
  /** 期限を秒数いっぱいに付け直す席（復帰した本人）。 */
  readonly resetSeats = new Set<SeatId>();
  /** 追記する操作の記録（ゲームの番号ごと）。 */
  readonly logs = new Map<number, LoggedAction[]>();
  clearLogs = false;
  /** アラームが鳴った（ストレージのアラームは消えているので、同じ時刻でも設定し直す）。 */
  alarmFired = false;

  constructor(
    readonly s: RoomState,
    readonly now: number,
  ) {
    this.before = JSON.stringify(s);
    this.beforePublic = publicSignature(s);
  }

  error(ws: WebSocket, code: ErrorCode, message: string, reqId: ReqId | null, engineError?: string): void {
    const msg: ServerMessage = { type: 'error', code, message, reqId };
    if (engineError !== undefined) msg.engineError = engineError;
    this.direct.push({ ws, msg });
  }
}

function randomId(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomSeed(): [number, number, number, number] {
  for (;;) {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    const seed: [number, number, number, number] = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0];
    if (seed.some((x) => x !== 0)) return seed;
  }
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(`chofugo-token:${token}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function isAttachment(v: unknown): v is Attachment {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (a['seat'] === null || SEATS.includes(a['seat'] as SeatId)) && typeof a['gen'] === 'number' && typeof a['lastSeen'] === 'number';
}

export class Room extends DurableObject<Env> {
  /** このインスタンス（メモリ上の Durable Object）の識別子。作り直されると変わる。テスト用の経路でだけ外へ出す。 */
  private readonly instanceId = randomId(6);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 心拍の "ping" には Durable Object を起こさずに "pong" を返す
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // 起動時の点検（design §8.2）：保存された期限から次のアラームを計算し直す
    void this.ctx.blockConcurrencyWhile(async () => {
      try {
        const s = this.load();
        if (s === null) return;
        const want = nextAlarm(s);
        const target = want === null ? null : want + s.timing.testAlarmLagMs;
        const cur = await this.ctx.storage.getAlarm();
        if (cur !== target) {
          if (target === null) await this.ctx.storage.deleteAlarm();
          else await this.ctx.storage.setAlarm(target);
        }
        if (s.alarmAt !== want) {
          s.alarmAt = want;
          this.ctx.storage.kv.put(ROOM_KEY, s);
        }
      } catch (e) {
        console.error('startup check failed', e);
      }
    });
  }

  // ---------- 読み書き ----------

  private load(): RoomState | null {
    const s = this.ctx.storage.kv.get<RoomState>(ROOM_KEY);
    return s === undefined ? null : s;
  }

  private attachment(ws: WebSocket): Attachment | null {
    try {
      const a: unknown = ws.deserializeAttachment();
      return isAttachment(a) ? a : null;
    } catch {
      return null;
    }
  }

  private openSockets(): { ws: WebSocket; att: Attachment }[] {
    const out: { ws: WebSocket; att: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const att = this.attachment(ws);
      if (att !== null) out.push({ ws, att });
    }
    return out;
  }

  /** その席の現在の接続か。 */
  private isCurrent(s: RoomState, att: Attachment): att is Attachment & { seat: SeatId } {
    return att.seat !== null && seatRec(s, att.seat).gen === att.gen;
  }

  // ---------- RPC（Worker から） ----------

  /** ルームを作る。すでにあれば false。 */
  async create(roomId: string, timing: Timing): Promise<boolean> {
    if (this.load() !== null) return false;
    const now = Date.now();
    const s = initialRoom(roomId, now, timing);
    const want = nextAlarm(s);
    s.alarmAt = want;
    this.ctx.storage.kv.put(ROOM_KEY, s);
    if (want !== null) void this.ctx.storage.setAlarm(want + s.timing.testAlarmLagMs);
    return true;
  }

  /** テスト用：このインスタンスの識別子（休止から作り直されたかを確かめる）。 */
  async instance(): Promise<string> {
    return this.instanceId;
  }

  /** テスト用：アラームの処理をいま実行する（2回鳴った場合の確認）。Worker がテストのときだけ呼ぶ。 */
  async runAlarmNow(): Promise<number | null> {
    await this.alarm();
    return this.load()?.version ?? null;
  }

  /**
   * テスト用：保存した設定・種・操作の記録から試合を作り直し、保存されている試合の状態と一致するかを返す（design §8.2「操作の記録」）。
   */
  async replayCheck(): Promise<{ ok: boolean; actions: number; reason?: string }> {
    const s = this.load();
    if (s === null || s.match === null || s.matchInit === null) return { ok: false, actions: 0, reason: 'no match' };
    const created = createMatch(s.matchInit.config, s.matchInit.seed);
    if (!created.ok) return { ok: false, actions: 0, reason: 'createMatch failed' };
    let state = created.state;
    let count = 0;
    for (let gameNo = 1; gameNo <= s.match.gameNo; gameNo++) {
      for (const entry of this.ctx.storage.kv.get<LoggedAction[]>(`${ACTIONS_PREFIX}${gameNo}`) ?? []) {
        const r = applyAction(state, entry.action);
        if (!r.ok) return { ok: false, actions: count, reason: `action ${count} rejected: ${r.error.code}` };
        state = r.state;
        count++;
      }
    }
    const same = JSON.stringify(state) === JSON.stringify(s.match);
    return same ? { ok: true, actions: count } : { ok: false, actions: count, reason: 'state differs' };
  }

  // ---------- 接続 ----------

  override async fetch(request: Request): Promise<Response> {
    try {
      const s = this.load();
      if (s === null) return new Response('room not found', { status: 404 });
      // 一時停止の30分を過ぎたルームは、削除の処理がまだでも失効している（decisions §14.15）
      if (isExpired(s, Date.now())) {
        await this.closeRoom();
        return new Response('room not found', { status: 404 });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('too many connections', { status: 503 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      const now = Date.now();
      const att: Attachment = { seat: null, gen: 0, lastSeen: now };
      server.serializeAttachment(att);
      const tx = new Tx(s, now);
      // 席が決まる前の様子（ロビーの名前など）を1回送る
      tx.fullFor.add(server);
      this.settle(tx);
      this.commit(tx);
      return new Response(null, { status: 101, webSocket: client });
    } catch (e) {
      console.error('fetch failed', e);
      return new Response('internal error', { status: 500 });
    }
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      const att = this.attachment(ws);
      if (att === null) {
        this.safeClose(ws, 4003, 'unknown connection');
        return;
      }
      if (raw === 'ping') {
        // 自動応答が効かなかった場合の保険
        this.safeSend(ws, 'pong');
        return;
      }
      const parsed = parseClientMessage(raw);
      // hello のハッシュの計算だけは、状態を読む前に済ませる（読んでから保存・送信までは await を挟まない）
      const tokenHash = parsed.ok && parsed.msg.type === 'hello' ? await hashToken(parsed.msg.token) : null;
      const s = this.load();
      if (s === null) {
        this.safeClose(ws, 4003, 'room closed');
        return;
      }
      const now = Date.now();
      if (isExpired(s, now)) {
        await this.closeRoom();
        return;
      }
      att.lastSeen = now;
      ws.serializeAttachment(att);
      const tx = new Tx(s, now);
      if (!parsed.ok) {
        tx.error(ws, parsed.code, parsed.message, parsed.reqId);
      } else {
        this.handle(tx, ws, att, parsed.msg, tokenHash);
      }
      this.settle(tx);
      this.commit(tx);
    } catch (e) {
      console.error('webSocketMessage failed', e);
      this.safeSend(ws, JSON.stringify({ type: 'error', code: 'badMessage', message: 'internal error', reqId: null }));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.onSocketGone(ws);
    this.safeClose(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    try {
      const s = this.load();
      if (s === null) return;
      if (isExpired(s, Date.now())) {
        await this.closeRoom();
        return;
      }
      const att = this.attachment(ws);
      const tx = new Tx(s, Date.now());
      // 現在の番号の接続の切断だけを扱う（古い接続の通知で、復帰済みの人を切断扱いにしない）
      if (att !== null && this.isCurrent(s, att)) this.markDisconnected(tx, att.seat);
      this.settle(tx, ws);
      this.commit(tx);
    } catch (e) {
      console.error('socket close handling failed', e);
    }
  }

  // ---------- アラーム ----------

  override async alarm(): Promise<void> {
    // 例外は捕まえずにプラットフォームのやり直し（回数に上限がある）に任せる。
    // やり直しが尽きても、次の入力の commit（期限が過去なら必ず設定し直す）か、起動時の点検でアラームは設定し直される。
    {
      const s = this.load();
      if (s === null) {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      const now = Date.now();
      const tx = new Tx(s, now);
      tx.alarmFired = true;
      if (isExpired(s, now)) {
        await this.closeRoom();
        return;
      }
      if (s.hbCheckAt !== null && now >= s.hbCheckAt) s.hbCheckAt = null;
      this.settle(tx);
      this.runExpired(tx);
      this.settle(tx);
      this.commit(tx);
    }
  }

  /** 期限切れの待ちに auto を送る。何度実行しても結果は同じ（古い待ち番号の auto は engine が拒否する）。 */
  private runExpired(tx: Tx): void {
    const s = tx.s;
    for (let guard = 0; guard < 1000; guard++) {
      if (s.match === null || s.pausedAt !== null) return;
      const due = s.deadlines.filter((d) => d.at !== null && d.at <= tx.now).sort((a, b) => a.awaitId - b.awaitId)[0];
      if (due === undefined) return;
      s.deadlines = s.deadlines.filter((d) => d.awaitId !== due.awaitId);
      const policy = isBotSeat(s, due.seat) ? 'cpu' : 'timeout';
      const r = this.applyEngine(tx, { type: 'auto', awaitId: due.awaitId, policy });
      if (!r.ok) console.warn('auto rejected', due.awaitId, r.code);
      syncDeadlines(s, tx.now);
    }
  }

  private async closeRoom(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) this.safeClose(ws, 4003, 'room closed');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---------- メッセージ ----------

  private handle(tx: Tx, ws: WebSocket, att: Attachment, msg: ClientMessage, tokenHash: string | null): void {
    const s = tx.s;
    const reqId = msg.reqId ?? null;
    if (msg.type === 'hello') {
      if (tokenHash !== null) this.hello(tx, ws, att, msg.name, tokenHash, reqId);
      return;
    }
    if (att.seat === null) {
      tx.error(ws, 'notJoined', 'send hello first', reqId);
      return;
    }
    if (!this.isCurrent(s, att)) {
      // 置き換えられた古い接続
      tx.closes.push({ ws, code: 4001, reason: 'replaced by a newer connection' });
      return;
    }
    const seat = att.seat;
    // 試合に対する操作は、どの試合に向けたものかを確かめる（decisions §14.15）
    if (msg.type === 'action' || msg.type === 'nextGame' || msg.type === 'endMatch' || msg.type === 'rematch') {
      if (s.match === null) {
        tx.error(ws, 'wrongPhase', 'no match in progress', reqId);
        return;
      }
      if (msg.matchId !== s.match.matchId) {
        tx.error(ws, 'staleMatch', 'this message is for another match', reqId);
        return;
      }
    }
    if (msg.type === 'action') {
      if (s.match === null) return;
      const a = msg.action;
      let action: Action;
      switch (a.type) {
        case 'play': {
          const p: Action = { type: 'play', seat, awaitId: a.awaitId, cards: a.cards };
          if (a.shape !== undefined) p.shape = a.shape;
          if (a.confirmFoul !== undefined) p.confirmFoul = a.confirmFoul;
          action = p;
          break;
        }
        case 'pass':
          action = { type: 'pass', seat, awaitId: a.awaitId };
          break;
        case 'respond':
          action = { type: 'respond', seat, awaitId: a.awaitId, cards: a.cards };
          break;
        case 'exchangeGive':
          action = { type: 'exchangeGive', seat, awaitId: a.awaitId, cards: a.cards };
          break;
      }
      const r = this.applyEngine(tx, action);
      if (!r.ok) tx.error(ws, 'actionRejected', r.message, reqId, r.code);
      return;
    }
    // ここから下はホストの操作
    if (s.host !== seat) {
      tx.error(ws, 'notHost', 'only the host can do this', reqId);
      return;
    }
    switch (msg.type) {
      case 'setConfig': {
        if (s.match !== null) {
          tx.error(ws, 'wrongPhase', 'rules cannot be changed after the match starts', reqId);
          return;
        }
        const rules = orderRules(msg.rules);
        const err = validateConfig({ matchId: 'draft', rules, gameCount: msg.gameCount });
        if (err !== null) {
          tx.error(ws, 'invalidConfig', err.message, reqId);
          return;
        }
        s.draft = { rules, gameCount: msg.gameCount };
        return;
      }
      case 'start': {
        if (s.match !== null) {
          tx.error(ws, 'wrongPhase', 'the match has already started', reqId);
          return;
        }
        for (const seatNo of SEATS) {
          const r = seatRec(s, seatNo);
          if (r.kind === 'empty') {
            s.seats[seatNo] = { ...emptySeat(), kind: 'cpu', name: `CPU ${seatNo + 1}`, gen: r.gen };
          }
        }
        if (!this.startMatch(tx, { rules: s.draft.rules.slice(), gameCount: s.draft.gameCount })) {
          tx.error(ws, 'invalidConfig', 'could not create the match', reqId);
        }
        return;
      }
      case 'nextGame':
      case 'endMatch': {
        if (s.match === null) {
          tx.error(ws, 'wrongPhase', 'no match in progress', reqId);
          return;
        }
        const r = this.applyEngine(tx, { type: msg.type });
        if (!r.ok) tx.error(ws, 'actionRejected', r.message, reqId, r.code);
        return;
      }
      case 'rematch': {
        if (s.match === null || s.match.phase !== 'matchResult') {
          tx.error(ws, 'wrongPhase', 'rematch is allowed only on the match result', reqId);
          return;
        }
        const cfg = s.match.config;
        if (!this.startMatch(tx, { rules: cfg.rules.slice(), gameCount: cfg.gameCount })) {
          tx.error(ws, 'invalidConfig', 'could not create the match', reqId);
        }
        return;
      }
    }
  }

  private hello(tx: Tx, ws: WebSocket, att: Attachment, name: string, tokenHash: string, reqId: ReqId | null): void {
    const s = tx.s;
    if (att.seat !== null) {
      tx.error(ws, 'alreadyJoined', 'hello was already sent on this connection', reqId);
      return;
    }
    let seat = SEATS.find((x) => seatRec(s, x).tokenHash === tokenHash);
    if (seat !== undefined) {
      // 同じ人の復帰。古い接続は閉じる
      const r = seatRec(s, seat);
      for (const o of this.openSockets()) {
        if (o.ws !== ws && o.att.seat === seat) tx.closes.push({ ws: o.ws, code: 4001, reason: 'replaced by a newer connection' });
      }
      r.gen += 1;
      r.connected = true;
      r.disconnectedAt = null;
      r.away = false;
      if (s.match === null) r.name = name;
      tx.resetSeats.add(seat);
    } else {
      const phase = s.match?.phase ?? null;
      if (phase === null) {
        seat = SEATS.find((x) => seatRec(s, x).kind === 'empty');
      } else if (phase === 'gameResult' || phase === 'matchResult') {
        // ゲームの合間だけ、はじめから CPU の席に入れる（点数と階級はその席のものを引き継ぐ）
        seat = SEATS.find((x) => seatRec(s, x).kind === 'cpu');
      } else {
        tx.error(ws, 'cannotJoin', 'you can join only between games', reqId);
        tx.closes.push({ ws, code: 4002, reason: 'cannot join now' });
        return;
      }
      if (seat === undefined) {
        tx.error(ws, 'roomFull', 'no seat is available', reqId);
        tx.closes.push({ ws, code: 4002, reason: 'room full' });
        return;
      }
      const old = seatRec(s, seat);
      s.seats[seat] = { kind: 'human', name, tokenHash, gen: old.gen + 1, connected: true, disconnectedAt: null, away: false };
      tx.resetSeats.add(seat);
    }
    att.seat = seat;
    att.gen = seatRec(s, seat).gen;
    ws.serializeAttachment(att);
    tx.fullFor.add(ws);
  }

  private startMatch(tx: Tx, rc: { rules: MatchConfig['rules']; gameCount: MatchConfig['gameCount'] }): boolean {
    const s = tx.s;
    const matchId = randomId(9);
    const seed = randomSeed();
    const config: MatchConfig = { matchId, rules: rc.rules, gameCount: rc.gameCount };
    const r = createMatch(config, seed);
    if (!r.ok) return false;
    const init: MatchInit = { matchId, config, seed };
    s.match = r.state;
    s.matchInit = init;
    s.deadlines = [];
    tx.clearLogs = true;
    tx.logs.clear();
    this.appendEvents(tx, r.events);
    return true;
  }

  /** engine に操作を1つ渡す。成功したら状態・出来事・操作の記録を更新する。 */
  private applyEngine(tx: Tx, action: Action): { ok: true } | { ok: false; code: string; message: string } {
    const s = tx.s;
    if (s.match === null) return { ok: false, code: 'wrongPhase', message: 'no match' };
    const r = applyAction(s.match, action);
    if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
    s.match = r.state;
    this.appendEvents(tx, r.events);
    this.logAction(tx, s.match.gameNo, { at: tx.now, action });
    syncDeadlines(s, tx.now);
    return { ok: true };
  }

  private appendEvents(tx: Tx, events: readonly GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'gameStart') tx.s.eventLog = [];
      tx.s.eventLog.push(e);
      tx.newEvents.push(e);
    }
  }

  private logAction(tx: Tx, gameNo: number, entry: LoggedAction): void {
    let list = tx.logs.get(gameNo);
    if (list === undefined) {
      list = tx.clearLogs ? [] : (this.ctx.storage.kv.get<LoggedAction[]>(`${ACTIONS_PREFIX}${gameNo}`) ?? []);
      tx.logs.set(gameNo, list);
    }
    list.push(entry);
  }

  // ---------- 接続の状態・期限・ホスト ----------

  private markDisconnected(tx: Tx, seat: SeatId): void {
    const r = seatRec(tx.s, seat);
    if (r.kind !== 'human' || !r.connected) return;
    r.connected = false;
    r.disconnectedAt = tx.now;
  }

  /**
   * 入力のたびに行う点検:
   * 接続と席の突き合わせ（再起動で消えた接続）、応答のない接続、切断の猶予、一時停止と再開、期限、ホスト、応答確認の時刻。
   */
  private settle(tx: Tx, closingWs?: WebSocket): void {
    const s = tx.s;
    const now = tx.now;
    const open = this.openSockets().filter((o) => o.ws !== closingWs && !tx.closes.some((c) => c.ws === o.ws));
    // 応答のない接続を閉じる
    for (const o of open) {
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(o.ws)?.getTime() ?? 0;
      const last = Math.max(o.att.lastSeen, auto);
      if (now - last > s.timing.heartbeatTimeoutMs) {
        tx.closes.push({ ws: o.ws, code: 4000, reason: 'no heartbeat' });
        if (this.isCurrent(s, o.att)) this.markDisconnected(tx, o.att.seat);
      }
    }
    const alive = open.filter((o) => !tx.closes.some((c) => c.ws === o.ws));
    // 接続中のはずなのに接続がない席（開発サーバーの再起動などで切断の通知が来なかった）
    for (const seat of SEATS) {
      const r = seatRec(s, seat);
      if (r.kind !== 'human' || !r.connected) continue;
      if (!alive.some((o) => o.att.seat === seat && o.att.gen === r.gen)) this.markDisconnected(tx, seat);
    }
    // 切断から猶予がたった人を代役にする
    for (const seat of SEATS) {
      const r = seatRec(s, seat);
      if (r.kind === 'human' && !r.connected && !r.away && r.disconnectedAt !== null && now >= r.disconnectedAt + s.timing.disconnectGraceMs) {
        r.away = true;
        resetSeatDeadlines(s, seat, now);
      }
    }
    // 一時停止と再開
    if (connectedHumans(s) === 0) pause(s, now);
    else resume(s, now);
    syncDeadlines(s, now);
    // 復帰した本人の待ちは秒数いっぱいに付け直す
    for (const seat of tx.resetSeats) resetSeatDeadlines(s, seat, now);
    tx.resetSeats.clear();
    ensureHost(s);
    if (needsHeartbeat(s, alive.some((o) => o.att.seat === null))) {
      if (s.hbCheckAt === null) s.hbCheckAt = now + s.timing.heartbeatCheckMs;
    } else {
      s.hbCheckAt = null;
    }
  }

  /** 保存・アラームの設定・送信。間に await を挟まない。 */
  private commit(tx: Tx): void {
    const s = tx.s;
    const want = nextAlarm(s);
    // 期限が過去なら、保存された alarmAt と同じでも設定し直す（アラームの処理が失敗してやり直しが尽きた場合など、
    // 実際のアラームがもうないかもしれない。未来の alarmAt はまだ鳴っていないので、アラームは残っている）
    const alarmChanged = want !== s.alarmAt || tx.alarmFired || (want !== null && want <= tx.now);
    s.alarmAt = want;
    // 外へ見える内容が変わったときだけ版番号を上げて送る（応答確認の時刻など内部の値だけの変化では送らない）
    const changed = publicSignature(s) !== tx.beforePublic;
    if (changed) s.version += 1;
    if (changed || JSON.stringify(s) !== tx.before) {
      this.ctx.storage.kv.put(ROOM_KEY, s);
      if (tx.clearLogs) {
        for (const [key] of this.ctx.storage.kv.list({ prefix: ACTIONS_PREFIX })) this.ctx.storage.kv.delete(key);
      }
      for (const [gameNo, list] of tx.logs) this.ctx.storage.kv.put(`${ACTIONS_PREFIX}${gameNo}`, list);
    }
    if (alarmChanged) {
      if (want === null) void this.ctx.storage.deleteAlarm();
      else void this.ctx.storage.setAlarm(want + s.timing.testAlarmLagMs);
    }
    for (const o of this.openSockets()) {
      if (tx.closes.some((c) => c.ws === o.ws)) continue;
      const full = tx.fullFor.has(o.ws);
      if (!changed && !full) continue;
      if (o.att.seat === null) {
        this.sendTo(o.ws, this.stateFor(s, null, [], true));
      } else if (this.isCurrent(s, o.att)) {
        this.sendTo(o.ws, this.stateFor(s, o.att.seat, full ? s.eventLog : tx.newEvents, full));
      }
    }
    for (const d of tx.direct) this.sendTo(d.ws, d.msg);
    for (const c of tx.closes) this.safeClose(c.ws, c.code, c.reason);
  }

  // ---------- 外へ出す形 ----------

  private roomView(s: RoomState): RoomView {
    return {
      roomId: s.roomId,
      phase: roomPhase(s),
      seats: SEATS.map((seat) => {
        const r = seatRec(s, seat);
        return { seat, kind: r.kind, name: r.name, connected: r.kind === 'human' && r.connected, away: r.kind === 'human' && r.away };
      }),
      host: s.host,
      config:
        s.match === null
          ? { rules: s.draft.rules.slice(), gameCount: s.draft.gameCount }
          : { rules: s.match.config.rules.slice(), gameCount: s.match.config.gameCount },
      paused: s.pausedAt !== null,
    };
  }

  private stateFor(s: RoomState, seat: SeatId | null, events: readonly GameEvent[], full: boolean): StateMessage {
    const m = s.match;
    return {
      type: 'state',
      room: this.roomView(s),
      seat,
      isHost: seat !== null && s.host === seat,
      matchId: m === null ? null : m.matchId,
      matchPhase: m === null ? null : m.phase,
      version: s.version,
      view: m === null || seat === null ? null : viewFor(m, seat),
      events: m === null || seat === null ? [] : eventsFor(events, seat),
      eventsFull: full,
      deadlines: s.deadlines.map((d) => ({ awaitId: d.awaitId, seat: d.seat, kind: d.kind, at: d.at, remainingMs: d.remaining })),
      serverTime: Date.now(),
    };
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    this.safeSend(ws, JSON.stringify(msg));
  }

  private safeSend(ws: WebSocket, text: string): void {
    try {
      ws.send(text);
    } catch (e) {
      console.warn('send failed', e);
    }
  }

  private safeClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // すでに閉じている
    }
  }
}
