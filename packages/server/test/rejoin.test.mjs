// つなぎ直したときの持ち時間（decisions §18.1）。
// 猶予の中での復帰は期限を変えない（残りが短ければ1つの待ちにつき1回だけ rejoinMinMs まで延ばす）。
// 切断とつなぎ直しを何回繰り返しても、手番は最初の期限（＋1回だけの延長）までに時間切れで進む。
// 代役から戻ったときは秒数いっぱい（ここと、一時停止中に猶予を過ぎた場合は review.test.mjs）。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PassiveClient, createRoom, deadlineProblems, sleep, startServer, testRoute, PORTS } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.rejoin });
});
afterAll(async () => {
  await server?.stop();
});

/**
 * A（席0、操作しない）と B（席1、受け身で操作し、心拍を送り続ける）。残りは CPU。
 * B がつながっているので、A が切れても全員不在の一時停止にはならない。
 */
async function room(timing) {
  const roomId = await createRoom(server.base, timing);
  const A = new Client(server.base, roomId, { name: 'A' });
  await A.connect();
  A.hello();
  await A.waitState((s) => s.seat === 0);
  const B = new PassiveClient(server.base, roomId, { name: 'B', autoHost: true });
  await B.connect();
  B.hello();
  await B.waitState((s) => s.seat === 1);
  A.send({ type: 'start' });
  // A の手番を待つ（A は操作しないので、A のほかの待ちは時間切れで進む）
  const st = await A.waitState((s) => s.view?.mine?.kind === 'turn', 60_000, 'A turn');
  const target = st.deadlines.find((d) => d.awaitId === st.view.mine.awaitId);
  expect(target.seat).toBe(0);
  // B にも同じ待ちが届いてから始める（B の state で待ちが残っているかを見るため）
  await B.waitState((s) => s.view.awaiting.some((a) => a.id === target.awaitId), 10_000, 'B sees A turn');
  return { roomId, A, B, target, startedAt: st.serverTime };
}

/** 同じ本人確認の値でつなぎ直す。 */
async function rejoin(roomId, prev, opts = {}) {
  const c = new Client(server.base, roomId, { name: 'A', token: prev.token, ...opts });
  await c.connect();
  if (opts.pingMs === 0) c.ping();
  c.hello();
  const st = await c.waitState((s) => s.seat === 0, 10_000, 'rejoined');
  return { c, st };
}

/** B が見た state のうち、target の待ちがなくなった最初のもの。 */
const goneAt = (B, awaitId) => B.waitState((s) => !s.view.awaiting.some((a) => a.id === awaitId), 60_000, 'await gone');

/** 復帰のたびの state に出ていた target の期限（待ちが残っていたものだけ）。 */
const ats = (sts, awaitId) => sts.map((s) => s.deadlines.find((d) => d.awaitId === awaitId)?.at).filter((x) => x !== undefined);

/** 期限の列が「最初の期限のまま、途中で1回だけ延びて、そのあとは変わらない」こと。 */
function expectAtMostOneExtension(list, at0, minMs) {
  const distinct = [...new Set(list)];
  expect(distinct[0]).toBe(at0);
  expect(distinct.length).toBeLessThanOrEqual(2);
  if (distinct.length === 2) {
    expect(distinct[1]).toBeGreaterThan(at0);
    expect(distinct[1] - at0).toBeLessThanOrEqual(minMs);
    // 延びたあとは元に戻らない
    const i = list.indexOf(distinct[1]);
    expect(list.slice(i).every((x) => x === distinct[1])).toBe(true);
  }
  return distinct.at(-1);
}

