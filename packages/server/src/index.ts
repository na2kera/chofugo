// Worker の入口（design §4.1）。/api/* だけを扱う。静的ファイル（client）は client を作る段階で assets として足す。
//
//   POST /api/rooms            ルームを作る → 201 { roomId }
//   GET  /api/rooms/:id/ws     WebSocket（作られていないルームは 404）
//
// テストのときだけ（開発サーバーに --var CHOFUGO_TEST_MODE:1 を渡したとき）:
//   POST /api/rooms の本文に { "timing": { ... } } を付けて秒数を差し替えられる
//   POST /api/rooms/:id/test/alarm でアラームの処理をいま実行する（2回鳴った場合の確認）
//   POST /api/rooms/:id/test/replay で操作の記録から試合を再現し、保存された状態と一致するかを返す
//   POST /api/rooms/:id/test/instance で Durable Object のインスタンスの識別子を返す（休止から作り直されたかの確認）
//   POST /api/rooms/:id/test/check で期限についての検査（design-2 §3.4）で見つかった問題の一覧を返す
//   POST /api/rooms/:id/test/oldformat で保存している値を古い形式の番号に書き換える（更新をまたいだルームの再現）

import { DEFAULT_TIMING, parseTimingOverride, type Timing } from './timing.ts';
import type { CreateRoomResponse } from './protocol.ts';
import { originAllowed } from './origin.ts';

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

const MAX_BODY_BYTES = 2048;

/** 本文を上限つきで読む。上限を超えた時点で読むのをやめて null を返す（Content-Length だけには頼らない）。 */
async function readBodyLimited(request: Request, limit: number): Promise<string | null> {
  const len = request.headers.get('Content-Length');
  if (len !== null && Number(len) > limit) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    buf.set(c, pos);
    pos += c.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    return '\u0000invalid';
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let timing: Timing = { ...DEFAULT_TIMING };
  const text = await readBodyLimited(request, MAX_BODY_BYTES);
  if (text === null) return json({ error: 'body too large' }, 413);
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
        if (!originAllowed(request.headers.get('Origin'), url)) return json({ error: 'forbidden origin' }, 403);
        return await createRoom(request, env);
      }
      const m = /^\/api\/rooms\/([^/]+)\/(ws|test\/alarm|test\/replay|test\/instance|test\/check|test\/oldformat)$/.exec(path);
      if (m !== null) {
        const roomId = m[1] ?? '';
        if (!ROOM_ID_RE.test(roomId)) return json({ error: 'room not found' }, 404);
        const stub = env.ROOM.getByName(roomId);
        if (m[2] === 'ws') {
          if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
          if (!originAllowed(request.headers.get('Origin'), url)) return json({ error: 'forbidden origin' }, 403);
          if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket' }, 426);
          return await stub.fetch(request);
        }
        if (!isTestMode(env) || request.method !== 'POST') return json({ error: 'not found' }, 404);
        if (m[2] === 'test/replay') return json(await stub.replayCheck());
        if (m[2] === 'test/instance') return json({ instance: await stub.instance() });
        if (m[2] === 'test/check') return json({ problems: await stub.problems() });
        if (m[2] === 'test/oldformat') return json({ ok: await stub.makeOldFormat() });
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
