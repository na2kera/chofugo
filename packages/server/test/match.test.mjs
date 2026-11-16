// 4人で1試合（5ゲーム）を最後まで進める。拒否されるべき操作と、手札の漏れも確かめる。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, checkNoLeak, createRoom, deadlineProblems, joinAll, startServer, PORTS } from './helpers.mjs';

const ALL8 = ['flush_on_8', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'runs', 'forbidden_finish', 'dethrone'];

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.match });
});
afterAll(async () => {
  await server?.stop();
});

describe('4人で1試合', () => {
  it('ロビー → 開始 → 5ゲーム → 試合の結果 → もう一度', async () => {
    const roomId = await createRoom(server.base);
    const clients = [0, 1, 2, 3].map((i) => new Client(server.base, roomId, { name: `P${i}`, autoHost: true }));
    await joinAll(clients);
    const [host, p1, p2, p3] = clients;
    expect(clients.map((c) => c.state.seat)).toEqual([0, 1, 2, 3]);
    expect(host.state.isHost).toBe(true);
    expect(host.state.room.config.rules).toEqual(['flush_on_8', 'revolution', 'spade3_beats_joker', 'runs', 'dethrone']);
    expect(host.state.room.config.gameCount).toBe(5);

    // 5人目は満員で入れない
    const fifth = new Client(server.base, roomId, { name: 'P4' });
    await fifth.connect();
    await fifth.waitState(() => true);
    expect(fifth.state.seat).toBe(null);
    expect(fifth.state.room.seats.map((s) => s.name)).toEqual(['P0', 'P1', 'P2', 'P3']);
    const r5 = fifth.hello();
    expect((await fifth.waitError(r5)).code).toBe('roomFull');
    expect((await fifth.waitClosed()).code).toBe(4002);

    // ホスト以外のホスト操作
    expect((await p1.waitError(p1.send({ type: 'setConfig', mode: 'daifugo', rules: ALL8, gameCount: 5 }))).code).toBe('notHost');
    expect((await p1.waitError(p1.send({ type: 'start' }))).code).toBe('notHost');
    // 壊れたメッセージ
    expect((await p2.waitError(p2.send({ type: 'setConfig', mode: 'daifugo', rules: ['nope'], gameCount: 5 }))).code).toBe('badMessage');
    p2.sendRaw('{not json');
    p2.sendRaw(JSON.stringify({ type: 'action', matchId: 'm', action: { type: 'play', awaitId: 1, cards: ['spade-3'], extra: 1 }, reqId: 900 }));
    p2.sendRaw(JSON.stringify({ type: 'hello', token: 'short', name: 'x', reqId: 901 }));
    p2.sendRaw(JSON.stringify({ type: 'hello', token: p2.token, name: '\u0000bad', reqId: 902 }));
    p2.sendRaw(JSON.stringify({ type: 'action', matchId: 'm', action: { type: 'pass', awaitId: 1.5 }, reqId: 903 }));
    p2.sendRaw(JSON.stringify({ type: 'action', matchId: 'm', action: { type: 'play', awaitId: 1, cards: ['spade-3', 'spade-3'] }, reqId: 904 }));
    // matchId のない試合への操作
    p2.sendRaw(JSON.stringify({ type: 'action', action: { type: 'pass', awaitId: 1 }, reqId: 905 }));
    p2.sendRaw(JSON.stringify({ type: 'nextGame', reqId: 906 }));
    p2.sendRaw('x'.repeat(5000));
    p2.ws.send(new Uint8Array([1, 2, 3]));
    for (const id of [900, 901, 902, 903, 904, 905, 906]) expect((await p2.waitError(id)).code).toBe('badMessage');
    await p2.waitFor(() => (p2.errors.filter((e) => e.code === 'tooLarge').length === 1 ? true : undefined), 5000, 'tooLarge');
    await p2.waitFor(() => (p2.errors.filter((e) => e.reqId === null && e.code === 'badMessage').length >= 2 ? true : undefined), 5000, 'binary+json');
    // 2回目の hello、試合前の操作
    expect((await p3.waitError(p3.hello())).code).toBe('alreadyJoined');
    expect((await p3.waitError(p3.send({ type: 'action', matchId: 'nomatch', action: { type: 'pass', awaitId: 1 } }))).code).toBe('wrongPhase');
    // 設定の誤り（前提のルールはその1にはないので、知らない組み合わせはない。ゲーム数の誤りは形の検査で落ちる）
    expect((await host.waitError(host.send({ type: 'setConfig', mode: 'daifugo', rules: ALL8, gameCount: 7 }))).code).toBe('badMessage');

    // ルール8種を ON にして開始
    host.send({ type: 'setConfig', mode: 'daifugo', rules: ALL8, gameCount: 5 });
    await p3.waitState((s) => s.room.config.rules.length === 8);
    for (const c of clients) c.auto = true;
    host.send({ type: 'start' });
    await host.waitState((s) => s.matchPhase !== null);
    const matchId = host.state.matchId;
    expect(typeof matchId).toBe('string');
    // 開始後は設定を変えられない
    expect((await host.waitError(host.send({ type: 'setConfig', mode: 'daifugo', rules: [], gameCount: 5 }))).code).toBe('wrongPhase');
    // 試合中の参加はできない
    const late = new Client(server.base, roomId, { name: 'late' });
    await late.connect();
    expect((await late.waitError(late.hello())).code).toBe('cannotJoin');

    await Promise.all(clients.map((c) => c.waitState((s) => s.matchPhase === 'matchResult', 120_000, 'matchResult')));
    const view = host.state.view;
    expect(view.results.length).toBe(5);
    expect(view.standings.length).toBe(4);
    for (const r of view.results) expect(r.deltas.reduce((a, b) => a + b, 0)).toBe(0);
    expect(host.state.room.phase).toBe('finished');
    // 自動で選んだ操作が engine に拒否されていない
    for (const c of clients) expect(c.rejectedOwn).toEqual([]);
    // 他人の手札が届いていない
    expect(checkNoLeak(clients)).toEqual([]);
    // 一時停止中でなければ、すべての待ちに期限があった（design-2 §3.4）
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    // 外へ出す設定にモードが入る
    expect(host.state.room.config.mode).toBe('daifugo');
    // 出来事の通し番号は重複しない
    for (const c of clients) {
      const seqs = c.states.filter((s) => !s.eventsFull && s.matchId === matchId).flatMap((s) => s.events.map((e) => e.seq));
      expect(new Set(seqs).size).toBe(seqs.length);
    }

    // 回数つきの試合は endMatch できない。ホスト以外は rematch できない
    expect((await host.waitError(host.send({ type: 'endMatch' }))).code).toBe('actionRejected');
    expect((await p1.waitError(p1.send({ type: 'rematch' }))).code).toBe('notHost');
    for (const c of clients) c.auto = false;
    host.send({ type: 'rematch' });
    await Promise.all(clients.map((c) => c.waitState((s) => s.matchId !== matchId && s.matchPhase === 'play')));
    expect(host.state.view.scores).toEqual([0, 0, 0, 0]);
    expect(host.state.view.gameNo).toBe(1);
    expect(host.state.eventsFull).toBe(false);
    expect(host.state.events[0].type).toBe('gameStart');

    // 他人の待ち・古い待ち番号は拒否される
    const awaited = host.state.view.awaiting[0];
    const owner = clients[awaited.seat];
    const other = clients[(awaited.seat + 1) % 4];
    const e1 = await other.waitError(other.send({ type: 'action', action: { type: 'pass', awaitId: awaited.id } }));
    expect([e1.code, e1.engineError]).toEqual(['actionRejected', 'notYourAwait']);
    const e2 = await owner.waitError(owner.send({ type: 'action', action: { type: 'pass', awaitId: awaited.id + 1000 } }));
    expect([e2.code, e2.engineError]).toEqual(['actionRejected', 'staleAwait']);
    // ホスト以外は次のゲームを配れない
    expect((await p1.waitError(p1.send({ type: 'nextGame' }))).code).toBe('notHost');
    // rematch をまたいだ古い操作：待ち番号は新しい試合でも有効な番号だが、前の試合の matchId なので拒否される
    const eOld = await owner.waitError(owner.send({ type: 'action', matchId, action: { type: 'pass', awaitId: awaited.id } }));
    expect(eOld.code).toBe('staleMatch');
    expect(host.state.view.awaiting.some((a) => a.id === awaited.id)).toBe(true);
    expect((await host.waitError(host.send({ type: 'nextGame', matchId }))).code).toBe('staleMatch');
    expect((await host.waitError(host.send({ type: 'rematch', matchId }))).code).toBe('staleMatch');

    for (const c of [...clients, fifth, late]) c.close();
  });
});
