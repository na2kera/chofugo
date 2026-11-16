// 通しのテストの道具。ローカルの開発サーバー（wrangler dev）を起動し、本物の WebSocket でつなぐ。
// Node 22.12 以上（wrangler 4.162.0 の要件）。Node 22 ではグローバルの WebSocket が使える。

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_JS = join(SERVER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 開発サーバーを起動する。persistDir を渡すと、止めて起動し直しても同じストレージを使う。 */
export async function startServer({ port, persistDir } = {}) {
  const dir = persistDir ?? mkdtempSync(join(tmpdir(), 'chofugo-e2e-'));
  const args = [
    WRANGLER_JS,
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-port',
    String(port + 1000),
    '--persist-to',
    dir,
    '--show-interactive-dev-session=false',
    '--var',
    'CHOFUGO_TEST_MODE:1',
  ];
  const child = spawn(process.execPath, args, {
    cwd: SERVER_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`wrangler exited early:\n${log}`);
    try {
      const r = await fetch(`${base}/api/ping`);
      if (r.status === 404) break;
    } catch {
      // まだ起動中
    }
    if (Date.now() - started > 60_000) {
      killGroup(child);
      throw new Error(`wrangler did not start:\n${log}`);
    }
    await sleep(300);
  }
  return {
    base,
    persistDir: dir,
    log: () => log,
    async stop({ keep = false } = {}) {
      killGroup(child);
      for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
        await sleep(300);
      }
      if (!keep) rmSync(dir, { recursive: true, force: true });
    },
  };
}

function killGroup(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
}

export async function createRoom(base, timing) {
  const r = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(timing === undefined ? {} : { timing }),
  });
  if (r.status !== 201) throw new Error(`createRoom failed: ${r.status} ${await r.text()}`);
  return (await r.json()).roomId;
}

export function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString('base64url');
}

/**
 * テスト用のクライアント。届いたメッセージをすべて記録する。
 * auto: true なら、自分の待ちに対して出せる手からでたらめに選んで操作する（反則上がりの手も時々選ぶ）。
 * autoHost: true なら、ホストのときにゲームの結果画面で次のゲームを配る。
 */
export class Client {
  constructor(base, roomId, opts = {}) {
    this.url = `${base.replace(/^http/, 'ws')}/api/rooms/${roomId}/ws`;
    this.token = opts.token ?? randomToken();
    this.name = opts.name ?? 'player';
    this.auto = opts.auto ?? false;
    this.autoHost = opts.autoHost ?? false;
    this.actDelay = opts.actDelay ?? 0;
    this.pingMs = opts.pingMs ?? 300;
    this.messages = [];
    this.states = [];
    this.errors = [];
    this.state = null;
    this.closed = null;
    this.acted = new Set();
    this.nextGameSent = new Set();
    this.waiters = [];
    this.reqId = 1;
    this.rejectedOwn = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      this.closed = null;
      ws.onopen = () => {
        if (this.pingMs > 0) this.pinger = setInterval(() => this.ping(), this.pingMs);
        resolve();
      };
      ws.onerror = () => reject(new Error(`websocket error ${this.url}`));
      ws.onclose = (e) => {
        clearInterval(this.pinger);
        this.closed = { code: e.code, reason: e.reason };
        this.notify();
      };
      ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  ping() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
  }

  stopPing() {
    clearInterval(this.pinger);
  }

  onMessage(data) {
    if (data === 'pong') return;
    const msg = JSON.parse(data);
    msg.receivedAt = Date.now();
    this.messages.push({ raw: data, msg });
    if (msg.type === 'state') {
      this.states.push(msg);
      this.state = msg;
      if (this.auto) this.maybeAct();
      if (this.autoHost) this.maybeNextGame();
    } else if (msg.type === 'error') {
      this.errors.push(msg);
      if (msg.reqId !== null && this.autoReqs?.has(msg.reqId)) this.rejectedOwn.push(msg);
    }
    this.notify();
  }

