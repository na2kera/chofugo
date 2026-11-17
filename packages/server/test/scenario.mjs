// 決まった場面を作る道具（でたらめな配りに頼らないため）。
// テスト用に種を固定したルーム（POST /api/rooms の seed）では、試合は engine の createMatch(config, seed) で作られ、
// CPU・代役・時間切れの操作も engine の auto で決まる。人間の席も決まった操作（detAction）だけをすれば、
// 1ゲーム目の流れは engine だけで前もって再現できる。ここで種を探し、その種のルームで通しのテストを行う。
// （交換のある2ゲーム目以降は、複数の待ちが同時にあり、処理の順が届く順で変わりうるので、1ゲーム目だけを使う。）

import { applyAction, awaiting, createMatch, viewFor } from '@chofugo/engine';
import { CALL_RANKS, Client } from './helpers.mjs';

/** 7の組か。 */
export const isSevenGroup = (p) => p.play.shape === 'group' && p.play.rank === 7;

/** ジョーカーを含まない、数字 rank のちょうど count 枚の組か（第2段階の役。design-4 §2.2 の isRealGroup と同じ条件）。 */
export const isRealGroup = (rank, count) => (p) =>
  p.play.shape === 'group' && p.play.rank === rank && p.cards.length === count && p.cards.every((c) => !c.startsWith('joker'));

/**
 * 決まった操作（でたらめを使わない）。
 * 手番：prefer（出せる手の判定。省略時は preferSeven なら7の組）に当たる反則でない手 → パスできればパス →
 * 反則でない最初の手 → 最初の手（反則の確認つき）。
 * 返し：返さない。交換：候補・手札の前から。特権の選択：何も選ばずに確定。
 * 選択（choice）は種類ごと（design-4 §6.5）：7渡し・10捨て・銀河鉄道は手札の前から上限まで。
 * 闇市は targets の最初の相手と、手札の前から min(上限, 自分の枚数, 相手の枚数) 枚（相手の枚数は game.handCounts）。
 * Q ボンバーは CALL_RANKS（helpers.mjs）の前から上限の個数まで宣言する（cards は空）。
 */
export function detAction(mine, hand, { preferSeven = true, prefer, game } = {}) {
  switch (mine.kind) {
    case 'turn': {
      const want = prefer ?? (preferSeven ? isSevenGroup : null);
      const seven = want ? mine.plays.find((p) => want(p) && !p.foul) : undefined;
      if (seven) return { type: 'play', awaitId: mine.awaitId, cards: seven.cards, shape: seven.shape };
      if (mine.canPass) return { type: 'pass', awaitId: mine.awaitId };
      const p = mine.plays.find((x) => !x.foul) ?? mine.plays[0];
      const a = { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape };
      if (p.foul) a.confirmFoul = true;
      return a;
    }
    case 'respond':
      return { type: 'respond', awaitId: mine.awaitId, cards: null };
    case 'choice':
      if (mine.rule === 'triple_a_trade') {
        const target = mine.targets[0];
        const theirs = game?.handCounts?.[target];
        if (theirs === undefined) throw new Error('detAction: the trade needs game.handCounts');
        return { type: 'choose', awaitId: mine.awaitId, cards: hand.slice(0, Math.min(mine.max, hand.length, theirs)), target };
      }
      if (mine.rule === 'call_discard_on_q') return { type: 'choose', awaitId: mine.awaitId, cards: [], ranks: CALL_RANKS.slice(0, mine.max) };
      return { type: 'choose', awaitId: mine.awaitId, cards: hand.slice(0, mine.max) };
    case 'abilitySelect':
      return { type: 'selectAbilities', awaitId: mine.awaitId, abilities: [], confirm: true };
    case 'exchangeGive':
      if (mine.role === 'lower') {
        const rest = mine.candidates.filter((c) => !mine.forced.includes(c));
        return { type: 'exchangeGive', awaitId: mine.awaitId, cards: [...mine.forced, ...rest.slice(0, mine.choose)] };
      }
      return { type: 'exchangeGive', awaitId: mine.awaitId, cards: hand.slice(0, mine.count) };
    default:
      throw new Error(`unknown await kind ${mine.kind}`);
  }
}

