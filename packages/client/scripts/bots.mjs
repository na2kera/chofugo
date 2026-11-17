#!/usr/bin/env node
// 開発用：開発サーバーに WebSocket でつないで、席を自動で埋めて操作する（design-client §6、§7.12）。
// 出せる手からでたらめに選ぶ（反則上がりの手も時々選ぶ）。Node 22 以上（グローバルの WebSocket を使う）。
//
//   node scripts/bots.mjs [--base http://localhost:5173] [--room <ルームID>] [--count 3]
//                         [--delay 400] [--games 5|10|0] [--start-when 4] [--rematch] [--quiet]
//                         [--mode daifugo|custom|chofugo] [--rules all|<ID,ID,...>] [--passive]
//
//   --room がなければルームを作って URL を表示する。
//   ボットがホストになったら、人が --start-when 人（初期値 4）そろった時点で試合を始め（残りの空席は CPU になる）、
//   ゲームの結果では次のゲームを配る。試合の結果に着いたら終わる（--rematch ならもう一度）。
//   --mode / --rules はボットがホストのときに設定する（--rules all はそのモードで選べるルールすべて）。
//   設定はサーバーが直す（モードで選べないルール・前提のないルールは外れる）。指定がなければルームの設定のまま。
//   --rules の ID は送る前に確かめる（知らない ID・重複・値なしはエラーで終わる）。設定を送ったら、届いた設定
//   （mode・gameCount が頼んだとおりで、rules が頼んだものの中だけ。超富豪は24種）を確かめてから start を送る。
//   設定が拒否されたら（error）、エラーで終わる。終わるときに、各ボットの拒否の件数を出す。
//   7渡し・10捨て・銀河鉄道の選択（choice）では、手札からでたらめに 0〜上限枚を選ぶ。
//   闇市（第2段階）では3分の1で使わず、使うときはでたらめな相手と、ちょうど min(上限, 相手の手札) 枚を選ぶ。
//   Q ボンバー（第2段階）では、0〜上限個の別々の数字（3〜15 とジョーカー）をでたらめに宣言する（cards は空）。
//   --rules all はカスタムで24種すべて（大富豪では定番8種）。
//   超富豪モード（--mode chofugo。ルールは24種で固定）：特権の選択では 0〜枠の数をでたらめに選んで確定し、
//   手番では時々（3割）使える特権をでたらめな相手・カード・数字で使い、スキップを付けられる手には時々付ける。
//   --passive：親でないときは必ずパスし、特権も使わない（選択では何も選ばずに確定する）。親のときは出せる手からでたらめに1手。
//   返しの一周はスキップ、7渡し・10捨て・銀河鉄道・闇市・Q ボンバーは選ばない。ブラウザの席（や CPU）を1位にして、特権の画面を確かめるため。

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
const PASSIVE = opt('passive', false) === true;

