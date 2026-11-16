#!/usr/bin/env node
// 開発用：開発サーバーに WebSocket でつないで、席を自動で埋めて操作する（design-client §6、§7.12）。
// 出せる手からでたらめに選ぶ（反則上がりの手も時々選ぶ）。Node 22 以上（グローバルの WebSocket を使う）。
//
//   node scripts/bots.mjs [--base http://localhost:5173] [--room <ルームID>] [--count 3]
//                         [--delay 400] [--games 5|10|0] [--start-when 4] [--rematch] [--quiet]
//                         [--mode daifugo|custom] [--rules all|<ID,ID,...>]
//
//   --room がなければルームを作って URL を表示する。
//   ボットがホストになったら、人が --start-when 人（初期値 4）そろった時点で試合を始め（残りの空席は CPU になる）、
//   ゲームの結果では次のゲームを配る。試合の結果に着いたら終わる（--rematch ならもう一度）。
//   --mode / --rules はボットがホストのときに設定する（--rules all はそのモードで選べるルールすべて）。
//   設定はサーバーが直す（モードで選べないルール・前提のないルールは外れる）。指定がなければルームの設定のまま。
//   7渡し・10捨ての選択（choice）では、手札からでたらめに 0〜上限枚を選ぶ。

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const BASE = String(opt('base', 'http://localhost:5173')).replace(/\/$/, '');
const COUNT = Number(opt('count', 3));
const DELAY = Number(opt('delay', 400));
const GAMES = opt('games', '5');
const REMATCH = opt('rematch', false) === true;
const QUIET = opt('quiet', false) === true;
const START_WHEN = Number(opt('start-when', 4));
const MODE = opt('mode', null);
const RULES = opt('rules', null);

// engine の ALL_RULE_IDS と DAIFUGO_MODE_RULE_IDS（このスクリプトは engine を読み込まないので写しを持つ）
const ALL_RULES = [
  'flush_on_8', 'block_flush_with_4', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'sequence_lock', 'runs',
  'forbidden_finish', 'dethrone', 'diamond3_start', 'triple3_trump', 'give_on_7', 'reverse_order_on_9', 'discard_on_10', 'skip_on_k',
];
const DAIFUGO_RULES = ['flush_on_8', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'runs', 'forbidden_finish', 'dethrone'];
if (MODE !== null && MODE !== 'daifugo' && MODE !== 'custom') throw new Error('--mode は daifugo か custom');

