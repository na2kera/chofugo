// 実装レビュー（decisions §14.15）を受けて足したテスト。
// ロビーでの無応答、失効したルーム、期限と本人の操作、アラームの二重実行、同時に切れた期限の順番、猶予を過ぎた一時停止と再開。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, chooseAction, createRoom, joinAll, sleep, startServer, testRoute, PORTS, allDeadlineProblems } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.review });
});
afterAll(async () => {
  await server?.stop();
});

async function seated(roomId, name, opts = {}) {
  const c = new Client(server.base, roomId, { name, ...opts });
  await c.connect();
  c.hello();
  await c.waitState((s) => s.seat !== null);
  return c;
}

describe('ロビーと失効', () => {
  it('ロビーでも応答のない接続を検出する（席のある接続も、hello 前の接続も）', async () => {
    const roomId = await createRoom(server.base, { heartbeatTimeoutMs: 1200, heartbeatCheckMs: 300 });
    const A = await seated(roomId, 'A');
    const B = await seated(roomId, 'B');
    const silent = new Client(server.base, roomId, { name: 'silent', pingMs: 0 });
    await silent.connect();
    // 1回だけ ping を送って黙る（一度も送信していない接続は、ローカルの実行環境ではサーバーから閉じても
    // クライアントの close が完了しないため。サーバー側ではその接続は閉じた扱いになる）
    silent.ping();
    B.stopPing();
    expect((await B.waitClosed(8000)).code).toBe(4000);
    expect((await silent.waitClosed(8000)).code).toBe(4000);
    await A.waitState((s) => s.room.seats[1].connected === false, 5000, 'B disconnected in lobby');
    expect(A.closed).toBe(null);
    // 全員が黙って切れたら一時停止に進む
    A.stopPing();
    expect((await A.waitClosed(8000)).code).toBe(4000);
    const O = new Client(server.base, roomId, { name: 'O' });
    await O.connect();
    const os = await O.waitState(() => true);
    expect(os.room.paused).toBe(true);
    expect(os.room.seats.slice(0, 2).map((s) => s.connected)).toEqual([false, false]);
    O.close();
  });

  it('一時停止の時間を過ぎたルームは、削除のアラームがまだでも再開しない', async () => {
    // アラームをわざと遅らせて「失効したが削除されていない」状態を作る
    const roomId = await createRoom(server.base, { pausedCloseMs: 1500, testAlarmLagMs: 20_000 });
    const A = await seated(roomId, 'A');
    const O = new Client(server.base, roomId, { name: 'O' });
    await O.connect();
    await O.waitState(() => true);
    A.close();
    await O.waitState((s) => s.room.paused === true);
    await sleep(2000);
    // 失効後の hello（すでに開いていた接続から）
    O.send({ type: 'hello', token: A.token, name: 'A' });
    expect((await O.waitClosed(5000)).code).toBe(4003);
    expect(O.states.every((s) => s.seat === null)).toBe(true);
    // 失効後の新しい接続
    const late = new Client(server.base, roomId, { name: 'late', token: A.token });
    await expect(late.connect()).rejects.toThrow();
  });
});

