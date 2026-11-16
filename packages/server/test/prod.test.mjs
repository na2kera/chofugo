// テスト用の機能を有効にしない（CHOFUGO_TEST_MODE を渡さない、本番と同じ設定の）起動で、
// 秒数の差し替えとテスト用の経路が使えないこと、Origin・ルーム ID・本文の大きさの検査を確かめる。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRoom, startServer, PORTS } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.prod, testMode: false });
});
afterAll(async () => {
  await server?.stop();
});

const post = (path, body, headers = {}) => fetch(`${server.base}${path}`, { method: 'POST', body, headers });
const wsGet = (path, headers = {}) => fetch(`${server.base}${path}`, { headers });

describe('本番と同じ設定', () => {
  it('秒数の差し替えとテスト用の経路は使えない', async () => {
    expect((await post('/api/rooms', JSON.stringify({ timing: { turnMs: 100 } }))).status).toBe(400);
    const roomId = await createRoom(server.base);
    for (const name of ['alarm', 'replay', 'instance', 'check', 'oldformat']) {
      expect((await post(`/api/rooms/${roomId}/test/${name}`)).status).toBe(404);
    }
  });

  // scheme だけ違う Origin は、wrangler dev のプロキシが自分のホストの Origin の scheme を書き換えて届けるため、
  // 開発サーバー越しには試せない。比較の関数の単体テスト（origin.test.mjs）で確かめる。
  it('別サイトの Origin、ポートだけ違う Origin、不正なルーム ID を拒否する', async () => {
    const roomId = await createRoom(server.base);
    const other = { Origin: 'https://evil.example' };
    const scheme = { Origin: server.base.replace(/:\d+$/, ':9') };
    const same = { Origin: server.base };
    expect((await post('/api/rooms', '{}', other)).status).toBe(403);
    expect((await post('/api/rooms', '{}', scheme)).status).toBe(403);
    expect((await post('/api/rooms', '{}', same)).status).toBe(201);
    expect((await wsGet(`/api/rooms/${roomId}/ws`, other)).status).toBe(403);
    expect((await wsGet(`/api/rooms/${roomId}/ws`, scheme)).status).toBe(403);
    // 同じ Origin なら Origin の検査は通る（WebSocket でないので 426）
    expect((await wsGet(`/api/rooms/${roomId}/ws`, same)).status).toBe(426);
    expect((await wsGet('/api/rooms/short/ws')).status).toBe(404);
    expect((await wsGet('/api/rooms/AAAAAAAAAAAAAAAAAAAAA!/ws')).status).toBe(404);
    // 形は正しいが作られていないルームには接続できない
    const ws = new WebSocket(`${server.base.replace('http', 'ws')}/api/rooms/AAAAAAAAAAAAAAAAAAAAAA/ws`);
    await expect(new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = () => rej(new Error('rejected')))))).rejects.toThrow();
  });

  it('大きすぎる本文は上限で読むのをやめて 413 を返す', async () => {
    expect((await post('/api/rooms', 'x'.repeat(3000))).status).toBe(413);
    // Content-Length のない分割送信でも同じ
    const chunk = new TextEncoder().encode('x'.repeat(1000));
    let n = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (n++ < 100) c.enqueue(chunk);
        else c.close();
      },
    });
    const r = await fetch(`${server.base}/api/rooms`, { method: 'POST', body: stream, duplex: 'half' });
    expect(r.status).toBe(413);
    // 上限以内は通る
    expect((await post('/api/rooms', '{}')).status).toBe(201);
  });
});