describe('猶予の中でつなぎ直したときの期限', () => {
  it('期限は変えない。残りが短いときは1回だけ rejoinMinMs まで延ばし、2回目は延ばさない', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 3000, rejoinMinMs: 3000, turnMs: 7000, respondMs: 4000, choiceMs: 4000 };
    const { roomId, A, B, target } = await room(timing);
    // 1回目：残りは長い → 期限は同じ
    A.close();
    await A.waitClosed();
    const r1 = await rejoin(roomId, A);
    const d1 = r1.st.deadlines.find((d) => d.awaitId === target.awaitId);
    expect(d1.at).toBe(target.at);
    expect(r1.st.room.seats[0]).toMatchObject({ connected: true, away: false });
    // 残りが rejoinMinMs より短くなるまで待つ
    await sleep(Math.max(0, target.at - r1.st.serverTime - 1500));
    r1.c.close();
    await r1.c.waitClosed();
    const r2 = await rejoin(roomId, r1.c);
    const d2 = r2.st.deadlines.find((d) => d.awaitId === target.awaitId);
    expect(d2).toBeDefined();
    expect(target.at - r2.st.serverTime).toBeLessThan(timing.rejoinMinMs);
    // 2回目の復帰：残りを rejoinMinMs にする
    // （serverTime は送る時点の時刻なので、処理の時刻より数ミリ秒遅れることがある）
    expect(d2.at).toBeLessThanOrEqual(r2.st.serverTime + timing.rejoinMinMs);
    expect(d2.at).toBeGreaterThan(r2.st.serverTime + timing.rejoinMinMs - 100);
    expect(d2.at).toBeGreaterThan(target.at);
    // 残りがまた短くなってから3回目：延ばさない
    await sleep(Math.max(0, d2.at - r2.st.serverTime - 1500));
    r2.c.close();
    await r2.c.waitClosed();
    const r3 = await rejoin(roomId, r2.c);
    const d3 = r3.st.deadlines.find((d) => d.awaitId === target.awaitId);
    expect(d3).toBeDefined();
    expect(d3.at).toBe(d2.at);
    // 延ばした期限で時間切れになる
    const gone = await goneAt(B, target.awaitId);
    expect(gone.serverTime).toBeGreaterThanOrEqual(d2.at);
    expect(gone.serverTime - d2.at).toBeLessThan(1000);
    expect(B.rejectedOwn).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    r3.c.close();
    B.close();
  });

  it('切断（接続を閉じる）とつなぎ直しを繰り返しても、手番は最初の期限＋1回の延長までに時間切れで進む', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 2000, rejoinMinMs: 2000, turnMs: 5000, respondMs: 4000, choiceMs: 4000 };
    const { roomId, A, B, target } = await room(timing);
    let cur = A;
    const seen = [];
    let n = 0;
    // 待ちが残っている間、300ms ごとに閉じてつなぎ直す
    while (B.state.view.awaiting.some((a) => a.id === target.awaitId) && n < 100) {
      cur.close();
      await cur.waitClosed();
      await sleep(100);
      const r = await rejoin(roomId, cur);
      seen.push(r.st);
      expect(r.st.room.seats[0].away).toBe(false);
      cur = r.c;
      n++;
      await sleep(200);
    }
    expect(n).toBeGreaterThanOrEqual(5);
    const last = expectAtMostOneExtension(ats(seen, target.awaitId), target.at, timing.rejoinMinMs);
    const gone = await goneAt(B, target.awaitId);
    expect(gone.serverTime - last).toBeLessThan(1000);
    expect(gone.serverTime - target.at).toBeLessThan(timing.rejoinMinMs + 1000);
    // 試合はそのあとも進む
    await B.waitState((s) => s.view.awaiting.length > 0 && !s.view.awaiting.some((a) => a.id === target.awaitId), 10_000, 'next await');
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    cur.close();
    B.close();
  });

  it('心拍が届かずに閉じられる（4000）→ すぐつなぎ直す、を繰り返しても、手番は最初の期限＋1回の延長までに時間切れで進む', async () => {
    // A は接続の直後に1回だけ ping を送り、あとは黙る（タブを裏に回したブラウザ）。B は心拍を送り続ける
    const timing = {
      cpuDelayMs: 30,
      disconnectGraceMs: 2000,
      rejoinMinMs: 2000,
      heartbeatTimeoutMs: 800,
      heartbeatCheckMs: 200,
      turnMs: 6000,
      respondMs: 4000,
      choiceMs: 4000,
    };
    const { roomId, A, B, target } = await room(timing);
    let cur = A;
    cur.stopPing();
    const seen = [];
    const codes = [];
    while (B.state.view.awaiting.some((a) => a.id === target.awaitId) && codes.length < 100) {
      const closed = await cur.waitClosed(10_000);
      codes.push(closed.code);
      await sleep(150);
      const r = await rejoin(roomId, cur, { pingMs: 0 });
      seen.push(r.st);
      expect(r.st.room.seats[0].away).toBe(false);
      cur = r.c;
    }
    expect(codes.length).toBeGreaterThanOrEqual(3);
    expect(codes.every((c) => c === 4000)).toBe(true);
    const last = expectAtMostOneExtension(ats(seen, target.awaitId), target.at, timing.rejoinMinMs);
    const gone = await goneAt(B, target.awaitId);
    expect(gone.serverTime - last).toBeLessThan(1000);
    expect(gone.serverTime - target.at).toBeLessThan(timing.rejoinMinMs + 1000);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    cur.close();
    B.close();
  });

  it('代役から戻ったときは秒数いっぱいに付け直す', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 500, rejoinMinMs: 2000, turnMs: 8000, respondMs: 4000, choiceMs: 4000 };
    const { roomId, A, B, target } = await room(timing);
    // 代役の操作を遅らせ、代役に切り替わったあとも同じ待ちが残るようにする
    await testRoute(server.base, roomId, 'timing', { cpuDelayMs: 6000 });
    A.close();
    const away = await B.waitState((s) => s.room.seats[0].away === true, 10_000, 'A away');
    expect(away.view.awaiting.some((a) => a.id === target.awaitId)).toBe(true);
    const r = await rejoin(roomId, A);
    const d = r.st.deadlines.find((x) => x.awaitId === target.awaitId);
    expect(d).toBeDefined();
    expect(r.st.room.seats[0]).toMatchObject({ connected: true, away: false });
    expect(d.at - r.st.serverTime).toBeGreaterThan(timing.turnMs - 300);
    expect(d.at - r.st.serverTime).toBeLessThanOrEqual(timing.turnMs);
    expect(d.at).toBeGreaterThan(target.at);
    r.c.close();
    B.close();
  });
});