describe('期限とアラーム', () => {
  it('期限を過ぎても、auto が適用される前に届いた本人の操作は受け付ける（§14.10）', async () => {
    // 期限は 500ms だが、アラームは 2 秒遅れて鳴る
    const roomId = await createRoom(server.base, { cpuDelayMs: 20, turnMs: 500, exchangeMs: 500, respondMs: 500, testAlarmLagMs: 2000 });
    const me = await seated(roomId, 'me');
    me.send({ type: 'start' });
    const st = await me.waitState((s) => s.view?.mine != null, 30_000);
    const mine = st.view.mine;
    const dl = st.deadlines.find((d) => d.awaitId === mine.awaitId);
    // 期限を過ぎるまで待つ（サーバーの時計で）
    await sleep(Math.max(0, dl.at - st.serverTime) + 300);
    const n = me.errors.length;
    me.send({ type: 'action', action: chooseAction(mine, st.view.game.hand) });
    await me.waitState((s) => !s.view.awaiting.some((a) => a.id === mine.awaitId), 1500, 'accepted before auto');
    await sleep(100);
    expect(me.errors.slice(n)).toEqual([]);
    me.close();
  });

  it('期限切れの auto を適用した直後にアラームを2回実行しても、二重に進まない', async () => {
    // CPU の間を長くして、自分の待ちが時間切れになったあとしばらく何も起きないようにする
    const roomId = await createRoom(server.base, { cpuDelayMs: 6000, turnMs: 400, exchangeMs: 400, respondMs: 400 });
    const me = await seated(roomId, 'me');
    me.send({ type: 'start' });
    const st = await me.waitState((s) => s.view?.mine != null, 60_000);
    const id = st.view.mine.awaitId;
    const after = await me.waitState((s) => !s.view.awaiting.some((a) => a.id === id), 5000, 'auto applied');
    const v = after.version;
    const awaitingAfter = JSON.stringify(after.view.awaiting);
    expect(await testRoute(server.base, roomId, 'alarm')).toEqual({ version: v });
    expect(await testRoute(server.base, roomId, 'alarm')).toEqual({ version: v });
    await sleep(200);
    expect(me.state.version).toBe(v);
    expect(JSON.stringify(me.state.view.awaiting)).toBe(awaitingAfter);
    // 操作の記録とも一致している
    expect(await testRoute(server.base, roomId, 'replay')).toMatchObject({ ok: true });
    me.close();
  });

  it('同時に切れた期限は待ちの番号の小さい順に処理する（交換）', async () => {
    const roomId = await createRoom(server.base, { exchangeMs: 700 });
    const clients = [0, 1, 2, 3].map((i) => new Client(server.base, roomId, { name: `P${i}` }));
    await joinAll(clients);
    for (const c of clients) c.auto = true;
    clients[0].send({ type: 'start' });
    await clients[0].waitState((s) => s.matchPhase === 'gameResult', 60_000);
    for (const c of clients) c.auto = false;
    clients[0].send({ type: 'nextGame' });
    const ex = await clients[0].waitState((s) => s.matchPhase === 'exchange', 10_000);
    // 同じ時刻に切れる待ち（大富豪・大貧民の組と、富豪・貧民の組で1つずつ）
    const groups = new Map();
    for (const d of ex.deadlines) groups.set(d.at, [...(groups.get(d.at) ?? []), d]);
    const same = [...groups.values()].find((g) => g.length >= 2);
    expect(same).toBeDefined();
    const ordered = same.slice().sort((a, b) => a.awaitId - b.awaitId).map((d) => d.seat);
    await clients[0].waitState((s) => !same.some((d) => s.view.awaiting.some((a) => a.id === d.awaitId)), 5000, 'both expired');
    // その後に起きた交換の出来事の、渡した人の順
    const idx = clients[0].states.indexOf(ex);
    const froms = clients[0].states
      .slice(idx + 1)
      .flatMap((s) => s.events)
      .filter((e) => e.type === 'exchange' && same.some((d) => d.seat === e.from))
      .map((e) => e.from);
    expect(froms.slice(0, ordered.length)).toEqual(ordered);
    for (const c of clients) c.close();
  });

  it('猶予を過ぎた一時停止から再開すると、代役の席は約1秒で進み、戻った本人の待ちは秒数いっぱいになる', async () => {
    const timing = { cpuDelayMs: 50, disconnectGraceMs: 600, turnMs: 8000, exchangeMs: 8000, respondMs: 8000 };
    const roomId = await createRoom(server.base, timing);
    const A = await seated(roomId, 'A');
    const B = await seated(roomId, 'B');
    A.send({ type: 'start' });
    const st = await A.waitState((s) => s.deadlines.some((d) => d.seat === 0 || d.seat === 1), 30_000);
    const waiting = st.deadlines.find((d) => d.seat === 0 || d.seat === 1);
    const X = waiting.seat === 0 ? A : B; // 待たれている人（あとで戻る）
    const Y = waiting.seat === 0 ? B : A; // 戻らない人
    const ySeat = 1 - waiting.seat;
    await sleep(1500);
    const O = new Client(server.base, roomId, { name: 'O' });
    await O.connect();
    await O.waitState(() => true);
    A.close();
    B.close();
    const paused = await O.waitState((s) => s.room.paused === true, 5000);
    const remaining = paused.deadlines.find((d) => d.awaitId === waiting.awaitId).remainingMs;
    expect(remaining).toBeLessThan(7000);
    await sleep(1500); // 猶予（600ms）を過ぎる
    const X2 = new Client(server.base, roomId, { name: 'X2', token: X.token });
    await X2.connect();
    X2.hello();
    const back = await X2.waitState((s) => s.seat === waiting.seat && s.room.paused === false);
    // 戻った本人の待ちは秒数いっぱい
    const bd = back.deadlines.find((d) => d.awaitId === waiting.awaitId);
    expect(bd.at - back.serverTime).toBeGreaterThan(7500);
    // 戻らなかった人は代役になっている
    expect(back.room.seats[ySeat]).toMatchObject({ connected: false, away: true });
    // 本人が操作して進めると、代役の席の待ちは約1秒（cpuDelayMs）で進む
    X2.auto = true;
    X2.maybeAct();
    const yState = await X2.waitState((s) => s.deadlines.some((d) => d.seat === ySeat), 30_000, 'substitute await');
    const yd = yState.deadlines.find((d) => d.seat === ySeat);
    expect(yd.at - yState.serverTime).toBeLessThanOrEqual(timing.cpuDelayMs);
    await X2.waitState((s) => !s.view.awaiting.some((a) => a.id === yd.awaitId), 3000, 'substitute moved');
    void Y;
    X2.close();
    O.close();
  });
});

// 一時停止・再開・代役・再起動をまたいでも、一時停止中でなければすべての待ちに期限があった（design-2 §3.4）
describe('期限についての検査', () => {
  it('このファイルで作ったルームに、期限のない待ちが残らなかった', async () => {
    expect(await allDeadlineProblems(server.base)).toEqual({});
  });
});
