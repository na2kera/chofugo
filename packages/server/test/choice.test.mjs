// その2：7渡しの選択（choice の待ち）の時間切れ・CPU・代役、7渡しの中身の見え方、choose の不正な入力、
// 選択の途中の全員不在と復帰（design-2 §3.2、§3.5、§6.5、server-assumptions B4、decisions §18.1）。
// 場面はでたらめな配りに頼らない：種を固定したルーム（テスト用の機能）を作り、人間の席は決まった操作だけをする。
// 1ゲーム目の流れは engine だけで前もって再現できるので（scenario.mjs）、必要な出来事が起きる種を探してから試す。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createRoom, deadlineProblems, startServer, PORTS } from './helpers.mjs';
import { DetClient, detAction, findSeed, matchConfig } from './scenario.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.choice });
});
afterAll(async () => {
  await server?.stop();
});

/** 中の待ちの上限。テスト全体の上限（vitest.config の 180 秒）より十分短くし、待ちきれないときはどの待ちかが分かる形で落とす。 */
const WAIT = 30_000;
const RULES = ['give_on_7'];
const CONFIG = matchConfig(RULES);

const eventsOf = (cs) => cs.flatMap((c) => c.states.flatMap((s) => s.events));
/** 出来事を番号で1つずつに（復帰した接続には全件がもう一度届く）。 */
const uniq = (evs) => [...new Map(evs.map((e) => [e.seq, e])).values()].sort((a, b) => a.seq - b.seq);
/** 人間の席の決まった操作（simulateGame1 用）。hold なら choice は時間切れ。 */
const det = (hold) => (mine, hand) => (hold && mine.kind === 'choice' ? 'timeout' : detAction(mine, hand));
const gives = (evs) => evs.filter((e) => e.type === 'give').map((e) => ({ from: e.from, to: e.to, count: e.count ?? e.cards.length }));

async function seatedDet(roomId, name, opts = {}) {
  const c = new DetClient(server.base, roomId, { name, ...opts });
  await c.connect();
  c.hello();
  await c.waitState((s) => s.seat !== null, WAIT, `${name} seated`);
  return c;
}

async function startCustom(host) {
  host.send({ type: 'setConfig', mode: 'custom', rules: RULES, gameCount: null });
  await host.waitState((s) => s.room.config.rules.join() === RULES.join(), WAIT, 'config');
  host.send({ type: 'start' });
}

