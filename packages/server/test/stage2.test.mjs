// 第2段階（特殊ルール8種）：choose の target・ranks の形の検査と、engine への引き渡し（design-4 §3、§6.1）。
// 新しい選択の待ち3種（銀河鉄道・闇市・Q ボンバー）の期限・時間切れ・CPU・二重送信、闇市の中身の見え方（design-4 §6.6）。
// 場面は choice.test.mjs と同じく、種を固定したルーム（テスト用の機能）と scenario.mjs で作る。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CALL_RANKS, Client, createRoom, deadlineProblems, startServer, PORTS } from './helpers.mjs';
import { DetClient, detAction, findSeed, isRealGroup, matchConfig } from './scenario.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.stage2 });
});
afterAll(async () => {
  await server?.stop();
});

const WAIT = 30_000;
const eventsOf = (cs) => cs.flatMap((c) => c.states.flatMap((s) => s.events));

/** 新しい選択の3種。prefer = 席0が優先して出す手（そのルールが発動する手）、result = 選んだときの出来事。 */
const KINDS = {
  salvage: { rule: 'triple9_salvage', prefer: isRealGroup(9, 3), result: 'salvage' },
  trade: { rule: 'triple_a_trade', prefer: isRealGroup(14, 3), result: 'trade' },
  call: { rule: 'call_discard_on_q', prefer: (p) => p.play.shape === 'group' && p.play.rank === 12, result: 'callDiscard' },
};

/**
 * 決まった操作（scenario.mjs の detAction）。prefer の手を優先して出し、それ以外はパスできればパスする。
 * 闇市の相手は、選べる相手のうち席の番号がいちばん大きい人（席1を当事者でない見る人にするため）。
 */
const detMove = (mine, hand, game, prefer) => {
  const m = mine.kind === 'choice' && mine.targets !== undefined ? { ...mine, targets: mine.targets.slice().reverse() } : mine;
  return detAction(m, hand, { preferSeven: false, prefer: prefer ?? undefined, game });
};
/** detMove の席。hold なら自分の選択には何もしない（'hold'。simulateGame1 では時間切れ）。 */
const actor =
  ({ prefer = null, hold = false } = {}) =>
  (mine, hand, game) => {
    if (hold && mine.kind === 'choice') return 'hold';
    return detMove(mine, hand, game, prefer);
  };
/** simulateGame1 用（'hold' を時間切れにする）。 */
const sim = (policy) => (mine, hand, game) => {
  const a = policy(mine, hand, game);
  return a === 'hold' ? 'timeout' : a;
};
/** その席の、ルール rule の選択の開始の直後の結果（その席の choiceSkip か、結果の出来事）。 */
const resultAfter = (evs, start, resultType) =>
  evs.find((e) => e.seq > start.seq && ((e.type === 'choiceSkip' && e.seat === start.seat) || (e.type === resultType && (e.seat ?? e.from) === start.seat)));

async function seated(cls, roomId, name, opts = {}) {
  const c = new cls(server.base, roomId, { name, ...opts });
  await c.connect();
  c.hello();
  await c.waitState((s) => s.seat !== null, WAIT, `${name} seated`);
  return c;
}

async function startCustom(host, rules) {
  host.send({ type: 'setConfig', mode: 'custom', rules, gameCount: null });
  await host.waitState((s) => s.room.config.rules.join() === rules.join(), WAIT, 'config');
  host.send({ type: 'start' });
}

