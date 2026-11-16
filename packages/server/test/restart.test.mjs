// 開発サーバーを止めて起動し直しても（メモリ上の状態がすべて消えても）、保存した状態から続きを進められる。
// あわせて、操作の記録から試合を再現できることを確かめる。

import { afterAll, describe, expect, it } from 'vitest';
import { Client, checkNoLeak, createRoom, joinAll, sleep, startServer } from './helpers.mjs';

const PORT = 8804;
let server;
afterAll(async () => {
  await server?.stop();
});

async function replay(roomId) {
  const r = await fetch(`${server.base}/api/rooms/${roomId}/test/replay`, { method: 'POST' });
  return r.json();
}

describe('再起動', () => {
  it('試合の途中で開発サーバーを再起動しても続きから最後まで進む', async () => {
    server = await startServer({ port: PORT });
    const roomId = await createRoom(server.base, { cpuDelayMs: 30 });
    const clients = [0, 1, 2, 3].map((i) => new Client(server.base, roomId, { name: `P${i}`, autoHost: true, actDelay: 5 }));
    await joinAll(clients);
    for (const c of clients) c.auto = true;
    clients[0].send({ type: 'start' });
    // 2ゲーム目の途中まで進める
    await clients[0].waitState((s) => s.view?.gameNo === 2 && s.matchPhase === 'play', 60_000);
    for (const c of clients) c.auto = false;
    await sleep(300);
    const before = clients[0].state;
    expect(await replay(roomId)).toMatchObject({ ok: true });

    // サーバーを止める（DO のメモリ・接続はすべて消える）
    const dir = server.persistDir;
    await server.stop({ keep: true });
    await Promise.all(clients.map((c) => c.waitClosed(10_000)));
    server = await startServer({ port: PORT, persistDir: dir });

    // 同じ本人確認の値でつなぎ直す
    const again = clients.map((c, i) => new Client(server.base, roomId, { name: `again${i}`, token: c.token, autoHost: true, actDelay: 5 }));
    for (const c of again) {
      await c.connect();
      c.hello();
    }
    await Promise.all(again.map((c) => c.waitState((s) => s.seat !== null)));
    // 復帰して最初に届いた state（現在のゲームの出来事を最初からすべて含む）
    const states = again.map((c) => c.states.find((s) => s.seat !== null));
    expect(states.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    for (const s of states) {
      expect(s.matchId).toBe(before.matchId);
      expect(s.version).toBeGreaterThan(before.version);
      expect(s.eventsFull).toBe(true);
      expect(s.view.gameNo).toBe(2);
      expect(s.room.seats.map((x) => x.name)).toEqual(['P0', 'P1', 'P2', 'P3']);
    }
    expect(states[0].view.scores).toEqual(before.view.scores);
    // 残りを最後まで進める
    for (const c of again) {
      c.auto = true;
      c.maybeAct();
    }
    await Promise.all(again.map((c) => c.waitState((s) => s.matchPhase === 'matchResult', 120_000)));
    expect(again[0].state.view.results.length).toBe(5);
    for (const c of again) expect(c.rejectedOwn).toEqual([]);
    expect(await replay(roomId)).toMatchObject({ ok: true });
    // 復帰時に最初から送り直した出来事（交換を含む）にも、他人の手札が含まれていない
    expect(checkNoLeak(again)).toEqual([]);
    expect(again.every((c) => c.states.some((s) => s.eventsFull && s.events.some((e) => e.type === 'exchange')))).toBe(true);
    for (const c of again) c.close();
  });
});