describe('7渡しの選択', () => {
  it('時間切れ（渡さない）・CPU の選択と、give の中身はふつうの配信でも全件の配信でも当事者だけ', async () => {
    // 1ゲーム目に「自分の選択」「CPU どうしの give」「自分への give」がすべて起きる種（席0 = 決まった操作・選択は時間切れ、席1〜3 = CPU）
    const seats = [det(true), 'cpu', 'cpu', 'cpu'];
    const { seed, events: sim } = findSeed(CONFIG, seats, (evs) => {
      const mineStart = evs.findIndex((e) => e.type === 'choiceStart' && e.seat === 0);
      const cpuGive = evs.findIndex((e) => e.type === 'give' && e.from !== 0 && e.to !== 0);
      const toMe = evs.findIndex((e) => e.type === 'give' && e.to === 0);
      return mineStart >= 0 && cpuGive >= 0 && toMe >= 0;
    });
    const timing = { cpuDelayMs: 20, choiceMs: 1000, turnMs: 20_000, exchangeMs: 20_000, respondMs: 20_000 };
    const roomId = await createRoom(server.base, timing, seed);
    let me = await seatedDet(roomId, 'me', { hold: true, autoHost: true });
    const all = [me];
    await startCustom(me);

    // (1) 自分の選択：choice の期限が付き（choiceMs 以内）、過ぎたら時間切れで choiceSkip（渡さない）に進む
    const dl = await me.waitFor(
      () => me.states.map((s) => ({ s, d: s.deadlines.find((d) => d.kind === 'choice' && d.seat === 0) })).find((x) => x.d !== undefined),
      WAIT,
      'my choice await',
    );
    expect(dl.d.at).toBeTypeOf('number');
    expect(dl.d.at - dl.s.serverTime).toBeLessThanOrEqual(timing.choiceMs);
    expect(dl.s.view.mine).toMatchObject({ kind: 'choice', rule: 'give_on_7', awaitId: dl.d.awaitId });
    expect(dl.s.view.game.choice).toMatchObject({ rule: 'give_on_7', seat: 0 });
    expect([1, 2, 3]).toContain(dl.s.view.game.choice.to);
    const skipState = await me.waitFor(() => me.states.find((s) => s.events.some((e) => e.type === 'choiceSkip' && e.seat === 0)), WAIT, 'timeout skip');
    // 時間切れの処理は期限の後（順序で確かめる。機械の重さで期限の後ろが延びても落ちない）
    expect(skipState.serverTime).toBeGreaterThanOrEqual(dl.d.at);
    // 時間切れの自動の操作で進んだ state には、受理の印（acceptedReqId）は付かない（G9）
    expect(skipState.acceptedReqId).toBe(undefined);
    expect(eventsOf(all).some((e) => e.type === 'give' && e.from === 0)).toBe(false);

    // (2) CPU の選択：いちばん弱いカードから上限まで渡す。CPU どうしの give は、自分には枚数だけ
    const cpuGive = await me.waitFor(() => eventsOf(all).find((e) => e.type === 'give' && e.from !== 0 && e.to !== 0), WAIT, 'cpu give');
    const start = eventsOf(all).filter((e) => e.type === 'choiceStart' && e.seat === cpuGive.from && e.seq < cpuGive.seq).at(-1);
    expect(start).toMatchObject({ rule: 'give_on_7', to: cpuGive.to });
    expect(cpuGive.count).toBeGreaterThan(0);
    expect(cpuGive.count).toBeLessThanOrEqual(start.max);
    expect(cpuGive.cards).toBe(null);

    // (3) 自分が受け取る give は中身が見える
    const toMe = await me.waitFor(() => eventsOf(all).find((e) => e.type === 'give' && e.to === 0), WAIT, 'give to me');
    expect(toMe.cards.length).toBe(toMe.count);

    // (4) 復帰したときの全件の配信：同じゲームの中で2つの give が起きたら止め、同じ本人確認の値でつなぎ直す
    let target = null;
    me.pauseWhen = () => {
      const evs = eventsOf(all).filter((e) => e.gameNo === 1 && e.type === 'give');
      const a = evs.find((e) => e.from !== 0 && e.to !== 0);
      const b = evs.find((e) => e.to === 0);
      if (a && b) target = { gameNo: 1, a, b };
      return target !== null;
    };
    me.checkPause();
    await me.waitFor(() => (me.paused ? true : undefined), WAIT, 'gives in one game');
    // 種を固定したので、ここまでの give は engine だけで再現した流れと同じ
    const seen = gives(uniq(eventsOf(all)).filter((e) => e.gameNo === 1));
    expect(seen).toEqual(gives(sim).slice(0, seen.length));
    const me2 = new DetClient(server.base, roomId, { name: 'me', token: me.token, hold: true, autoHost: true });
    me2.paused = true;
    await me2.connect();
    me2.hello();
    const full = await me2.waitState((s) => s.seat === 0 && s.eventsFull, WAIT, 'rejoined');
    expect(full.view.gameNo).toBe(target.gameNo);
    const fa = full.events.find((e) => e.seq === target.a.seq);
    const fb = full.events.find((e) => e.seq === target.b.seq);
    expect(fa).toMatchObject({ type: 'give', from: target.a.from, to: target.a.to, count: target.a.count, cards: null });
    expect(fb).toMatchObject({ type: 'give', to: 0, count: target.b.count, cards: target.b.cards });
    // 全件の配信の中のどの give も、当事者でなければ中身がない
    for (const e of full.events) if (e.type === 'give') expect(e.cards === null).toBe(e.from !== 0 && e.to !== 0);
    me.close();
    all.push(me2);
    me = me2;
    me.resume();

    // 試合を終える（ゲームの結果の画面で）
    me.noNext = true;
    await me.waitState((s) => s.matchPhase === 'gameResult', 60_000, 'gameResult');
    expect(gives(uniq(eventsOf(all)).filter((e) => e.gameNo === 1))).toEqual(gives(sim));
    me.send({ type: 'endMatch' });
    await me.waitState((s) => s.matchPhase === 'matchResult', WAIT, 'matchResult');
    expect(all.flatMap((c) => c.rejectedOwn)).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    me.close();
  });

  it('代役（切断して猶予がたった人）の選択は CPU と同じく約1秒で選ぶ', async () => {
    // 席1（切断して代役になる人。CPU と同じ方針で操作される）が1ゲーム目に7を出して渡す種
    const seats = [det(false), 'cpu', 'cpu', 'cpu'];
    const { seed } = findSeed(CONFIG, seats, (evs) => evs.some((e) => e.type === 'give' && e.from === 1));
    const timing = { cpuDelayMs: 20, disconnectGraceMs: 300, choiceMs: 20_000, turnMs: 20_000, exchangeMs: 20_000, respondMs: 20_000 };
    const roomId = await createRoom(server.base, timing, seed);
    const A = await seatedDet(roomId, 'A', { autoHost: true });
    const B = new Client(server.base, roomId, { name: 'B' });
    await B.connect();
    B.hello();
    await B.waitState((s) => s.seat === 1, WAIT, 'B seated');
    await startCustom(A);
    await A.waitState((s) => s.matchPhase !== null, WAIT, 'started');
    B.close();
    await A.waitState((s) => s.room.seats[1].away === true, WAIT, 'B away');
    // B の席の choice の待ちの期限は cpuDelayMs、CPU の方針で上限まで渡す
    const found = await A.waitFor(
      () => A.states.map((s) => ({ s, d: s.deadlines.find((d) => d.kind === 'choice' && d.seat === 1) })).find((x) => x.d !== undefined),
      WAIT,
      'substitute choice',
    );
    expect(found.s.room.seats[1].away).toBe(true);
    expect(found.d.at - found.s.serverTime).toBeLessThanOrEqual(timing.cpuDelayMs);
    const after = await A.waitFor(
      () => eventsOf([A]).find((e) => (e.type === 'give' || e.type === 'choiceSkip') && (e.from === 1 || e.seat === 1) && e.gameNo === found.s.view.gameNo),
      WAIT,
      'substitute chose',
    );
    expect(after.type).toBe('give');
    expect(after.from).toBe(1);
    expect(A.rejectedOwn).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    A.close();
  });
});