  notify() {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) if (!w()) this.waiters.push(w);
  }

  send(obj) {
    const reqId = this.reqId++;
    this.ws.send(JSON.stringify({ ...obj, reqId }));
    return reqId;
  }

  sendRaw(text) {
    this.ws.send(text);
  }

  hello(name = this.name) {
    return this.send({ type: 'hello', token: this.token, name });
  }

  /** 条件を満たす state を待つ（いまの state が満たしていればすぐ返す）。 */
  waitState(pred, ms = 30_000, label = 'state') {
    return this.waitFor(() => (this.state !== null && pred(this.state) ? this.state : undefined), ms, label);
  }

  /** reqId に対する error を待つ。 */
  waitError(reqId, ms = 10_000) {
    return this.waitFor(() => this.errors.find((e) => e.reqId === reqId), ms, `error for ${reqId}`);
  }

  waitClosed(ms = 10_000) {
    return this.waitFor(() => this.closed ?? undefined, ms, 'close');
  }

  waitFor(check, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (${this.name})`)), ms);
      const w = () => {
        const v = check();
        if (v !== undefined) {
          clearTimeout(t);
          resolve(v);
          return true;
        }
        return false;
      };
      if (!w()) this.waiters.push(w);
    });
  }

  close() {
    clearInterval(this.pinger);
    try {
      this.ws.close();
    } catch {}
  }

  maybeAct() {
    const mine = this.state?.view?.mine;
    if (!mine || this.acted.has(mine.awaitId)) return;
    this.acted.add(mine.awaitId);
    const action = chooseAction(mine, this.state.view.game?.hand ?? []);
    const go = () => {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      const id = this.send({ type: 'action', action });
      (this.autoReqs ??= new Set()).add(id);
    };
    if (this.actDelay > 0) setTimeout(go, this.actDelay);
    else go();
  }

  maybeNextGame() {
    const s = this.state;
    if (!s.isHost || s.matchPhase !== 'gameResult') return;
    const key = `${s.matchId}:${s.view?.gameNo}`;
    if (this.nextGameSent.has(key)) return;
    this.nextGameSent.add(key);
    this.send({ type: 'nextGame' });
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 出せる手からでたらめに選ぶ。親は出せる手があればパスできない。 */
export function chooseAction(mine, hand) {
  if (mine.kind === 'turn') {
    const plays = mine.plays;
    const usePass = mine.canPass && (plays.length === 0 || Math.random() < 0.3);
    if (usePass) return { type: 'pass', awaitId: mine.awaitId };
    const nonFoul = plays.filter((p) => !p.foul);
    const p = nonFoul.length > 0 && Math.random() < 0.9 ? pick(nonFoul) : pick(plays);
    const a = { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape };
    if (p.foul) a.confirmFoul = true;
    return a;
  }
  if (mine.kind === 'respond') {
    if (mine.plays.length > 0 && Math.random() < 0.7) return { type: 'respond', awaitId: mine.awaitId, cards: pick(mine.plays).cards };
    return { type: 'respond', awaitId: mine.awaitId, cards: null };
  }
  // exchangeGive
  if (mine.role === 'lower') {
    const pool = mine.candidates.slice();
    const chosen = [];
    while (chosen.length < mine.choose) chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return { type: 'exchangeGive', awaitId: mine.awaitId, cards: [...mine.forced, ...chosen] };
  }
  const pool = hand.slice();
  const cards = [];
  while (cards.length < mine.count) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return { type: 'exchangeGive', awaitId: mine.awaitId, cards };
}

/** 4席それぞれに届いた全 state を、版番号で突き合わせて他人の手札が含まれていないか確かめる。問題の一覧を返す。 */
export function checkNoLeak(clients) {
  const problems = [];
  // 版番号 → 席 → その時点の手札（本人に届いたもの）
  const hands = new Map();
  for (const c of clients) {
    for (const st of c.states) {
      if (st.seat === null || st.view?.game == null) continue;
      const key = `${st.matchId}:${st.version}`;
      if (!hands.has(key)) hands.set(key, new Map());
      hands.get(key).set(st.seat, new Set(st.view.game.hand));
    }
  }
  const tokens = clients.map((c) => c.token);
  for (const c of clients) {
    const givenByGame = new Map();
    for (const { raw, msg } of c.messages) {
      for (const t of tokens) if (raw.includes(t)) problems.push(`token leaked to ${c.name}`);
      if (/"(rng|tokenHash|token|seed|hands)"/.test(raw)) problems.push(`internal field leaked to ${c.name}: ${raw.match(/"(rng|tokenHash|token|seed|hands)"/)[0]}`);
      if (msg.type !== 'state' || msg.seat === null || msg.view?.game == null) continue;
      const me = msg.seat;
      const gameNo = msg.view.gameNo;
      const gkey = `${msg.matchId}:${gameNo}`;
      if (!givenByGame.has(gkey)) givenByGame.set(gkey, new Set());
      const given = givenByGame.get(gkey);
      for (const e of msg.events) {
        if (e.type === 'exchange') {
          if (e.cards !== null && e.from !== me && e.to !== me) problems.push(`exchange cards shown to non-party ${c.name}`);
          if (e.cards !== null && e.from === me && e.gameNo === gameNo) for (const x of e.cards) given.add(x);
        }
      }
      for (const x of msg.view.game.myExchange?.gave ?? []) given.add(x);
      const own = new Set(msg.view.game.hand);
      // 自分の待ちの候補は自分の手札の中だけ
      const mine = msg.view.mine;
      if (mine) {
        const cards = [...(mine.plays ?? []).flatMap((p) => p.cards), ...(mine.forced ?? []), ...(mine.candidates ?? [])];
        for (const x of cards) if (!own.has(x)) problems.push(`mine contains a card not in own hand (${c.name}): ${x}`);
      }
      const others = hands.get(`${msg.matchId}:${msg.version}`);
      if (!others) continue;
      const found = new Set();
      collectCards(msg, found);
      for (const [seat, hand] of others) {
        if (seat === me) continue;
        for (const x of found) {
          if (hand.has(x) && !given.has(x)) problems.push(`seat ${me} (${c.name}) saw seat ${seat}'s card ${x} at version ${msg.version}`);
        }
      }
    }
  }
  return [...new Set(problems)];
}

const CARD_RE = /^(spade|heart|diamond|club)-(1[0-5]|[3-9])$|^joker-[01]$/;

function collectCards(v, out) {
  if (typeof v === 'string') {
    if (CARD_RE.test(v)) out.add(v);
  } else if (Array.isArray(v)) {
    for (const x of v) collectCards(x, out);
  } else if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) collectCards(x, out);
  }
}

/** 4人がそろってロビーに入るまで進める。 */
export async function joinAll(clients) {
  for (const c of clients) {
    await c.connect();
    const id = c.hello();
    await c.waitState((s) => s.seat !== null, 10_000, `joined ${id}`);
  }
}
