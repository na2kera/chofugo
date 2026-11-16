// その2（カスタムモード）：設定の直し方、16種すべて ON の通しの試合、保存の形式の番号（design-2 §3.5、§6.5）。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, checkNoLeak, createRoom, deadlineProblems, joinAll, startServer, testRoute, PORTS } from './helpers.mjs';

// engine の ALL_RULE_IDS の順
const ALL16 = [
  'flush_on_8',
  'block_flush_with_4',
  'revolution',
  'temp_reverse_on_j',
  'spade3_beats_joker',
  'suit_lock',
  'sequence_lock',
  'runs',
  'forbidden_finish',
  'dethrone',
  'diamond3_start',
  'triple3_trump',
  'give_on_7',
  'reverse_order_on_9',
  'discard_on_10',
  'skip_on_k',
];
const DAIFUGO8 = ['flush_on_8', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'runs', 'forbidden_finish', 'dethrone'];

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.custom });
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

/** setConfig を送り、直した結果（room.config）が届くのを待つ。 */
async function config(host, other, msg, expected) {
  host.send({ type: 'setConfig', ...msg });
  const want = JSON.stringify(expected);
  await other.waitState((s) => JSON.stringify(s.room.config) === want, 5000, `config ${want}`);
  return other.state.room.config;
}

describe('設定の直し方（design-2 §3.1、§6.5）', () => {
  it('形を確かめてから、中身を直して保存する', async () => {
    const roomId = await createRoom(server.base);
    const host = await seated(roomId, 'host');
    const guest = await seated(roomId, 'guest');
    // 初期値は大富豪モード
    expect(guest.state.room.config).toEqual({ mode: 'daifugo', rules: ['flush_on_8', 'revolution', 'spade3_beats_joker', 'runs', 'dethrone'], gameCount: 5 });

    // 大富豪モードで応用のルールを送ると、応用のルールは外れる
    await config(host, guest, { mode: 'daifugo', rules: ['give_on_7', 'flush_on_8', 'skip_on_k', 'runs'], gameCount: 5 }, { mode: 'daifugo', rules: ['flush_on_8', 'runs'], gameCount: 5 });
    // カスタムで8切りなしの4止めを送ると、4止めは外れる
    await config(host, guest, { mode: 'custom', rules: ['block_flush_with_4', 'give_on_7'], gameCount: 10 }, { mode: 'custom', rules: ['give_on_7'], gameCount: 10 });
    // 8切りがあれば4止めは残る。並びは ALL_RULE_IDS の順に直る
    await config(host, guest, { mode: 'custom', rules: [...ALL16].reverse(), gameCount: null }, { mode: 'custom', rules: ALL16, gameCount: null });
    // カスタムから大富豪へ切り替えると、応用のルールは外れる
    await config(host, guest, { mode: 'daifugo', rules: ALL16, gameCount: null }, { mode: 'daifugo', rules: DAIFUGO8, gameCount: null });

    // 形の違う値は、その1と同じく拒否する（保存は変わらない）
    const before = JSON.stringify(guest.state.room.config);
    const bad = [
      { type: 'setConfig', mode: 'super', rules: [], gameCount: 5 }, // 知らないモード
      { type: 'setConfig', rules: [], gameCount: 5 }, // モードがない
      { type: 'setConfig', mode: 'custom', rules: 'flush_on_8', gameCount: 5 }, // 配列でない
      { type: 'setConfig', mode: 'custom', rules: [8], gameCount: 5 }, // 型の違う値
      { type: 'setConfig', mode: 'custom', rules: ['nope'], gameCount: 5 }, // 知らないルール
      { type: 'setConfig', mode: 'custom', rules: ['runs', 'runs'], gameCount: 5 }, // 重複
      { type: 'setConfig', mode: 'custom', rules: [], gameCount: '5' }, // 型の違うゲーム数
      { type: 'setConfig', mode: 1, rules: [], gameCount: 5 },
      { type: 'setConfig', mode: 'custom', rules: [], gameCount: 5, extra: true },
    ];
    for (const m of bad) expect((await host.waitError(host.send(m))).code).toBe('badMessage');
    // ホスト以外は、形が正しくても notHost
    expect((await guest.waitError(guest.send({ type: 'setConfig', mode: 'custom', rules: ALL16, gameCount: 5 }))).code).toBe('notHost');
    expect(JSON.stringify(host.state.room.config)).toBe(before);
    host.close();
    guest.close();
  });
});

