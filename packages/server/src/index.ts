// Worker の入口（design §4.1）。/api/* だけを扱う。静的ファイル（client）は client を作る段階で assets として足す。
//
//   POST /api/rooms            ルームを作る → 201 { roomId }
//   GET  /api/rooms/:id/ws     WebSocket（作られていないルームは 404）
//
// テストのときだけ（開発サーバーに --var CHOFUGO_TEST_MODE:1 を渡したとき）:
//   POST /api/rooms の本文に { "timing": { ... } } を付けて秒数を差し替えられる
//   POST /api/rooms/:id/test/alarm でアラームの処理をいま実行する（2回鳴った場合の確認）
//   POST /api/rooms/:id/test/replay で操作の記録から試合を再現し、保存された状態と一致するかを返す

import { DEFAULT_TIMING, parseTimingOverride, type Timing } from './timing.ts';
import type { CreateRoomResponse } from './protocol.ts';

export { Room } from './room.ts';

const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** テスト用の機能を有効にするか。wrangler.jsonc の vars には入れない（デプロイされるため）。 */
function isTestMode(env: Env): boolean {
  return (env as unknown as Record<string, unknown>)['CHOFUGO_TEST_MODE'] === '1';
}

function newRoomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Origin があれば、自分のサイト（同じホスト）であることを確かめる。ブラウザ以外は Origin を付けないことがあるので、無ければ通す。 */
function originAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let timing: Timing = { ...DEFAULT_TIMING };
  const text = await request.text();
  if (text.length > 2048) return json({ error: 'body too large' }, 413);
  if (text.trim() !== '') {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'body must be an object' }, 400);
    const keys = Object.keys(body);
    if (keys.length > 0) {
      // 秒数の差し替えはテストのときだけ受け付ける
      if (!isTestMode(env) || keys.some((k) => k !== 'timing')) return json({ error: 'unknown fields' }, 400);
      const t = parseTimingOverride((body as Record<string, unknown>)['timing']);
      if (t === null) return json({ error: 'invalid timing' }, 400);
      timing = t;
    }
  }
  for (let i = 0; i < 3; i++) {
    const roomId = newRoomId();
    const stub = env.ROOM.getByName(roomId);
    if (await stub.create(roomId, timing)) {
      const res: CreateRoomResponse = { roomId };
      return json(res, 201);
    }
  }
  return json({ error: 'could not create a room' }, 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/api/rooms') {
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        if (!originAllowed(request, url)) return json({ error: 'forbidden origin' }, 403);
        return await createRoom(request, env);
      }
      const m = /^\/api\/rooms\/([^/]+)\/(ws|test\/alarm|test\/replay)$/.exec(path);
      if (m !== null) {
        const roomId = m[1] ?? '';
        if (!ROOM_ID_RE.test(roomId)) return json({ error: 'room not found' }, 404);
        const stub = env.ROOM.getByName(roomId);
        if (m[2] === 'ws') {
          if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
          if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket' }, 426);
          if (!originAllowed(request, url)) return json({ error: 'forbidden origin' }, 403);
          return await stub.fetch(request);
        }
        if (!isTestMode(env) || request.method !== 'POST') return json({ error: 'not found' }, 404);
        if (m[2] === 'test/replay') return json(await stub.replayCheck());
        const version = await stub.runAlarmNow();
        return json({ version });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error('worker failed', e);
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