// engine の ALL_RULE_IDS と DAIFUGO_MODE_RULE_IDS（このスクリプトは engine を読み込まないので写しを持つ）
const ALL_RULES = [
  'flush_on_8', 'block_flush_with_4', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'sequence_lock', 'runs',
  'forbidden_finish', 'dethrone', 'diamond3_start', 'triple3_trump', 'give_on_7', 'reverse_order_on_9', 'discard_on_10', 'skip_on_k',
  // 第2段階（design-4 §1 の並び）
  'color_lock_on_5', 'cancel_reverse_on_6', 'triple6_revolution', 'triple4_purge', 'triple9_salvage', 'triple_a_trade', 'call_discard_on_q', 'quad2_instant_win',
];
// 選択の種類（engine の RULE_MODULES の choiceKind の写し）。ここにないルールは手札から 0〜上限枚（7渡し・10捨て・銀河鉄道）
const TRADE_RULE = 'triple_a_trade';
const CALL_RULE = 'call_discard_on_q';
// Q ボンバーで宣言できるもの（3〜15 とジョーカー）
const CALL_RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 'joker'];
const DAIFUGO_RULES = ['flush_on_8', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'runs', 'forbidden_finish', 'dethrone'];
if (MODE !== null && MODE !== 'daifugo' && MODE !== 'custom' && MODE !== 'chofugo') fail('--mode は daifugo・custom・chofugo のどれか');
// --rules はルームを作る前に確かめる（誤った ID で設定が拒否され、もとの設定のまま試合が始まるのを防ぐ）
if (RULES === true) fail('--rules には all か、ルール ID をカンマで区切って渡す');
if (typeof RULES === 'string' && RULES !== 'all') {
  const ids = RULES.split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = ids.filter((x) => !ALL_RULES.includes(x));
  if (ids.length === 0) fail('--rules にルール ID がない');
  if (unknown.length > 0) fail(`--rules に知らないルール ID がある: ${unknown.join(',')}`);
  if (new Set(ids).size !== ids.length) fail('--rules に同じ ID が2回ある');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
// engine の ALL_ABILITY_IDS（その3）
const ALL_ABILITIES = ['peek', 'steal', 'forceFlush', 'ban', 'revolution', 'skip'];

/**
 * 届いた設定が、送った設定（want）の結果として正しいか。mode と gameCount は頼んだとおり、
 * rules はサーバーが直すので「頼んだものの中だけ」（超富豪は24種すべて）を確かめる。
 */
function configMatches(cfg, want) {
  if (cfg.mode !== want.mode || cfg.gameCount !== want.gameCount) return false;
  if (want.mode === 'chofugo') return cfg.rules.length === ALL_RULES.length;
  return cfg.rules.every((r) => want.rules.includes(r));
}

/** 設定の返事を待つ時間。内容が変わらない設定には state が返らないので、そのときは届いている設定で確かめる。 */
const CONFIG_WAIT_MS = 3000;

/** ホストのときに送る設定（指定がなければいまの設定）。 */
function wantedConfig(cur, gameCount) {
  const mode = MODE ?? cur.mode;
  let rules = cur.rules;
  if (RULES === 'all') rules = mode === 'daifugo' ? DAIFUGO_RULES : ALL_RULES;
  else if (typeof RULES === 'string') rules = RULES.split(',').map((x) => x.trim()).filter(Boolean);
  // 超富豪モードはサーバーが24種に直す（送ったルールは使われない）
  if (mode === 'chofugo') rules = ALL_RULES;
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

/** 受け身（--passive）：親でないときは必ずパス。特権は使わない。親のときは出せる手からでたらめに1手。 */
function passiveAction(mine, hand, game) {
  switch (mine.kind) {
    case 'turn': {
      if (mine.canPass) return { type: 'pass', awaitId: mine.awaitId };
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
      return chooseAction(mine, hand, game);
  }
}

/** 特権の選択：0〜枠の数をでたらめに選んで確定する。 */
function chooseAbilities(mine) {
  const pool = ALL_ABILITIES.slice();
  const n = Math.floor(Math.random() * (mine.slots + 1));
  const abilities = [];
  while (abilities.length < n) abilities.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return { type: 'selectAbilities', awaitId: mine.awaitId, abilities, confirm: true };
}

/** 使える特権からでたらめに1つ（相手・カード・数字もでたらめ）。なければ null。 */
function chooseAbilityUse(mine) {
  const usable = (mine.abilities ?? []).filter((x) => x.usable);
  if (usable.length === 0) return null;
  const u = pick(usable);
  const a = { type: 'useAbility', awaitId: mine.awaitId, ability: u.id };
  if (u.targets) a.target = pick(u.targets);
  if (u.cards) a.card = pick(u.cards);
  if (u.ranks) a.rank = pick(u.ranks);
  return a;
}

/** 手札からでたらめに n 枚。 */
function sampleCards(hand, n) {
  const pool = hand.slice();
  const cards = [];
  while (cards.length < n && pool.length > 0) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return cards;
}

/** 出せる手からでたらめに選ぶ。親は出せる手があればパスできない（server/test/helpers.mjs と同じ考え方）。 */
function chooseAction(mine, hand, game) {
  if (mine.kind === 'abilitySelect') return chooseAbilities(mine);
  if (mine.kind === 'choice' && mine.rule === TRADE_RULE) {
    // 闇市：3分の1で使わない。使うときは相手と、ちょうど min(上限, 相手の手札) 枚（decisions §19.3）
    const targets = mine.targets ?? [];
    if (targets.length === 0 || Math.random() < 1 / 3) return { type: 'choose', awaitId: mine.awaitId, cards: [] };
    const target = pick(targets);
    const n = Math.min(mine.max, game?.handCounts?.[target] ?? 0, hand.length);
    if (n <= 0) return { type: 'choose', awaitId: mine.awaitId, cards: [] };
    return { type: 'choose', awaitId: mine.awaitId, cards: sampleCards(hand, n), target };
  }
  if (mine.kind === 'choice' && mine.rule === CALL_RULE) {
    // Q ボンバー：0〜max 個の別々の数字（cards は空。0個なら ranks を付けない＝宣言しない）
    const n = Math.floor(Math.random() * (Math.min(mine.max, CALL_RANKS.length) + 1));
    const pool = CALL_RANKS.slice();
    const ranks = [];
    while (ranks.length < n) ranks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return n === 0 ? { type: 'choose', awaitId: mine.awaitId, cards: [] } : { type: 'choose', awaitId: mine.awaitId, cards: [], ranks };
  }
  if (mine.kind === 'choice') {
    // 7渡し・10捨て・銀河鉄道：手札からでたらめに 0〜max 枚
    const pool = hand.slice();
    const n = Math.floor(Math.random() * (Math.min(mine.max, pool.length) + 1));
    const cards = [];
    while (cards.length < n) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return { type: 'choose', awaitId: mine.awaitId, cards };
  }
  if (mine.kind === 'turn') {
    if (Math.random() < 0.3) {
      const use = chooseAbilityUse(mine);
      if (use !== null) return use;
    }
    const plays = mine.plays;
    if (mine.canPass && (plays.length === 0 || Math.random() < 0.3)) return { type: 'pass', awaitId: mine.awaitId };
    const nonFoul = plays.filter((p) => !p.foul);
    const p = nonFoul.length > 0 && Math.random() < 0.9 ? pick(nonFoul) : pick(plays);
    const a = { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape };
    if (p.foul) a.confirmFoul = true;
    if (p.canSkip && Math.random() < 0.5) a.withSkip = true;
    return a;
  }
  if (mine.kind === 'respond') {
    if (mine.plays.length > 0 && Math.random() < 0.7) return { type: 'respond', awaitId: mine.awaitId, cards: pick(mine.plays).cards };
    return { type: 'respond', awaitId: mine.awaitId, cards: null };
  }
  if (mine.kind !== 'exchangeGive') throw new Error(`知らない待ちの種類: ${mine.kind}`);
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
    /** 拒否された送信（error）。 */
    this.rejects = [];
    /** 返事を待っている設定 { reqId, want, resolve, reject }。 */
    this.cfgWait = null;
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
        else if (msg.type === 'error') this.onError(msg);
      };
    });
  }

  send(obj) {
    this.reqId += 1;
    this.ws.send(JSON.stringify({ ...obj, reqId: this.reqId }));
    return this.reqId;
  }

  onError(msg) {
    this.rejects.push(msg);
    // 拒否は数えて最後に出す（ボットの試合は拒否0件が正しい）
    console.log(`${this.name}: 拒否 ${msg.code} ${msg.engineError ?? ''} ${msg.message}`);
    if (this.cfgWait !== null && msg.reqId === this.cfgWait.reqId) {
      const w = this.cfgWait;
      this.cfgWait = null;
      w.reject(new Error(`設定が拒否された: ${msg.code} ${msg.message}`));
    }
  }

  /** 設定を送り、届いた設定を確かめる。拒否されたら例外。 */
  setConfig(want) {
    return new Promise((resolve, reject) => {
      const reqId = this.send(want);
      const timer = setTimeout(() => {
        // 内容の変わらない設定には state が返らない：届いている設定で確かめる
        if (this.cfgWait === null || this.cfgWait.reqId !== reqId) return;
        this.cfgWait = null;
        const cur = this.state?.room.config;
        if (cur && configMatches(cur, want)) resolve(cur);
        else reject(new Error(`設定が届かない（いまの設定: ${JSON.stringify(cur)}）`));
      }, CONFIG_WAIT_MS);
      this.cfgWait = {
        reqId,
        want,
        resolve: (cfg) => {
          clearTimeout(timer);
          resolve(cfg);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
    });
  }

  /** 設定を確かめてから試合を始める（ボットがホストのとき）。 */
  async configureAndStart(s) {
    const gameCount = GAMES === '0' ? null : Number(GAMES);
    const want = wantedConfig(s.room.config, gameCount);
    try {
      const cfg = await this.setConfig(want);
      log(`${this.name}: 設定 ${cfg.mode} ${cfg.rules.length}種 ゲーム数 ${cfg.gameCount ?? '無制限'}`);
    } catch (e) {
      fail(e.message);
    }
    this.send({ type: 'start' });
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
    if (this.cfgWait !== null && configMatches(s.room.config, this.cfgWait.want)) this.cfgWait.resolve(s.room.config);
    if (s.seat === null) return;
    // その2以降の出来事を数える（ルールが実際に起きたかの目安）。第2段階の出来事と、rule 付きの革命・J バックの解除も数える
    if (!s.eventsFull) {
      this.stats ??= {};
      for (const e of s.events) {
        const k =
          e.type === 'fieldCleared'
            ? `fieldCleared:${e.reason}`
            : e.type === 'respond' && e.toDiscard
              ? 'respond:4止め'
              : e.type === 'ability'
                ? `ability:${e.ability}`
                : (e.type === 'revolution' || e.type === 'tempReverse') && e.rule
                  ? `${e.type}:${e.rule}`
                  : e.type;
        if (
          [
            'seqLock', 'orderReverse', 'choiceStart', 'give', 'discard', 'choiceSkip', 'skipped', 'respond:4止め', 'fieldCleared:triple3_trump', 'respond', 'abilitySelectStart', 'abilitiesChosen',
            // 第2段階（design-4 §4.5）
            'colorLock', 'tempReverse:cancel_reverse_on_6', 'revolution:triple6_revolution', 'purge', 'salvage', 'trade', 'callDiscard', 'instantWin', 'fieldCleared:quad2_instant_win',
          ].includes(k) ||
          k.startsWith('ability:')
        )
          this.stats[k] = (this.stats[k] ?? 0) + 1;
        // その3：誰が特権を選び・使ったか（CPU の大富豪の確認用。ホストのボットだけが表示する）
        if (s.isHost && (e.type === 'abilitiesChosen' || e.type === 'ability')) log(`${this.name}: 第${e.gameNo}ゲーム ${s.room.seats[e.seat].name} ${e.type === 'ability' ? `特権 ${e.ability}` : `特権を${e.count}個 選んだ`}`);
      }
    }
    if (s.matchPhase !== prevPhase) log(`${this.name}: ${s.matchPhase ?? 'lobby'}${s.view ? ` 第${s.view.gameNo}ゲーム` : ''}`);
    const mine = s.view?.mine;
    if (mine) {
      const decide = PASSIVE ? passiveAction : chooseAction;
      this.once(`${s.matchId}:a${mine.awaitId}`, () => this.send({ type: 'action', matchId: s.matchId, action: decide(mine, s.view.game?.hand ?? [], s.view.game ?? null) }));
    }
    if (!s.isHost) {
      if (s.matchPhase === 'matchResult' && !REMATCH) this.finish(s);
      return;
    }
    if (s.matchPhase === null) {
      const humans = s.room.seats.filter((x) => x.kind === 'human').length;
      if (humans >= START_WHEN) {
        // 設定が届いたことを確かめてから開始を送る（設定が拒否されたら始めずに終わる）
        this.once(`start`, () => void this.configureAndStart(s), DELAY);
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
  const rejects = bots.reduce((n, b) => n + b.rejects.length, 0);
  console.log(`拒否 ${rejects}件（${bots.map((b) => `${b.name} ${b.rejects.length}`).join(' / ')}）`);
  stop();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
