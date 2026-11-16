// 切断と代役、復帰、ホストの移動、古い接続の切断通知、応答のない接続、全員不在の一時停止と再開、ルームの終了。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createRoom, sleep, startServer } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8803 });
});
afterAll(async () => {
  await server?.stop();
});

const allEvents = (c) => c.states.flatMap((s) => s.events);

/** 席なしで様子だけを見る接続（hello を送らない）。 */
async function observer(roomId) {
  const o = new Client(server.base, roomId, { name: 'observer' });
  await o.connect();
  await o.waitState(() => true);
  return o;
}

describe('切断と復帰', () => {
  it('代役・復帰・ホストの移動・古い接続・応答のない接続', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 800, heartbeatTimeoutMs: 1500, heartbeatCheckMs: 400, turnMs: 20_000, exchangeMs: 20_000 };
    const roomId = await createRoom(server.base, timing);
    const opts = { auto: true, autoHost: true, actDelay: 60 };
    const A = new Client(server.base, roomId, { name: 'A', ...opts });
    const B = new Client(server.base, roomId, { name: 'B', ...opts });
    const C = new Client(server.base, roomId, { name: 'C', ...opts });
    for (const c of [A, B, C]) {
      await c.connect();
      c.hello();
      await c.waitState((s) => s.seat !== null);
    }
    A.send({ type: 'setConfig', rules: ['flush_on_8', 'revolution', 'runs'], gameCount: 10 });
    await A.waitState((s) => s.room.config.gameCount === 10);
    A.send({ type: 'start' });
    await A.waitState((s) => s.matchPhase === 'play' || s.matchPhase === 'exchange');
    expect(A.state.room.seats[3].kind).toBe('cpu');

    // --- C が切断 → 猶予の間は人間のまま → 猶予後に代役
    C.close();
    await A.waitState((s) => s.room.seats[2].connected === false && s.room.seats[2].away === false, 5000, 'C disconnected');
    await A.waitState((s) => s.room.seats[2].away === true, 5000, 'C away');
    const nAway = allEvents(A).length;
    // 代役が C の席を操作して進む
    await A.waitFor(() => (allEvents(A).slice(nAway).some((e) => (e.type === 'play' || e.type === 'pass' || e.type === 'respondSkip' || e.type === 'exchange') && (e.seat === 2 || e.from === 2)) ? true : undefined), 30_000, 'substitute moves');

    // --- C が同じ値で戻る → 同じ席、本人の操作に戻る、出来事は最初から
    const C2 = new Client(server.base, roomId, { name: 'C-again', token: C.token, ...opts });
    await C2.connect();
    C2.hello();
    const back = await C2.waitState((s) => s.seat !== null);
    expect(back.seat).toBe(2);
    expect(back.eventsFull).toBe(true);
    expect(back.events[0].type).toBe('gameStart');
    expect(back.room.seats[2]).toMatchObject({ kind: 'human', name: 'C', connected: true, away: false });
    // 戻った本人の待ちは秒数いっぱい
    for (const d of back.deadlines.filter((x) => x.seat === 2)) expect(d.at - back.serverTime).toBeGreaterThan(18_000);

    // --- 古い接続の切断通知：B の新しい接続が来ると古い接続は閉じられるが、席は接続中のまま
    const B2 = new Client(server.base, roomId, { name: 'B-again', token: B.token, ...opts });
    await B2.connect();
    B2.hello();
    await B2.waitState((s) => s.seat === 1);
    expect((await B.waitClosed()).code).toBe(4001);
    await sleep(timing.disconnectGraceMs + 600);
    expect(A.state.room.seats[1]).toMatchObject({ connected: true, away: false });
    expect(B2.closed).toBe(null);

    // --- ホスト（A）が切断 → 猶予後に席順で次の接続中の人間（B）に移る
    A.close();
    await B2.waitState((s) => s.isHost === true && s.room.host === 1, 5000, 'host moved');
    const A2 = new Client(server.base, roomId, { name: 'A-again', token: A.token, ...opts });
    await A2.connect();
    A2.hello();
    const aBack = await A2.waitState((s) => s.seat === 0);
    expect(aBack.isHost).toBe(false);
    expect(aBack.room.host).toBe(1);

    // --- 応答のない接続（ping を止める）は約 heartbeatTimeoutMs で切断として扱う
    // 操作も送らない（操作のメッセージも生存の印として数えるため）
    C2.auto = false;
    C2.stopPing();
    expect((await C2.waitClosed(10_000)).code).toBe(4000);
    await A2.waitState((s) => s.room.seats[2].connected === false, 5000, 'C silent drop');
    for (const c of [A2, B2]) expect(c.rejectedOwn).toEqual([]);
    for (const c of [A2, B2, C2]) c.close();
  });

  it('全員不在で止まり、戻ると止めた時点の残り時間で再開する', async () => {
    // 猶予を長くして、止まっている間に代役へ切り替わらないようにする
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 60_000, turnMs: 8000, exchangeMs: 8000, respondMs: 8000 };
    const roomId = await createRoom(server.base, timing);
    const A = new Client(server.base, roomId, { name: 'A', autoHost: true });
    const B = new Client(server.base, roomId, { name: 'B' });
    for (const c of [A, B]) {
      await c.connect();
      c.hello();
      await c.waitState((s) => s.seat !== null);
    }
    A.send({ type: 'start' });
    // 人間（A か B）の待ちが来るまで CPU が進める
    const st = await A.waitState((s) => s.deadlines.some((d) => d.seat === 0 || d.seat === 1), 20_000);
    const waiting = st.deadlines.find((d) => d.seat === 0 || d.seat === 1);
    const O = await observer(roomId);
    A.close();
    B.close();
    const paused = await O.waitState((s) => s.room.paused === true, 5000, 'paused');
    const pd = paused.deadlines.find((d) => d.awaitId === waiting.awaitId);
    expect(pd.at).toBe(null);
    expect(pd.remainingMs).toBeGreaterThan(5000);
    expect(pd.remainingMs).toBeLessThanOrEqual(8000);
    await sleep(2500);
    // 止まっている間は進まない（期限は残り時間のまま）
    expect(O.state.deadlines.find((d) => d.awaitId === waiting.awaitId)?.remainingMs).toBe(pd.remainingMs);
    // 待たれていないほうの人が戻る → 待たれている人の期限は残り時間で再開
    const returner = waiting.seat === 0 ? B : A;
    const R = new Client(server.base, roomId, { name: 'R', token: returner.token });
    await R.connect();
    R.hello();
    const rs = await R.waitState((s) => s.seat !== null && s.room.paused === false);
    const rd = rs.deadlines.find((d) => d.awaitId === waiting.awaitId);
    expect(rd.remainingMs).toBe(null);
    expect(Math.abs(rd.at - rs.serverTime - pd.remainingMs)).toBeLessThan(300);
    // 待たれていた人が戻らなければ、時間切れで進む
    await R.waitState((s) => !s.view.awaiting.some((a) => a.id === waiting.awaitId), 15_000, 'resumed timeout');
    R.close();
    O.close();
  });

  it('全員不在のまま決めた時間がたつとルームを閉じて消す', async () => {
    const roomId = await createRoom(server.base, { pausedCloseMs: 1500 });
    const A = new Client(server.base, roomId, { name: 'A' });
    await A.connect();
    A.hello();
    await A.waitState((s) => s.seat === 0 && s.room.paused === false);
    const O = await observer(roomId);
    A.close();
    await O.waitState((s) => s.room.paused === true);
    expect((await O.waitClosed(8000)).code).toBe(4003);
    await sleep(300);
    const late = new Client(server.base, roomId, { name: 'late' });
    await expect(late.connect()).rejects.toThrow();
    // 作られていないルームにも接続できない
    const none = new Client(server.base, 'AAAAAAAAAAAAAAAAAAAAAA', { name: 'none' });
    await expect(none.connect()).rejects.toThrow();
  });
});