describe('choose の不正な入力と、選択の途中の全員不在（WebSocket 経由）', () => {
  it('他人の席の待ち・古い番号・手札にないカード・上限を超えた枚数を拒否し、状態は変わらない。全員不在から戻ると期限は続きから', async () => {
    // 席0が1ゲーム目の最初の親で、最初の手が7の組（すぐに自分の choice の待ちになる）種
    const seats = [det(true), 'cpu', 'cpu', 'cpu'];
    const { seed } = findSeed(CONFIG, seats, (evs) => {
      const first = evs.find((e) => e.type === 'play');
      const start = evs.find((e) => e.type === 'choiceStart');
      return first !== undefined && first.seat === 0 && first.play.rank === 7 && start !== undefined && start.seat === 0 && start.seq > first.seq;
    });
    const choiceMs = 30_000;
    const timing = { cpuDelayMs: 20, disconnectGraceMs: 120_000, choiceMs, turnMs: 30_000, exchangeMs: 30_000, respondMs: 30_000 };
    const roomId = await createRoom(server.base, timing, seed);
    const A = await seatedDet(roomId, 'A', { hold: true });
    const B = new Client(server.base, roomId, { name: 'B' });
    await B.connect();
    B.hello();
    await B.waitState((s) => s.seat === 1, WAIT, 'B seated');
    await startCustom(A);
    const sel = await A.waitState((s) => s.view?.mine?.kind === 'choice', WAIT, 'my choice');
    const mine = sel.view.mine;
    const hand = sel.view.game.hand;
    const turnPlay = eventsOf([A]).find((e) => e.type === 'play' && e.seat === 0);
    expect(turnPlay.play.rank).toBe(7);
    expect(mine.max).toBe(turnPlay.play.cards.length);
    expect(hand.length).toBeGreaterThan(mine.max);
    const version = sel.version;
    const statesBefore = A.states.length;

    const rejected = async (c, action) => {
      const err = await c.waitError(c.send({ type: 'action', action }), WAIT);
      expect(err.code).toBe('actionRejected');
      return err.engineError;
    };
    // 他人の席の待ち（席1が席0の待ちに choose を送る）
    expect(await rejected(B, { type: 'choose', awaitId: mine.awaitId, cards: [] })).toBe('notYourAwait');
    // 古い番号（7を出した手番の待ち）
    const oldId = A.states.map((s) => s.view?.mine).find((m) => m?.kind === 'turn').awaitId;
    expect(oldId).not.toBe(mine.awaitId);
    expect(await rejected(A, { type: 'choose', awaitId: oldId, cards: [] })).toBe('staleAwait');
    // 手札にないカード（いま出した7）
    expect(await rejected(A, { type: 'choose', awaitId: mine.awaitId, cards: [turnPlay.play.cards[0]] })).toBe('cardNotInHand');
    // 上限を超えた枚数
    expect(await rejected(A, { type: 'choose', awaitId: mine.awaitId, cards: hand.slice(0, mine.max + 1) })).toBe('invalidChoice');
    // 拒否では state が送られず、待ちも版番号も同じ（もう一度 hello せずに確かめられるよう、B の接続で確かめる）
    expect(A.states.length).toBe(statesBefore);
    expect(B.state.version).toBe(version);
    expect(B.state.view.awaiting).toEqual(sel.view.awaiting);
    expect(A.states.some((s) => s.acceptedReqId !== undefined && s.version > version)).toBe(false);

    // 全員不在：A・B とも切断 → 一時停止。猶予は長いので、A は代役にならない
    const dBefore = B.state.deadlines.find((d) => d.awaitId === mine.awaitId);
    // 切断の前に1秒置き、選択が始まってからの経過を client の時計で測る（同じ機械なので、サーバーの経過はこれより短くならない）
    await new Promise((r) => setTimeout(r, 1000));
    const elapsed = Date.now() - sel.receivedAt;
    A.close();
    B.close();
    await Promise.all([A.waitClosed(), B.waitClosed()]);
    await new Promise((r) => setTimeout(r, 600));
    // B だけ戻る：A（猶予の間の人間）の choice の期限は、止めた時点の残りから再開する（server-assumptions B4）
    const B2 = new Client(server.base, roomId, { name: 'B', token: B.token });
    await B2.connect();
    B2.hello();
    const back = await B2.waitState((s) => s.seat === 1 && !s.room.paused, WAIT, 'B back');
    expect(back.room.seats[0]).toMatchObject({ connected: false, away: false });
    expect(back.view.awaiting).toEqual(sel.view.awaiting);
    const dBack = back.deadlines.find((d) => d.awaitId === mine.awaitId);
    expect(dBack.at).toBeTypeOf('number');
    // 期限は止めていた分だけ後ろへずれ（全員不在の間は数えない）、残りは「秒数 − 止めるまでの経過」以下（秒数いっぱいに戻さない）
    expect(dBack.at).toBeGreaterThan(dBefore.at);
    expect(dBack.at - back.serverTime).toBeLessThanOrEqual(choiceMs - elapsed);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    // A も戻る：A は代役になっていない（猶予の中の復帰）ので、期限は変えない（decisions §18.1。残りは rejoinMinMs の10秒より長い）
    const A2 = new DetClient(server.base, roomId, { name: 'A', token: A.token, hold: true });
    await A2.connect();
    A2.hello();
    const aBack = await A2.waitState((s) => s.seat === 0 && s.eventsFull, WAIT, 'A back');
    const dA = aBack.deadlines.find((d) => d.awaitId === mine.awaitId);
    expect(dA.at - aBack.serverTime).toBeGreaterThan(10_000);
    expect(dA.at).toBe(dBack.at);
    expect(aBack.view.mine).toMatchObject({ kind: 'choice', awaitId: mine.awaitId });

    // 正しい choose は受け付ける。受け付けた state にだけ、その reqId が付く（acceptedReqId、G9）
    const cards = aBack.view.game.hand.slice(0, mine.max);
    const okId = A2.send({ type: 'action', action: { type: 'choose', awaitId: mine.awaitId, cards } });
    const acc = await A2.waitState((s) => s.acceptedReqId === okId, WAIT, 'accepted');
    expect(acc.events.some((e) => e.type === 'give' && e.from === 0 && e.cards.join() === cards.join())).toBe(true);
    const seenByB = await B2.waitFor(() => B2.states.find((s) => s.events.some((e) => e.type === 'give' && e.from === 0)), WAIT, 'B sees give');
    expect(seenByB.acceptedReqId).toBe(undefined);
    expect(A2.errors.filter((e) => e.reqId === okId)).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    A2.close();
    B2.close();
  });
});
