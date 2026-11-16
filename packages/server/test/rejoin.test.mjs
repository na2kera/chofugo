// つなぎ直したときの持ち時間（decisions §18.1）。
// 猶予の中での復帰は期限を変えない（残りが短ければ1つの待ちにつき1回だけ rejoinMinMs まで延ばす）。
// 切断とつなぎ直しを何回繰り返しても、手番は最初の期限（＋1回だけの延長）までに時間切れで進む。
// 代役から戻ったときは秒数いっぱい。ただし復帰による延長は、猶予の中の復帰と合わせて1つの待ちにつき1回だけ（§18.2）。
// 一時停止中に猶予を過ぎた場合は review.test.mjs。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, HolderClient, PassiveClient, createRoom, deadlineProblems, sleep, startServer, testRoute, PORTS } from './helpers.mjs';

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

/** 期限から、時間切れの state が B に届くまでの許容（ローカルの開発サーバーは、機械が混んでいるとアラームが1秒ほど遅れることがある）。 */
const EXPIRE_SLACK_MS = 1500;

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
    expect(gone.serverTime - d2.at).toBeLessThan(EXPIRE_SLACK_MS);
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
    expect(gone.serverTime - last).toBeLessThan(EXPIRE_SLACK_MS);
    expect(gone.serverTime - target.at).toBeLessThan(timing.rejoinMinMs + EXPIRE_SLACK_MS);
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
    expect(gone.serverTime - last).toBeLessThan(EXPIRE_SLACK_MS);
    expect(gone.serverTime - target.at).toBeLessThan(timing.rejoinMinMs + EXPIRE_SLACK_MS);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    cur.close();
    B.close();
  });

  // 代役から戻る経路（decisions §18.2）。代役の操作（cpuDelayMs）を本番と同じく猶予より短くし、
  // 代役に切り替わってから CPU が操作するまでの窓で戻る。窓を少し広げるため、席が埋まってから cpuDelayMs を差し替える
  /** A を閉じ、代役に切り替わったのを B で見てから、同じ待ちが残っているうちに戻る。戻れなかったら null。 */
  async function awayAndBack(roomId, cur, B, awaitId) {
    cur.close();
    await cur.waitClosed();
    const away = await B.waitState((s) => s.room.seats[0].away === true || !s.view.awaiting.some((a) => a.id === awaitId), 10_000, 'A away');
    if (!away.view.awaiting.some((a) => a.id === awaitId)) return { r: null, away };
    return { r: await rejoin(roomId, cur), away };
  }
  const deadlineOf = (st, awaitId) => st.deadlines.find((d) => d.awaitId === awaitId);

  it('代役から戻ったときは秒数いっぱい。「切断 → 代役 → その窓で復帰」を繰り返しても、延ばすのは1回だけで、待ちは進む', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 1500, rejoinMinMs: 2000, turnMs: 6000, respondMs: 4000, choiceMs: 4000 };
    const { roomId, B, A, target } = await room(timing);
    await testRoute(server.base, roomId, 'timing', { cpuDelayMs: 1200 });
    let cur = A;
    const lefts = [];
    let firstFull = null;
    for (let i = 0; i < 20; i++) {
      const { r } = await awayAndBack(roomId, cur, B, target.awaitId);
      if (r === null) break;
      cur = r.c;
      const d = deadlineOf(r.st, target.awaitId);
      if (d === undefined) break;
      expect(r.st.room.seats[0]).toMatchObject({ connected: true, away: false });
      lefts.push(d.at - r.st.serverTime);
      if (firstFull === null) firstFull = d.at;
    }
    // 1回目だけ秒数いっぱい。2回目以降は代役の期限（約 cpuDelayMs）のまま
    expect(lefts.length).toBeGreaterThanOrEqual(2);
    expect(lefts[0]).toBeGreaterThan(timing.turnMs - 300);
    for (const x of lefts.slice(1)) expect(x).toBeLessThanOrEqual(1200);
    const gone = await goneAt(B, target.awaitId);
    expect(gone.serverTime).toBeLessThan(firstFull + 2 * (timing.disconnectGraceMs + 1200) + 1000);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    cur.close();
    B.close();
  });

  it('猶予の中の復帰で延ばしたあとは、代役から戻っても期限を変えない', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 1500, rejoinMinMs: 3000, turnMs: 6000, respondMs: 4000, choiceMs: 4000 };
    const { roomId, A, B, target } = await room(timing);
    await testRoute(server.base, roomId, 'timing', { cpuDelayMs: 1200 });
    // 残りが rejoinMinMs より短くなってから、猶予の中で戻る → 延びる
    await sleep(Math.max(0, target.at - Date.now() - 2000));
    A.close();
    await A.waitClosed();
    const r1 = await rejoin(roomId, A);
    const d1 = deadlineOf(r1.st, target.awaitId);
    expect(d1.at).toBeGreaterThan(target.at);
    // 代役になってから戻る → 秒数いっぱいにはしない（代役の期限のまま）
    const { r: r2 } = await awayAndBack(roomId, r1.c, B, target.awaitId);
    expect(r2).not.toBe(null);
    const d2 = deadlineOf(r2.st, target.awaitId);
    expect(d2).toBeDefined();
    expect(d2.at - r2.st.serverTime).toBeLessThanOrEqual(1200);
    const gone = await goneAt(B, target.awaitId);
    expect(gone.serverTime - d2.at).toBeLessThan(EXPIRE_SLACK_MS);
    r2.c.close();
    B.close();
  });

  it('代役から戻って秒数いっぱいにしたあとは、猶予の中の復帰で延ばさない', async () => {
    const timing = { cpuDelayMs: 30, disconnectGraceMs: 1500, rejoinMinMs: 3000, turnMs: 6000, respondMs: 4000, choiceMs: 4000 };
    const { roomId, A, B, target } = await room(timing);
    await testRoute(server.base, roomId, 'timing', { cpuDelayMs: 1200 });
    const { r: r1 } = await awayAndBack(roomId, A, B, target.awaitId);
    expect(r1).not.toBe(null);
    const d1 = deadlineOf(r1.st, target.awaitId);
    expect(d1.at - r1.st.serverTime).toBeGreaterThan(timing.turnMs - 300);
    // 残りが rejoinMinMs より短くなってから、猶予の中で戻る → 延ばさない
    await sleep(Math.max(0, d1.at - r1.st.serverTime - 2000));
    r1.c.close();
    await r1.c.waitClosed();
    const r2 = await rejoin(roomId, r1.c);
    const d2 = deadlineOf(r2.st, target.awaitId);
    expect(d2).toBeDefined();
    expect(d2.at).toBe(d1.at);
    const gone = await goneAt(B, target.awaitId);
    expect(gone.serverTime - d1.at).toBeLessThan(EXPIRE_SLACK_MS);
    r2.c.close();
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

describe('代役の CPU が特権を使ったあとの延長の印（room.ts の runExpired → applyEngine → syncDeadlines を通す）', () => {
  it('延長済みの席が代役になり、期限が来て CPU が強奪を使い手番が作り直されても、本人が戻ったとき秒数いっぱいにならない', async () => {
    const timing = { cpuDelayMs: 20, disconnectGraceMs: 400, abilityMs: 30_000, turnMs: 20_000, exchangeMs: 15_000, respondMs: 10_000, choiceMs: 10_000 };
    const roomId = await createRoom(server.base, timing);
    const holder = new HolderClient(server.base, roomId, { name: 'H', stopOnAbility: true });
    await holder.connect();
    holder.hello();
    await holder.waitState((s) => s.seat === 0);
    const others = [];
    for (let i = 1; i <= 3; i++) {
      const c = new PassiveClient(server.base, roomId, { name: `P${i}` });
      await c.connect();
      c.hello();
      await c.waitState((s) => s.seat === i);
      others.push(c);
    }
    holder.send({ type: 'setConfig', mode: 'chofugo', rules: [], gameCount: null });
    await holder.waitState((s) => s.room.config.mode === 'chofugo', 5000, 'chofugo');
    holder.send({ type: 'start' });
    const P = others[0];
    const eventsOf = (c) => c.states.flatMap((x) => x.events);
    // 席0が大富豪になり、特権の選択が来たら強奪だけを選ぶ（CPU の決まりでは、最初の自分の手番で使う。decisions §5.9）
    await holder.waitFor(() => (holder.manual && holder.state.view.mine?.kind === 'abilitySelect' ? true : undefined), 150_000, 'ability select');
    holder.send({ type: 'action', action: { type: 'selectAbilities', awaitId: holder.state.view.mine.awaitId, abilities: ['steal'], confirm: true } });
    await holder.waitState((s) => s.view.mine?.kind !== 'abilitySelect', 10_000, 'confirmed');
    holder.resume();
    // 強奪を使える最初の手番で止まる
    const turn = await holder.waitFor(
      () => (holder.manual && holder.state.view.mine?.kind === 'turn' && holder.state.view.mine.abilities.some((u) => u.id === 'steal' && u.usable) ? holder.state : undefined),
      60_000,
      'turn with steal',
    );
    const turnId = turn.view.mine.awaitId;
    const gameNo = turn.view.gameNo;
    // 代役の操作を遅らせ、代役に切り替わってから CPU が操作するまでの窓で戻れるようにする
    const CPU = 4000;
    await testRoute(server.base, roomId, 'timing', { cpuDelayMs: CPU });
    const rejoinHolder = async (prev) => {
      const c = new HolderClient(server.base, roomId, { name: 'H', token: prev.token });
      c.manual = true;
      await c.connect();
      c.hello();
      const st = await c.waitState((x) => x.seat === 0 && x.eventsFull, 10_000, 'holder back');
      return { c, st };
    };
    // 1. 代役から戻る → 秒数いっぱい（この待ちの延長を使う）
    holder.close();
    await holder.waitClosed();
    await P.waitState((x) => x.room.seats[0].away === true, 10_000, 'away 1');
    const r1 = await rejoinHolder(holder);
    const d1 = r1.st.deadlines.find((d) => d.awaitId === turnId);
    expect(d1).toBeDefined();
    expect(d1.at - r1.st.serverTime).toBeGreaterThan(timing.turnMs - 500);
    // 2. もう一度代役になる → 期限（約 CPU ミリ秒後）が来て、代役の CPU が強奪を使う → 同じ手番が新しい番号で作り直される
    r1.c.close();
    await r1.c.waitClosed();
    await P.waitState((x) => x.room.seats[0].away === true, 10_000, 'away 2');
    await P.waitFor(() => eventsOf(P).find((e) => e.type === 'ability' && e.seat === 0 && e.ability === 'steal' && e.gameNo === gameNo), 15_000, 'cpu steal');
    const re = await P.waitState((x) => x.view.awaiting.some((a) => a.seat === 0 && a.kind === 'turn' && a.id !== turnId), 5000, 'recreated turn');
    const newId = re.view.awaiting.find((a) => a.seat === 0 && a.kind === 'turn').id;
    // 3. CPU がカードを出す前に戻る：印が引き継がれているので、秒数いっぱいにしない（代役の期限のまま）
    const r2 = await rejoinHolder(r1.c);
    const d2 = r2.st.deadlines.find((d) => d.awaitId === newId);
    expect(d2).toBeDefined();
    expect(d2.at - r2.st.serverTime).toBeLessThanOrEqual(CPU);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    r2.c.close();
    for (const c of others) c.close();
  }, 240_000);
});