describe('choose の target・ranks の形（design-4 §3）', () => {
  it('形の誤りは badMessage、形が正しければ中身の確認へ進む（ロビーでは wrongPhase）', async () => {
    const roomId = await createRoom(server.base);
    const c = await seated(Client, roomId, 'A');
    const send = async (action) => (await c.waitError(c.send({ type: 'action', matchId: 'x', action }))).code;
    const base = { type: 'choose', awaitId: 1, cards: [] };
    // 正しい形（どちらも省略できる。重複や上限は engine が確かめるので、ここでは通る）
    const good = [
      base,
      { ...base, target: 0 },
      { ...base, target: 3 },
      { ...base, ranks: [] },
      { ...base, ranks: [3, 15, 'joker'] },
      { ...base, ranks: CALL_RANKS.slice() }, // 14個
      { ...base, ranks: [7, 7] }, // 重複（中身は engine）
      { ...base, cards: ['spade-3'], target: 2, ranks: [12] }, // 組み合わせ（中身は engine）
    ];
    for (const a of good) expect(await send(a)).toBe('wrongPhase');
    // 壊れた形
    const bad = [
      { ...base, target: 4 },
      { ...base, target: -1 },
      { ...base, target: 1.5 },
      { ...base, target: '1' },
      { ...base, target: null },
      { ...base, ranks: 'joker' },
      { ...base, ranks: 12 },
      { ...base, ranks: null },
      { ...base, ranks: [2] },
      { ...base, ranks: [16] },
      { ...base, ranks: [3.5] },
      { ...base, ranks: ['12'] },
      { ...base, ranks: ['Joker'] },
      { ...base, ranks: [null] }, // 穴のある配列は JSON では null になる
      { ...base, ranks: [[3]] },
      { ...base, ranks: [...CALL_RANKS, 3] }, // 15個
      { ...base, extra: 1 },
      { ...base, rank: 3 }, // useAbility の項目
      // exchangeGive は target・ranks を受け付けない（choose と分けた）
      { type: 'exchangeGive', awaitId: 1, cards: [], target: 1 },
      { type: 'exchangeGive', awaitId: 1, cards: [], ranks: [3] },
    ];
    for (const a of bad) expect([JSON.stringify(a), await send(a)]).toEqual([JSON.stringify(a), 'badMessage']);
    expect(await send({ type: 'exchangeGive', awaitId: 1, cards: [] })).toBe('wrongPhase');
    c.close();
  });
});

