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

/**
 * テストの開発サーバーのポート（19480〜19489）。インスペクターはその +10（19490〜19499）。
 * 同じ機械の別のプロジェクトと衝突しないよう、この範囲だけを使う。
 * ファイルは1つずつ順に実行する（vitest.config の fileParallelism: false）ので、rejoin は connection と同じポートを使う
 * （19490 にすると、インスペクターが範囲の外の 19500 になるため）。第2段階の stage2 も同じ理由で choice と同じポートを使う。
 */
export const PORTS = { match: 19480, cpu: 19481, connection: 19482, restart: 19483, prod: 19484, review: 19485, custom: 19486, choice: 19487, chofugo: 19488, chofugo2: 19489, rejoin: 19482, stage2: 19487 };

/** 開発サーバーを起動する。persistDir を渡すと、止めて起動し直しても同じストレージを使う。 */
/** testMode: false なら CHOFUGO_TEST_MODE を渡さない（本番と同じ設定で起動する）。 */
export async function startServer({ port, persistDir, testMode = true } = {}) {
  const dir = persistDir ?? mkdtempSync(join(tmpdir(), 'chofugo-e2e-'));
  const args = [
    WRANGLER_JS,
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-port',
    String(port + 10),
    '--persist-to',
    dir,
    '--show-interactive-dev-session=false',
    ...(testMode ? ['--var', 'CHOFUGO_TEST_MODE:1'] : []),
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

/** このテストのファイルで作ったルーム（最後に期限の検査の記録を確かめるため）。 */
export const createdRooms = [];

/** ルームを作る。seed（4つの uint32）を渡すと、試合の種を固定する（テスト用の機能。scenario.mjs で場面を作るため）。 */
export async function createRoom(base, timing, seed) {
  const body = {};
  if (timing !== undefined) body.timing = timing;
  if (seed !== undefined) body.seed = seed;
  const r = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status !== 201) throw new Error(`createRoom failed: ${r.status} ${await r.text()}`);
  const { roomId } = await r.json();
  createdRooms.push(roomId);
  return roomId;
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
    /** 操作を送った待ち（`試合の識別子:待ちの番号`）。待ちの番号は試合ごとに1から振り直されるので、試合の識別子も含める。 */
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

  /** 試合に対する操作には、指定がなければいまの試合の識別子を付ける。 */
  send(obj) {
    const reqId = this.reqId++;
    const m = { ...obj, reqId };
    if (MATCH_MESSAGES.includes(obj.type) && !('matchId' in obj)) m.matchId = this.state?.matchId ?? null;
    this.ws.send(JSON.stringify(m));
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

  /** acted のキー。「もう一度」のあとの試合で番号がかぶっても操作を送る。 */
  actKey(mine) {
    return `${this.state?.matchId}:${mine.awaitId}`;
  }

  maybeAct() {
    const mine = this.state?.view?.mine;
    if (!mine || this.acted.has(this.actKey(mine))) return;
    this.acted.add(this.actKey(mine));
    const action = chooseAction(mine, this.state.view.game?.hand ?? [], this.state.view.game);
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

const MATCH_MESSAGES = ['action', 'nextGame', 'endMatch', 'rematch'];

/** テスト用の経路を呼ぶ。body を渡すと JSON で送る（test/timing）。 */
export async function testRoute(base, roomId, name, body) {
  const r = await fetch(`${base}/api/rooms/${roomId}/test/${name}`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (r.status !== 200) throw new Error(`test/${name}: ${r.status}`);
  return r.json();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 期限についての検査（design-2 §3.4）で見つかった問題の一覧。 */
export async function deadlineProblems(base, roomId) {
  return (await testRoute(base, roomId, 'check')).problems;
}

/** このファイルで作ったすべてのルームの、期限についての検査の記録（ルームごとの問題の一覧。問題がなければ空）。 */
export async function allDeadlineProblems(base) {
  const out = {};
  for (const id of createdRooms) {
    const p = await deadlineProblems(base, id);
    if (p.length > 0) out[id] = p;
  }
  return out;
}

/** Q ボンバーで宣言できるもの（engine の CallRank）。 */
export const CALL_RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 'joker'];

/**
 * 選択：種類ごとに正しい形の操作をでたらめに作る（design-4 §6.5。種類は待ちのルールから決める）。
 * 7渡し・10捨て・銀河鉄道は手札から 0〜max 枚。闇市は「使わない」か、targets からでたらめな相手と、ちょうど
 * min(max, 自分の枚数, 相手の枚数) 枚（相手の枚数は game.handCounts）。Q ボンバーは 0〜max 個の数字（cards は空）。
 */
export function chooseCards(mine, hand, game) {
  if (mine.rule === 'triple_a_trade') {
    const targets = mine.targets ?? [];
    if (targets.length === 0 || Math.random() < 0.3) return { type: 'choose', awaitId: mine.awaitId, cards: [] };
    const target = pick(targets);
    const n = Math.min(mine.max, hand.length, game.handCounts[target]);
    const pool = hand.slice();
    const cards = [];
    while (cards.length < n) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return { type: 'choose', awaitId: mine.awaitId, cards, target };
  }
  if (mine.rule === 'call_discard_on_q') {
    const pool = CALL_RANKS.slice();
    const n = Math.floor(Math.random() * (mine.max + 1));
    const ranks = [];
    while (ranks.length < n) ranks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return { type: 'choose', awaitId: mine.awaitId, cards: [], ranks };
  }
  const pool = hand.slice();
  const n = Math.floor(Math.random() * (Math.min(mine.max, pool.length) + 1));
  const cards = [];
  while (cards.length < n) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return { type: 'choose', awaitId: mine.awaitId, cards };
}

/** engine の ALL_ABILITY_IDS（その3）。 */
export const ALL_ABILITIES = ['peek', 'steal', 'forceFlush', 'ban', 'revolution', 'skip'];

/** 特権の選択：でたらめに 0〜枠の数を選んで確定する。 */
export function chooseAbilities(mine) {
  const pool = ALL_ABILITIES.slice();
  // 特権が実際に使われるよう、通しのテストでは1個以上を選ぶ（0個の決定は client・ボットのでたらめで確かめる）
  const n = 1 + Math.floor(Math.random() * mine.slots);
  const abilities = [];
  while (abilities.length < n) abilities.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return { type: 'selectAbilities', awaitId: mine.awaitId, abilities, confirm: true };
}

/** 使える特権からでたらめに1つ（引数もでたらめ）。使えるものがなければ null。 */
export function chooseAbilityUse(mine) {
  const usable = (mine.abilities ?? []).filter((x) => x.usable);
  if (usable.length === 0) return null;
  const u = pick(usable);
  const a = { type: 'useAbility', awaitId: mine.awaitId, ability: u.id };
  if (u.targets) a.target = pick(u.targets);
  if (u.cards) a.card = pick(u.cards);
  if (u.ranks) a.rank = pick(u.ranks);
  return a;
}

/**
 * 出せる手からでたらめに選ぶ。親は出せる手があればパスできない。
 * その3：特権の選択はでたらめに確定、手番では時々特権を使い、スキップを付けられる手には時々付ける。
 */
export function chooseAction(mine, hand, game) {
  if (mine.kind === 'choice') return chooseCards(mine, hand, game);
  if (mine.kind === 'abilitySelect') return chooseAbilities(mine);
  if (mine.kind === 'turn') {
    if (Math.random() < 0.5) {
      const use = chooseAbilityUse(mine);
      if (use !== null) return use;
    }
    const plays = mine.plays;
    const usePass = mine.canPass && (plays.length === 0 || Math.random() < 0.3);
    if (usePass) return { type: 'pass', awaitId: mine.awaitId };
    const nonFoul = plays.filter((p) => !p.foul);
    const p = nonFoul.length > 0 && Math.random() < 0.9 ? pick(nonFoul) : pick(plays);
    const a = { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape };
    if (p.foul) a.confirmFoul = true;
    if (p.canSkip && Math.random() < 0.5) a.withSkip = true;
    return a;
  }
  if (mine.kind !== 'respond' && mine.kind !== 'exchangeGive') throw new Error(`unknown await kind ${mine.kind}`);
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
        // 透視で見た・見られたカード、強奪で動いたカードは、当事者が知っていてよい（design-3 §2.6）
        if (e.type === 'ability' && (e.ability === 'peek' || e.ability === 'steal')) {
          const party = e.seat === me || e.target === me;
          const shown = [...(e.cards ?? []), ...(e.given !== undefined ? [e.given] : []), ...(e.taken !== undefined ? [e.taken] : [])];
          if (!party && shown.length > 0) problems.push(`${e.ability} cards shown to non-party ${c.name}`);
          if (party && e.gameNo === gameNo) for (const x of shown) given.add(x);
        }
        // 闇市で動いたカードは当事者だけ（design-4 §2.7）。当事者は、渡したカードも受け取ったカードも知っていてよい
        if (e.type === 'trade') {
          const party = e.from === me || e.to === me;
          if (!party && (e.given !== null || e.taken !== null)) problems.push(`trade cards shown to non-party ${c.name}`);
          if (party && (e.given === null || e.taken === null)) problems.push(`trade cards hidden from party ${c.name}`);
          if (typeof e.count !== 'number') problems.push(`trade without count to ${c.name}`);
          if (party && e.gameNo === gameNo) for (const x of [...(e.given ?? []), ...(e.taken ?? [])]) given.add(x);
        }
        // 銀河鉄道で捨て札から受け取ったカードは全員に見える（design-4 §2.4。捨て札は公開の情報）
        if (e.type === 'salvage' && e.gameNo === gameNo) for (const x of e.took) given.add(x);
        if (e.type === 'exchange' || e.type === 'give') {
          if (e.cards !== null && e.from !== me && e.to !== me) problems.push(`${e.type} cards shown to non-party ${c.name}`);
          if (e.type === 'give' && e.cards === null && typeof e.count !== 'number') problems.push(`give without count to ${c.name}`);
          // 自分が渡したカードは、受け取った人の手札にあっても見えてよい
          if (e.cards !== null && e.from === me && e.gameNo === gameNo) for (const x of e.cards) given.add(x);
        }
      }
      for (const x of msg.view.game.myExchange?.gave ?? []) given.add(x);
      for (const x of msg.view.game.peek?.cards ?? []) given.add(x);
      const own = new Set(msg.view.game.hand);
      // 自分の待ちの候補は自分の手札の中だけ
      const mine = msg.view.mine;
      if (mine) {
        const cards = [
          ...(mine.plays ?? []).flatMap((p) => p.cards),
          ...(mine.forced ?? []),
          ...(mine.candidates ?? []),
          ...(mine.abilities ?? []).flatMap((u) => u.cards ?? []),
        ];
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
    // ダイヤの3スタートの義務のカード（GameView.openingCard）は、最初の親が持っていることがルールで全員に分かる（公開の情報）
    for (const [k, x] of Object.entries(v)) if (k !== 'openingCard') collectCards(x, out);
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

/**
 * 受け身の席（その3のテスト用）。親でないときは必ずパスし、特権は使わない（選択では何も選ばずに確定する）。
 * 親のときは出せる手からでたらめに1手。返しの一周はスキップ、7渡し・10捨ては選ばない。交換はでたらめ。
 * ほかの席を受け身にすると、残りの1席（人間でも CPU でも）がほぼ確実に1位になる。
 */
export class PassiveClient extends Client {
  constructor(base, roomId, opts = {}) {
    super(base, roomId, { auto: true, ...opts });
  }

  maybeAct() {
    const mine = this.state?.view?.mine;
    if (!mine || this.acted.has(this.actKey(mine))) return;
    this.acted.add(this.actKey(mine));
    this.send({ type: 'action', action: passiveAction(mine, this.state.view.game?.hand ?? []) });
  }
}

export function passiveAction(mine, hand) {
  switch (mine.kind) {
    case 'turn':
      if (mine.canPass) return { type: 'pass', awaitId: mine.awaitId };
      {
        const p = pick(mine.plays);
        const a = { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape };
        if (p.foul) a.confirmFoul = true;
        return a;
      }
    case 'abilitySelect':
      return { type: 'selectAbilities', awaitId: mine.awaitId, abilities: [], confirm: true };
    case 'respond':
      return { type: 'respond', awaitId: mine.awaitId, cards: null };
    case 'choice':
      return { type: 'choose', awaitId: mine.awaitId, cards: [] };
    default:
      return chooseAction(mine, hand);
  }
}

/**
 * 大富豪になるための席（その3のテスト用）。反則にならない手を優先して出し、出せるときはパスしない。
 * 特権の選択の待ちが来たら、自分では操作せずに manual を立てて止まる（テストが手で操作する）。
 * stopOnAbility が真なら、使える特権のある手番でも止まる。manual を下ろして resume() で再開する。
 */
export class HolderClient extends Client {
  constructor(base, roomId, opts = {}) {
    super(base, roomId, { auto: true, autoHost: true, ...opts });
    this.manual = false;
    this.stopOnAbility = opts.stopOnAbility ?? false;
  }

  maybeAct() {
    if (this.manual) return;
    const mine = this.state?.view?.mine;
    if (!mine || this.acted.has(this.actKey(mine))) return;
    if (mine.kind === 'abilitySelect' || (this.stopOnAbility && mine.kind === 'turn' && mine.abilities.some((u) => u.usable))) {
      this.manual = true;
      this.notify();
      return;
    }
    this.acted.add(this.actKey(mine));
    let action;
    if (mine.kind === 'turn') {
      const ok = mine.plays.filter((p) => !p.foul);
      if (ok.length > 0) action = { type: 'play', awaitId: mine.awaitId, cards: pick(ok).cards, shape: undefined };
      else if (mine.canPass) action = { type: 'pass', awaitId: mine.awaitId };
      else {
        const p = pick(mine.plays);
        action = { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape, confirmFoul: true };
      }
      if (action.type === 'play' && action.shape === undefined) action.shape = mine.plays.find((p) => p.cards === action.cards).shape;
    } else {
      action = passiveAction(mine, this.state.view.game?.hand ?? []);
    }
    const id = this.send({ type: 'action', action });
    (this.autoReqs ??= new Set()).add(id);
  }

  resume() {
    this.manual = false;
    this.maybeAct();
  }
}