describe('16種すべて ON（カスタムモード）', () => {
  it('4接続で1試合を最後まで進める', async () => {
    const roomId = await createRoom(server.base, { cpuDelayMs: 20 });
    const clients = [0, 1, 2, 3].map((i) => new Client(server.base, roomId, { name: `P${i}`, autoHost: true }));
    await joinAll(clients);
    const [host] = clients;
    await config(host, clients[3], { mode: 'custom', rules: ALL16, gameCount: 5 }, { mode: 'custom', rules: ALL16, gameCount: 5 });
    for (const c of clients) c.auto = true;
    host.send({ type: 'start' });
    await Promise.all(clients.map((c) => c.waitState((s) => s.matchPhase === 'matchResult', 170_000, 'matchResult')));
    expect(host.state.view.results.length).toBe(5);
    expect(host.state.view.rules).toEqual(ALL16);
    expect(host.state.room.config).toEqual({ mode: 'custom', rules: ALL16, gameCount: 5 });
    for (const r of host.state.view.results) expect(r.deltas.reduce((a, b) => a + b, 0)).toBe(0);
    // 自動で選んだ操作（choose を含む）が engine に拒否されていない
    for (const c of clients) expect(c.rejectedOwn).toEqual([]);
    // 7渡し・10捨ての選択が起きている（5ゲームで7か10が組で出ないことはまずない）
    const events = host.states.flatMap((s) => s.events);
    expect(events.some((e) => e.type === 'choiceStart')).toBe(true);
    // 7渡しの中身は当事者だけ、手札の漏れなし
    expect(checkNoLeak(clients)).toEqual([]);
    for (const c of clients) {
      for (const e of c.states.flatMap((s) => s.events)) {
        if (e.type !== 'give') continue;
        const party = e.from === c.state.seat || e.to === c.state.seat;
        expect(e.cards === null).toBe(!party);
        expect(e.count).toBeGreaterThan(0);
        if (party) expect(e.cards.length).toBe(e.count);
      }
    }
    // 期限の検査と、操作の記録からの再現
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    expect(await testRoute(server.base, roomId, 'replay')).toMatchObject({ ok: true });
    for (const c of clients) c.close();
  });
});

describe('保存の形式の番号（design-2 §3.3）', () => {
  /** 試合を始め、操作の記録とアラームが保存されるまで進める（消えたことを確かめる前に、残っていることを確かめるため）。 */
  async function playingRoom() {
    const roomId = await createRoom(server.base, { cpuDelayMs: 20, turnMs: 60_000, exchangeMs: 60_000 });
    const A = await seated(roomId, 'A', { auto: true });
    A.send({ type: 'start' });
    await A.waitState((s) => s.matchPhase === 'play', 10_000, 'started');
    // CPU（と A）の操作が1つ以上記録され、期限のアラームがある
    for (let i = 0; i < 100; i++) {
      const st = await testRoute(server.base, roomId, 'storage');
      if (st.actions > 0 && st.alarm !== null) return { roomId, A, before: st };
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('actions were not logged');
  }
  const gone = { room: false, actions: 0, keys: 0, alarm: null };

  it('形式の番号が違う保存済みのルームには再接続できず、保存（ルームの値・操作の記録）とアラームは消える', async () => {
    const { roomId, A, before } = await playingRoom();
    expect(before).toMatchObject({ room: true });
    expect(before.actions).toBeGreaterThan(0);
    expect(before.alarm).toBeTypeOf('number');
    expect(await testRoute(server.base, roomId, 'oldformat')).toEqual({ ok: true });
    // 書き換えただけでは、まだ消えていない
    expect((await testRoute(server.base, roomId, 'storage')).room).toBe(true);
    // 開いていた接続からのメッセージ：ルームを閉じる
    A.send({ type: 'nextGame' });
    expect((await A.waitClosed(5000)).code).toBe(4003);
    expect(await testRoute(server.base, roomId, 'storage')).toEqual(gone);
    // 同じ本人確認の値でつなぎ直しても入れない（作られていないルームと同じ 404）
    const again = new Client(server.base, roomId, { name: 'A', token: A.token });
    await expect(again.connect()).rejects.toThrow();
    expect(await testRoute(server.base, roomId, 'storage')).toEqual(gone);
  });

  it('接続のない古い形式のルームも、新しい接続の時点で閉じ、保存とアラームは消える', async () => {
    const { roomId, A } = await playingRoom();
    A.close();
    await A.waitClosed(5000);
    expect(await testRoute(server.base, roomId, 'oldformat')).toEqual({ ok: true });
    expect((await testRoute(server.base, roomId, 'storage')).room).toBe(true);
    const again = new Client(server.base, roomId, { name: 'A', token: A.token });
    await expect(again.connect()).rejects.toThrow();
    expect(await testRoute(server.base, roomId, 'storage')).toEqual(gone);
  });
});