describe.each(Object.entries(KINDS))('新しい選択の待ち：%s', (_name, kind) => {
  const RULES = [kind.rule];
  const CONFIG = matchConfig(RULES);

  const timing = { cpuDelayMs: 20, choiceMs: 1000, turnMs: 20_000, exchangeMs: 20_000, respondMs: 20_000 };
  const me = actor({ prefer: kind.prefer, hold: true });
  const seats = [sim(me), 'cpu', 'cpu', 'cpu'];

  it('自分の選択に期限が付き、時間切れで進む', async () => {
    // 1ゲーム目に席0の選択が起きる種
    const { seed } = findSeed(CONFIG, seats, (evs) => evs.some((e) => e.type === 'choiceStart' && e.rule === kind.rule && e.seat === 0));
    const roomId = await createRoom(server.base, timing, seed);
    const c = await seated(DetClient, roomId, 'me', { policy: me });
    await startCustom(c, RULES);

    // 自分の選択：choice の期限（choiceMs 以内）が付き、過ぎたら時間切れで choiceSkip（何もしない）に進む
    const dl = await c.waitFor(
      () => c.states.map((s) => ({ s, d: s.deadlines.find((d) => d.kind === 'choice' && d.seat === 0) })).find((x) => x.d !== undefined),
      WAIT,
      'my choice await',
    );
    expect(dl.d.at - dl.s.serverTime).toBeLessThanOrEqual(timing.choiceMs);
    expect(dl.s.view.mine).toMatchObject({ kind: 'choice', rule: kind.rule, awaitId: dl.d.awaitId });
    expect(dl.s.view.game.choice).toMatchObject({ rule: kind.rule, seat: 0 });
    if (kind.rule === 'triple_a_trade') {
      expect(dl.s.view.mine.targets.length).toBeGreaterThan(0);
      expect(dl.s.view.mine.targets).not.toContain(0);
    } else expect(dl.s.view.mine.targets).toBe(undefined);
    const skip = await c.waitFor(() => c.states.find((s) => s.events.some((e) => e.type === 'choiceSkip' && e.seat === 0 && e.rule === kind.rule)), WAIT, 'timeout skip');
    expect(skip.serverTime).toBeGreaterThanOrEqual(dl.d.at);
    expect(skip.acceptedReqId).toBe(undefined);
    expect(eventsOf([c]).some((e) => e.type === kind.result && (e.seat ?? e.from) === 0)).toBe(false);
    expect(c.rejectedOwn).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    c.close();
  });

  it('CPU の席の選択は約1秒で進み、engine だけで再現した流れと同じ結果になる', async () => {
    // 1ゲーム目に CPU の選択（のあとの結果）が起きる種
    const { seed, events: simEvents } = findSeed(CONFIG, seats, (evs) => {
      const cpu = evs.find((e) => e.type === 'choiceStart' && e.rule === kind.rule && e.seat !== 0);
      return cpu !== undefined && resultAfter(evs, cpu, kind.result) !== undefined;
    });
    const cpuStart = simEvents.find((e) => e.type === 'choiceStart' && e.rule === kind.rule && e.seat !== 0);
    const cpuResult = resultAfter(simEvents, cpuStart, kind.result);
    const roomId = await createRoom(server.base, timing, seed);
    const c = await seated(DetClient, roomId, 'me', { policy: me });
    await startCustom(c, RULES);
    const cpuDl = await c.waitFor(
      () => c.states.map((s) => ({ s, d: s.deadlines.find((d) => d.kind === 'choice' && d.seat === cpuStart.seat) })).find((x) => x.d !== undefined),
      WAIT,
      'cpu choice await',
    );
    expect(cpuDl.d.at - cpuDl.s.serverTime).toBeLessThanOrEqual(timing.cpuDelayMs);
    const got = await c.waitFor(() => eventsOf([c]).find((e) => e.seq === cpuResult.seq), WAIT, 'cpu result');
    expect(got.type).toBe(cpuResult.type);
    if (got.type === 'trade') {
      // 当事者でなければ中身なし
      const party = got.from === 0 || got.to === 0;
      expect(got.count).toBe(cpuResult.given.length);
      expect(got.given === null).toBe(!party);
      expect(got.taken === null).toBe(!party);
    } else {
      expect(got).toEqual(cpuResult);
    }
    expect(c.rejectedOwn).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    c.close();
  });

  it('WebSocket から選んだ操作が成立し、同じ操作の二重送信は拒否される。中身の合わない操作は invalidChoice', async () => {
    const me = actor({ prefer: kind.prefer });
    const watcher = actor();
    const seats = [sim(me), sim(watcher), 'cpu', 'cpu'];
    // 席0が選び、結果が成立する種。闇市は、席1（見ている人）が当事者でない交換
    const { seed, events: simEvents } = findSeed(CONFIG, seats, (evs) => {
      const r = evs.find((e) => e.type === kind.result && (e.seat ?? e.from) === 0);
      if (r === undefined) return false;
      if (kind.rule === 'triple_a_trade') return r.to !== 1;
      if (kind.rule === 'call_discard_on_q') return r.ranks.length > 0;
      return true;
    });
    const simResult = simEvents.find((e) => e.type === kind.result && (e.seat ?? e.from) === 0);
    const timing = { cpuDelayMs: 20, disconnectGraceMs: 20_000, choiceMs: 20_000, turnMs: 20_000, exchangeMs: 20_000, respondMs: 20_000 };
    const roomId = await createRoom(server.base, timing, seed);
    // 席0は自分の選択で止まり、テストが手で送る（そのあとは me のとおり）
    const A = await seated(DetClient, roomId, 'A', { policy: actor({ prefer: kind.prefer, hold: true }) });
    const B = await seated(DetClient, roomId, 'B', { policy: watcher });
    await startCustom(A, RULES);
    const sel = await A.waitFor(
      () => A.states.find((s) => s.view?.mine?.kind === 'choice' && s.view.mine.rule === kind.rule),
      WAIT,
      'my choice',
    );
    const mine = sel.view.mine;
    const action = detMove(mine, sel.view.game.hand, sel.view.game, kind.prefer);
    A.acted.add(A.actKey(mine));
    A.policy = me;

    // 中身の合わない操作（形は正しい）は engine が拒否する。state は変わらない
    const rejected = async (a) => (await A.waitError(A.send({ type: 'action', action: a }), WAIT)).engineError;
    // （その場面で必ず中身が合わなくなるものだけ。枚数を変える操作は、変えた結果が正しくならないときだけ足す）
    const hand = sel.view.game.hand;
    const wrong = [];
    if (kind.rule === 'triple_a_trade') {
      wrong.push({ ...action, target: undefined }, { ...action, target: 0 }, { ...action, ranks: [3] });
      if (action.cards.length === 2) wrong.push({ ...action, cards: action.cards.slice(1) });
    } else if (kind.rule === 'call_discard_on_q') {
      wrong.push({ ...action, ranks: [3, 3] }, { ...action, ranks: CALL_RANKS.slice(0, mine.max + 1) }, { ...action, target: 1 });
      if (hand.length > 0) wrong.push({ ...action, cards: hand.slice(0, 1) });
    } else {
      wrong.push({ ...action, target: 1 }, { ...action, ranks: [3] });
      if (hand.length > mine.max) wrong.push({ ...action, cards: hand.slice(0, mine.max + 1) });
    }
    const before = A.states.length;
    for (const a of wrong) expect([JSON.stringify(a), await rejected(JSON.parse(JSON.stringify(a)))]).toEqual([JSON.stringify(a), 'invalidChoice']);
    expect(A.states.length).toBe(before);
    expect(B.state.version).toBe(sel.version);

    // 同じ操作を2回続けて送る：1回目だけ受け付け、2回目は古い待ちとして拒否する
    const id1 = A.send({ type: 'action', action });
    const id2 = A.send({ type: 'action', action });
    const acc = await A.waitState((s) => s.acceptedReqId === id1, WAIT, 'accepted');
    const err2 = await A.waitError(id2, WAIT);
    expect(err2.code).toBe('actionRejected');
    expect(err2.engineError).toBe('staleAwait');
    expect(A.errors.filter((e) => e.reqId === id1)).toEqual([]);
    A.resume();

    // 結果の出来事が届き、engine だけで再現した流れと同じ
    const res = acc.events.find((e) => e.type === kind.result && (e.seat ?? e.from) === 0);
    expect(res).toBeDefined();
    expect(res.seq).toBe(simResult.seq);
    if (kind.rule === 'triple9_salvage') {
      expect(res.put).toEqual(action.cards);
      expect(res).toMatchObject({ put: simResult.put, took: simResult.took });
    } else if (kind.rule === 'call_discard_on_q') {
      expect(res.ranks).toEqual(action.ranks);
      expect(res).toMatchObject({ ranks: simResult.ranks, discards: simResult.discards });
    } else {
      // 闇市：当事者（A）には中身が見える
      expect(res).toMatchObject({ from: 0, to: action.target, count: action.cards.length, given: action.cards, taken: simResult.taken });
      // 当事者でない B には、誰から誰へ・何枚だけ
      const seen = await B.waitFor(() => eventsOf([B]).find((e) => e.seq === res.seq), WAIT, 'B sees trade');
      expect(seen).toMatchObject({ type: 'trade', from: 0, to: action.target, count: action.cards.length, given: null, taken: null });
      // B が復帰したとき（出来事をまとめて送り直すとき）も中身なし。A の復帰では中身あり
      B.close();
      await B.waitClosed();
      const B2 = new DetClient(server.base, roomId, { name: 'B', token: B.token, policy: watcher });
      B2.paused = true;
      await B2.connect();
      B2.hello();
      const full = await B2.waitState((s) => s.seat === 1 && s.eventsFull, WAIT, 'B rejoined');
      expect(full.events.find((e) => e.seq === res.seq)).toMatchObject({ type: 'trade', count: action.cards.length, given: null, taken: null });
      for (const e of full.events) if (e.type === 'trade') expect(e.given === null).toBe(e.from !== 1 && e.to !== 1);
      expect(JSON.stringify(full.events)).not.toContain(JSON.stringify(action.cards));
      A.paused = true;
      A.close();
      await A.waitClosed();
      const A2 = new DetClient(server.base, roomId, { name: 'A', token: A.token, policy: me });
      A2.paused = true;
      await A2.connect();
      A2.hello();
      const fullA = await A2.waitState((s) => s.seat === 0 && s.eventsFull, WAIT, 'A rejoined');
      expect(fullA.events.find((e) => e.seq === res.seq)).toMatchObject({ given: action.cards, taken: simResult.taken });
      A2.close();
      B2.close();
    }
    // B（ほかの人）にも結果が届く（Q ボンバー・銀河鉄道は全員に同じ）
    if (kind.rule !== 'triple_a_trade') {
      const seen = await B.waitFor(() => eventsOf([B]).find((e) => e.seq === res.seq), WAIT, 'B sees result');
      expect(seen).toEqual({ ...res });
    }
    expect([...A.rejectedOwn, ...B.rejectedOwn]).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    A.close();
    B.close();
  });
});