/** ホストのときに送る設定（指定がなければいまの設定）。 */
function wantedConfig(cur, gameCount) {
  const mode = MODE ?? cur.mode;
  let rules = cur.rules;
  if (RULES === 'all') rules = mode === 'custom' ? ALL_RULES : DAIFUGO_RULES;
  else if (typeof RULES === 'string') rules = RULES.split(',').map((x) => x.trim()).filter(Boolean);
  return { type: 'setConfig', mode, rules, gameCount };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => {
  if (!QUIET) console.log(new Date().toISOString().slice(11, 19), ...a);
};

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString('base64url');
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 出せる手からでたらめに選ぶ。親は出せる手があればパスできない（server/test/helpers.mjs と同じ考え方）。 */
function chooseAction(mine, hand) {
  if (mine.kind === 'choice') {
    // 7渡し・10捨て：手札からでたらめに 0〜max 枚
    const pool = hand.slice();
    const n = Math.floor(Math.random() * (Math.min(mine.max, pool.length) + 1));
    const cards = [];
    while (cards.length < n) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return { type: 'choose', awaitId: mine.awaitId, cards };
  }
  if (mine.kind === 'turn') {
    const plays = mine.plays;
    if (mine.canPass && (plays.length === 0 || Math.random() < 0.3)) return { type: 'pass', awaitId: mine.awaitId };
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
  if (mine.role === 'lower') {
    const pool = mine.candidates.filter((c) => !mine.forced.includes(c));
    const chosen = [];
    while (chosen.length < mine.choose) chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return { type: 'exchangeGive', awaitId: mine.awaitId, cards: [...mine.forced, ...chosen] };
  }
  const pool = hand.slice();
  const cards = [];
  while (cards.length < mine.count) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return { type: 'exchangeGive', awaitId: mine.awaitId, cards };
}

class Bot {
  constructor(roomId, name) {
    this.url = `${BASE.replace(/^http/, 'ws')}/api/rooms/${roomId}/ws`;
    this.name = name;
    this.token = randomToken();
    this.state = null;
    this.reqId = 0;
    this.done = new Set();
    this.finished = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        ws.send('ping');
        this.pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 5000);
        this.send({ type: 'hello', token: this.token, name: this.name });
        resolve();
      };
      ws.onerror = () => reject(new Error(`接続できない: ${this.url}`));
      ws.onclose = (e) => {
        clearInterval(this.pinger);
        log(`${this.name}: 切断 (${e.code})`);
        this.finished = true;
      };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') this.onState(msg);
        else if (msg.type === 'error' && !['staleMatch', 'wrongPhase'].includes(msg.code)) log(`${this.name}: 拒否 ${msg.code} ${msg.engineError ?? ''}`);
      };
    });
  }

  send(obj) {
    this.reqId += 1;
    this.ws.send(JSON.stringify({ ...obj, reqId: this.reqId }));
  }

  once(key, fn, delay = DELAY) {
    if (this.done.has(key)) return;
    this.done.add(key);
    setTimeout(() => {
      if (this.ws.readyState === WebSocket.OPEN) fn();
    }, delay);
  }

  onState(s) {
    const prevPhase = this.state?.matchPhase;
    this.state = s;
    if (s.seat === null) return;
    // その2の出来事を数える（ルールが実際に起きたかの目安）
    if (!s.eventsFull) {
      this.stats ??= {};
      for (const e of s.events) {
        const k = e.type === 'fieldCleared' ? `fieldCleared:${e.reason}` : e.type === 'respond' && e.toDiscard ? 'respond:4止め' : e.type;
        if (['seqLock', 'orderReverse', 'choiceStart', 'give', 'discard', 'choiceSkip', 'skipped', 'respond:4止め', 'fieldCleared:triple3_trump', 'respond'].includes(k)) this.stats[k] = (this.stats[k] ?? 0) + 1;
      }
    }
    if (s.matchPhase !== prevPhase) log(`${this.name}: ${s.matchPhase ?? 'lobby'}${s.view ? ` 第${s.view.gameNo}ゲーム` : ''}`);
    const mine = s.view?.mine;
    if (mine) this.once(`${s.matchId}:a${mine.awaitId}`, () => this.send({ type: 'action', matchId: s.matchId, action: chooseAction(mine, s.view.game?.hand ?? []) }));
    if (!s.isHost) {
      if (s.matchPhase === 'matchResult' && !REMATCH) this.finish(s);
      return;
    }
    if (s.matchPhase === null) {
      const humans = s.room.seats.filter((x) => x.kind === 'human').length;
      if (humans >= START_WHEN) {
        const gameCount = GAMES === '0' ? null : Number(GAMES);
        // 設定と開始は同じ接続で続けて送る（届く順は送った順なので、短い --delay でも設定が先に効く）
        this.once(`start`, () => {
          this.send(wantedConfig(s.room.config, gameCount));
          this.send({ type: 'start' });
        }, DELAY);
      }
    } else if (s.matchPhase === 'gameResult') {
      this.once(`${s.matchId}:next${s.view.gameNo}`, () => this.send({ type: 'nextGame', matchId: s.matchId }), DELAY * 3);
    } else if (s.matchPhase === 'matchResult') {
      if (REMATCH) this.once(`${s.matchId}:rematch`, () => this.send({ type: 'rematch', matchId: s.matchId }), DELAY * 3);
      else this.finish(s);
    }
  }

  finish(s) {
    if (this.finished) return;
    this.finished = true;
    const st = s.view?.standings ?? [];
    log(`${this.name}: 試合の結果 ${st.map((x) => `${x.rank}位 ${s.room.seats[x.seat].name} ${x.score}`).join(' / ')}`);
    log(`${this.name}: モード ${s.room.config.mode} ルール ${s.room.config.rules.length}種 ${s.room.config.rules.join(',')}`);
    if (this.stats) log(`${this.name}: 出来事 ${Object.entries(this.stats).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
}

async function main() {
  let roomId = opt('room', null);
  if (roomId === null || roomId === true) {
    const r = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status !== 201) throw new Error(`ルームを作れない: ${r.status}`);
    roomId = (await r.json()).roomId;
  }
  console.log(`ルーム: ${BASE}/r/${roomId}`);
  const bots = [];
  for (let i = 0; i < COUNT; i++) {
    const b = new Bot(roomId, `ボット${i + 1}`);
    await b.connect();
    bots.push(b);
    await sleep(150);
  }
  const stop = () => {
    for (const b of bots) b.ws.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  while (!bots.every((b) => b.finished)) await sleep(500);
  await sleep(300);
  stop();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
