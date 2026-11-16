// 決まった場面を作る道具（でたらめな配りに頼らないため）。
// テスト用に種を固定したルーム（POST /api/rooms の seed）では、試合は engine の createMatch(config, seed) で作られ、
// CPU・代役・時間切れの操作も engine の auto で決まる。人間の席も決まった操作（detAction）だけをすれば、
// 1ゲーム目の流れは engine だけで前もって再現できる。ここで種を探し、その種のルームで通しのテストを行う。
// （交換のある2ゲーム目以降は、複数の待ちが同時にあり、処理の順が届く順で変わりうるので、1ゲーム目だけを使う。）

import { applyAction, awaiting, createMatch, viewFor } from '@chofugo/engine';

/** 7の組か。 */
export const isSevenGroup = (p) => p.play.shape === 'group' && p.play.rank === 7;

/**
 * 決まった操作（でたらめを使わない）。
 * 手番：preferSeven なら反則でない7の組 → パスできればパス → 反則でない最初の手 → 最初の手（反則の確認つき）。
 * 返し：返さない。7渡し・10捨て：手札の前から上限まで。交換：候補・手札の前から。特権の選択：何も選ばずに確定。
 */
export function detAction(mine, hand, { preferSeven = true } = {}) {
  switch (mine.kind) {
    case 'turn': {
      const seven = preferSeven ? mine.plays.find((p) => isSevenGroup(p) && !p.foul) : undefined;
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
 * seats[席] は 'cpu'（auto の cpu）か、関数 (mine, hand) => 操作 | 'timeout'（auto の timeout）。
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
      const a = who(v.mine, v.game?.hand ?? []);
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