describe('Q ボンバー：手札0枚でも宣言を待つ（design-4 §2.4、§15.1）', () => {
  it('最後の Q で0枚になった人の選択にも期限が付き、時間切れのあとで上がる', async () => {
    const RULES = ['call_discard_on_q'];
    const isQ = (p) => p.play.shape === 'group' && p.play.rank === 12;
    // 早く上がる席：Q は最後の手（手札をすべて使う手）まで取っておき、ほかは出せる最初の手を出す。選択は時間切れ
    const eager = (mine, hand) => {
      if (mine.kind === 'choice') return 'hold';
      if (mine.kind !== 'turn') return detAction(mine, hand, { preferSeven: false });
      const ok = mine.plays.filter((p) => !p.foul);
      const last = ok.find((p) => isQ(p) && p.cards.length === hand.length);
      const p = last ?? ok.find((x) => !isQ(x)) ?? (mine.canPass ? null : (ok[0] ?? mine.plays[0]));
      if (p === null) return { type: 'pass', awaitId: mine.awaitId };
      return { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape, ...(p.foul ? { confirmFoul: true } : {}) };
    };
    const seats = [sim(eager), 'cpu', 'cpu', 'cpu'];
    // 席0の Q ボンバーの選択の直後（時間切れの choiceSkip のあと）、ほかの席が動く前に席0が上がる種
    const { seed } = findSeed(matchConfig(RULES), seats, (evs) => {
      const i = evs.findIndex((e) => e.type === 'choiceSkip' && e.seat === 0);
      if (i < 0) return false;
      const next = evs.slice(i + 1).find((e) => e.type === 'placed' || e.type === 'play' || e.type === 'pass');
      return next?.type === 'placed' && next.seat === 0 && next.reason === 'finish';
    });
    const timing = { cpuDelayMs: 20, choiceMs: 1000, turnMs: 20_000, exchangeMs: 20_000, respondMs: 20_000 };
    const roomId = await createRoom(server.base, timing, seed);
    const c = await seated(DetClient, roomId, 'me', { policy: eager });
    await startCustom(c, RULES);
    const st = await c.waitState((s) => s.view?.mine?.kind === 'choice', WAIT, 'my choice');
    expect(st.view.game.hand).toEqual([]);
    expect(st.view.game.handCounts[0]).toBe(0);
    expect(st.view.mine).toMatchObject({ rule: 'call_discard_on_q' });
    expect(st.view.mine.max).toBeGreaterThanOrEqual(1);
    const d = st.deadlines.find((x) => x.awaitId === st.view.mine.awaitId);
    expect(d).toMatchObject({ seat: 0, kind: 'choice' });
    expect(d.at - st.serverTime).toBeLessThanOrEqual(timing.choiceMs);
    const placed = await c.waitFor(() => eventsOf([c]).find((e) => e.type === 'placed' && e.seat === 0), WAIT, 'placed');
    const skip = eventsOf([c]).find((e) => e.type === 'choiceSkip' && e.seat === 0);
    expect(skip.seq).toBeLessThan(placed.seq);
    expect(placed.reason).toBe('finish');
    expect(c.rejectedOwn).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    c.close();
  });
});