describe('人間1人のルーム（つなぎ直すたびに全員不在の一時停止をはさむ）', () => {
  it('心拍が届かずに閉じられる → つなぎ直す、を繰り返しても、手番は時間切れで進む', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 2000, rejoinMinMs: 2000, heartbeatTimeoutMs: 800, heartbeatCheckMs: 200, turnMs: 4000, respondMs: 4000, choiceMs: 4000 };
    const roomId = await createRoom(server.base, timing);
    const A = new Client(server.base, roomId, { name: 'A' });
    await A.connect();
    A.hello();
    await A.waitState((s) => s.seat === 0);
    // 席のない観察用の接続（心拍を送り続ける。人間の接続には数えない。席がないので view はなく、期限の一覧で見る）
    const O = new Client(server.base, roomId, { name: 'observer' });
    await O.connect();
    await O.waitState(() => true);
    A.send({ type: 'start' });
    const st = await A.waitState((s) => s.view?.mine?.kind === 'turn', 60_000, 'A turn');
    const awaitId = st.view.mine.awaitId;
    await O.waitState((s) => s.deadlines.some((d) => d.awaitId === awaitId), 10_000, 'O sees A turn');
    let cur = A;
    cur.stopPing();
    const codes = [];
    while (O.state.deadlines.some((d) => d.awaitId === awaitId) && codes.length < 30) {
      const closed = await cur.waitClosed(10_000);
      codes.push(closed.code);
      await sleep(150);
      const r = await rejoin(roomId, cur, { pingMs: 0 });
      expect(r.st.room.seats[0].away).toBe(false);
      cur = r.c;
    }
    // 接続していた時間の合計で、最初の4秒（＋1回の延長）を使い切る。つなぐたびに約0.8〜1秒進むので、30回より十分少ない
    expect(O.state.deadlines.some((d) => d.awaitId === awaitId)).toBe(false);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    expect(codes.length).toBeLessThan(30);
    expect(codes.every((c) => c === 4000)).toBe(true);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    cur.close();
    O.close();
  });
});