/**
 * 1ゲーム目を engine だけで進め、出来事（engine の GameEvent。中身つき）を返す。
 * seats[席] は 'cpu'（auto の cpu）か、関数 (mine, hand, game) => 操作 | 'timeout'（auto の timeout。game は GameView）。
 * サーバーでは CPU・代役の席は 'cpu'、人間が操作せずに時間切れになる待ちは 'timeout' で処理される。
 */
export function simulateGame1(config, seed, seats, maxSteps = 2000) {
  const created = createMatch(config, seed);
  if (!created.ok) throw new Error(`createMatch: ${created.error.code}`);
  let state = created.state;
  const events = [...created.events];
  for (let i = 0; i < maxSteps; i++) {
    if (state.gameNo !== 1 || state.phase !== 'play') break;
    const w = awaiting(state).sort((a, b) => a.id - b.id)[0];
    if (w === undefined) break;
    const who = seats[w.seat];
    let action;
    if (who === 'cpu') action = { type: 'auto', awaitId: w.id, policy: 'cpu' };
    else {
      const v = viewFor(state, w.seat);
      const a = who(v.mine, v.game?.hand ?? [], v.game);
      action = a === 'timeout' ? { type: 'auto', awaitId: w.id, policy: 'timeout' } : { ...a, seat: w.seat };
    }
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(`simulate: ${r.error.code} ${JSON.stringify(action)}`);
    state = r.state;
    events.push(...r.events);
  }
  return { events: events.filter((e) => e.gameNo === 1), state };
}

/** 条件を満たす最初の種を探す（[n, 7, 11, 13]、n = 1, 2, ...）。見つからなければ例外。 */
export function findSeed(config, seats, pred, limit = 3000) {
  for (let n = 1; n <= limit; n++) {
    const seed = [n, 7, 11, 13];
    const { events, state } = simulateGame1(config, seed, seats);
    if (pred(events, state)) return { seed, events };
  }
  throw new Error('no seed found');
}

/** サーバーの開始と同じ形の試合の設定（state.ts の buildMatchConfig）。matchId は流れに関係しない。 */
export const matchConfig = (rules, gameCount = null, abilities = false) => ({ matchId: 'sim', rules, gameCount, abilities });

/**
 * 決まった操作だけをする席（detAction、または policy）。通しのテストで、simulateGame1 と同じ操作を WebSocket で送る。
 * policy(mine, hand, game) は操作か 'hold'（何もしない。時間切れにする）を返す。省略時は detAction（hold: true なら choice は 'hold'）。
 * paused の間は何もしない（つなぎ直しの確認のため）。
 */
export class DetClient extends Client {
  constructor(base, roomId, opts) {
    super(base, roomId, opts);
    this.hold = opts.hold ?? false;
    this.policy = opts.policy ?? null;
    this.paused = false;
    /** ゲームの結果の画面で次のゲームを配らない（試合を終えるため）。 */
    this.noNext = false;
    /** 真を返したら、その state で操作する前に止まる。 */
    this.pauseWhen = null;
    this.auto = true;
  }

  checkPause() {
    if (!this.paused && this.pauseWhen?.()) {
      this.paused = true;
      this.pauseWhen = null;
    }
    return this.paused;
  }

  decide(mine) {
    const g = this.state.view.game;
    if (this.policy !== null) return this.policy(mine, g?.hand ?? [], g);
    if (mine.kind === 'choice' && this.hold) return 'hold';
    return detAction(mine, g?.hand ?? [], { game: g });
  }

  maybeAct() {
    if (this.checkPause()) return;
    const mine = this.state?.view?.mine;
    if (!mine || this.acted.has(this.actKey(mine))) return;
    const action = this.decide(mine);
    if (action === 'hold') return;
    this.acted.add(this.actKey(mine));
    const id = this.send({ type: 'action', action });
    (this.autoReqs ??= new Set()).add(id);
  }

  maybeNextGame() {
    if (!this.checkPause() && !this.noNext) super.maybeNextGame();
  }

  resume() {
    this.paused = false;
    this.maybeAct();
    if (this.autoHost && this.state) this.maybeNextGame();
  }
}
