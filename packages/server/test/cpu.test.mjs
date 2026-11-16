// 人間1人＋CPU3人、時間切れ、期限と本人の操作の行き違い、アラームの二重発火、途中参加、無制限の試合の終了。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createRoom, deadlineProblems, sleep, startServer, PORTS } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.cpu });
});
afterAll(async () => {
  await server?.stop();
});

async function alarmNow(roomId) {
  const r = await fetch(`${server.base}/api/rooms/${roomId}/test/alarm`, { method: 'POST' });
  expect(r.status).toBe(200);
  return (await r.json()).version;
}

describe('CPU と時間切れ', () => {
  it('人間1人＋CPU3人で1試合を最後まで進める', async () => {
    const roomId = await createRoom(server.base, { cpuDelayMs: 20 });
    const me = new Client(server.base, roomId, { name: 'solo', auto: true, autoHost: true });
    await me.connect();
    me.hello();
    await me.waitState((s) => s.isHost);
    me.send({ type: 'start' });
    await me.waitState((s) => s.matchPhase === 'matchResult', 150_000);
    expect(me.state.room.seats.map((s) => s.kind)).toEqual(['human', 'cpu', 'cpu', 'cpu']);
    expect(me.state.room.seats.map((s) => s.name)).toEqual(['solo', 'CPU 2', 'CPU 3', 'CPU 4']);
    expect(me.state.view.results.length).toBe(5);
    expect(me.rejectedOwn).toEqual([]);
    // CPU の操作（auto）が出来事として届いている
    const cpuPlays = me.states.flatMap((s) => s.events).filter((e) => (e.type === 'play' || e.type === 'pass') && e.seat !== 0);
    expect(cpuPlays.length).toBeGreaterThan(20);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    me.close();
  });

  it('時間切れで自動的に進み、期限後に届いた古い待ち番号は拒否される', async () => {
    const roomId = await createRoom(server.base, { cpuDelayMs: 20, turnMs: 600, respondMs: 400, exchangeMs: 600 });
    const me = new Client(server.base, roomId, { name: 'idle' });
    await me.connect();
    me.hello();
    await me.waitState((s) => s.isHost);
    me.send({ type: 'start' });
    // 何もしない人の待ちを、期限で server が自動で進める
    const first = await me.waitState((s) => s.view?.mine != null, 20_000);
    const staleId = first.view.mine.awaitId;
    const dl = first.deadlines.find((d) => d.awaitId === staleId);
    expect(dl.seat).toBe(0);
    expect(dl.at - first.serverTime).toBeGreaterThan(300);
    expect(dl.at - first.serverTime).toBeLessThanOrEqual(600);
    await me.waitState((s) => !s.view.awaiting.some((a) => a.id === staleId), 10_000);
    // 本人の操作が期限の自動操作と行き違った
    const e = await me.waitError(me.send({ type: 'action', action: { type: 'pass', awaitId: staleId } }));
    expect([e.code, e.engineError]).toEqual(['actionRejected', 'staleAwait']);
    // 自分の席の出来事が、送っていないのに起きている
    const mineEvents = me.states.flatMap((s) => s.events).filter((x) => (x.type === 'play' || x.type === 'pass') && x.seat === 0);
    expect(mineEvents.length).toBeGreaterThan(0);
    // ゲームの最後まで自動で進む
    await me.waitState((s) => s.matchPhase === 'gameResult', 60_000);
    // アラームが2回鳴っても結果は変わらない（期限のない結果画面で2回実行）
    const v0 = me.state.version;
    const n0 = me.states.length;
    expect(await alarmNow(roomId)).toBe(v0);
    expect(await alarmNow(roomId)).toBe(v0);
    await sleep(200);
    expect(me.states.length).toBe(n0);
    // 2ゲーム目は交換から。交換の時間切れも自動で進む
    me.send({ type: 'nextGame' });
    await me.waitState((s) => s.view.gameNo === 2 && s.matchPhase === 'play', 20_000);
    const ex = me.states.flatMap((s) => s.events).filter((x) => x.type === 'exchangeDone' && x.gameNo === 2);
    expect(ex.length).toBe(1);
    // 期限前の待ちがあるときに2回鳴らしても、待ちは進まない
    await me.waitState((s) => s.view.mine != null, 20_000);
    const vv = await alarmNow(roomId);
    expect(await alarmNow(roomId)).toBe(vv);
    me.close();
  });

  it('ゲームの合間だけ CPU の席に途中参加でき、点数を引き継ぐ。無制限の試合はホストが終える', async () => {
    const roomId = await createRoom(server.base, { cpuDelayMs: 20 });
    const host = new Client(server.base, roomId, { name: 'host', auto: true });
    await host.connect();
    host.hello();
    await host.waitState((s) => s.isHost);
    host.send({ type: 'setConfig', mode: 'daifugo', rules: ['flush_on_8', 'revolution'], gameCount: null });
    await host.waitState((s) => s.room.config.gameCount === null);
    host.send({ type: 'start' });
    await host.waitState((s) => s.matchPhase === 'gameResult', 60_000);
    const scores = host.state.view.scores.slice();
    // 結果画面の間に新しい人が入る
    const guest = new Client(server.base, roomId, { name: 'guest', auto: true });
    await guest.connect();
    guest.hello();
    const gs = await guest.waitState((s) => s.seat !== null);
    expect(gs.seat).toBe(1);
    expect(gs.room.seats[1]).toMatchObject({ kind: 'human', name: 'guest', connected: true });
    expect(gs.view.scores).toEqual(scores);
    expect(gs.eventsFull).toBe(true);
    expect(gs.events[0].type).toBe('gameStart');
    expect(gs.isHost).toBe(false);
    // 2ゲーム目
    host.send({ type: 'nextGame' });
    await host.waitState((s) => s.view.gameNo === 2 && s.matchPhase === 'play');
    // ゲームの途中は入れない
    const third = new Client(server.base, roomId, { name: 'third' });
    await third.connect();
    expect((await third.waitError(third.hello())).code).toBe('cannotJoin');
    // ゲームの途中では試合を終えられない
    const e = await host.waitError(host.send({ type: 'endMatch' }));
    expect([e.code, e.engineError]).toEqual(['actionRejected', 'wrongPhase']);
    await host.waitState((s) => s.matchPhase === 'gameResult', 60_000);
    expect((await guest.waitError(guest.send({ type: 'endMatch' }))).code).toBe('notHost');
    host.send({ type: 'endMatch' });
    await guest.waitState((s) => s.matchPhase === 'matchResult');
    expect(guest.state.view.standings.length).toBe(4);
    expect(guest.state.view.results.length).toBe(2);
    expect(host.rejectedOwn).toEqual([]);
    expect(guest.rejectedOwn).toEqual([]);
    for (const c of [host, guest, third]) c.close();
  });
});
