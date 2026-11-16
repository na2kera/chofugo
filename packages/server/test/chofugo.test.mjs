// その3（超富豪モード）：設定、4接続の通しの試合と「もう一度」、人間の特権と期限、選択の途中の保存と時間切れ、
// 選択の途中の切断と代役・復帰・全員不在からの再開（design-3 §3.4、§6.1、§6.2、§6.5、§6.6、§6.8）。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ABILITIES, Client, HolderClient, PassiveClient, checkNoLeak, createRoom, deadlineProblems, startServer, testRoute, PORTS } from './helpers.mjs';

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

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.chofugo });
});
afterAll(async () => {
  await server?.stop();
});

const eventsOf = (c) => c.states.flatMap((s) => s.events);

async function join(c) {
  await c.connect();
  c.hello();
  await c.waitState((s) => s.seat !== null);
  return c;
}

/** 超富豪モードにして、直った設定が届くのを待つ。 */
async function setChofugo(host, gameCount) {
  host.send({ type: 'setConfig', mode: 'chofugo', rules: [], gameCount });
  await host.waitState((s) => s.room.config.mode === 'chofugo' && s.room.config.gameCount === gameCount, 5000, 'chofugo config');
}

/** 席0を大富豪にする部屋（席0 = HolderClient、席1〜3 = 受け身の人間）。 */
async function holderRoom(timing, holderOpts = {}) {
  const roomId = await createRoom(server.base, timing);
  const holder = await join(new HolderClient(server.base, roomId, { name: 'H', ...holderOpts }));
  const others = [];
  for (let i = 1; i <= 3; i++) others.push(await join(new PassiveClient(server.base, roomId, { name: `P${i}` })));
  await setChofugo(holder, null);
  holder.send({ type: 'start' });
  return { roomId, holder, others, all: [holder, ...others] };
}

describe('設定（design-3 §3.1）', () => {
  it('chofugo の setConfig で、ルールが16種すべてに直る', async () => {
    const roomId = await createRoom(server.base);
    const host = await join(new Client(server.base, roomId, { name: 'host' }));
    const guest = await join(new Client(server.base, roomId, { name: 'guest' }));
    host.send({ type: 'setConfig', mode: 'chofugo', rules: ['runs'], gameCount: 10 });
    await guest.waitState((s) => s.room.config.mode === 'chofugo');
    expect(guest.state.room.config).toEqual({ mode: 'chofugo', rules: ALL16, gameCount: 10 });
    // 送られたルールは使わない（空でも16種）
    host.send({ type: 'setConfig', mode: 'chofugo', rules: [], gameCount: 5 });
    await guest.waitState((s) => s.room.config.gameCount === 5);
    expect(guest.state.room.config.rules).toEqual(ALL16);
    // 大富豪モードへ戻すと、その2と同じく直る
    host.send({ type: 'setConfig', mode: 'daifugo', rules: ALL16, gameCount: 5 });
    await guest.waitState((s) => s.room.config.mode === 'daifugo');
    expect(guest.state.room.config.rules).toEqual(['flush_on_8', 'revolution', 'temp_reverse_on_j', 'spade3_beats_joker', 'suit_lock', 'runs', 'forbidden_finish', 'dethrone']);
    // 形の誤り
    for (const m of [
      { type: 'action', matchId: 'x', action: { type: 'selectAbilities', awaitId: 1, abilities: 'peek', confirm: true } },
      { type: 'action', matchId: 'x', action: { type: 'selectAbilities', awaitId: 1, abilities: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], confirm: true } },
      { type: 'action', matchId: 'x', action: { type: 'selectAbilities', awaitId: 1, abilities: [1], confirm: true } },
      { type: 'action', matchId: 'x', action: { type: 'selectAbilities', awaitId: 1, abilities: [], confirm: 'yes' } },
      { type: 'action', matchId: 'x', action: { type: 'useAbility', awaitId: 1, ability: 'peek', target: 4 } },
      { type: 'action', matchId: 'x', action: { type: 'useAbility', awaitId: 1, ability: 'ban', rank: 2 } },
      { type: 'action', matchId: 'x', action: { type: 'useAbility', awaitId: 1, ability: 'ban', rank: 7.5 } },
      { type: 'action', matchId: 'x', action: { type: 'useAbility', awaitId: 1, ability: 'steal', target: 1, card: 'spade-16' } },
      { type: 'action', matchId: 'x', action: { type: 'useAbility', awaitId: 1, ability: 7 } },
      { type: 'action', matchId: 'x', action: { type: 'useAbility', awaitId: 1, ability: 'peek', extra: 1 } },
      { type: 'action', matchId: 'x', action: { type: 'play', awaitId: 1, cards: ['spade-3'], withSkip: 1 } },
    ]) {
      expect((await host.waitError(host.send(m))).code).toBe('badMessage');
    }
    host.close();
    guest.close();
  });
});

describe('超富豪モードの通しの試合', () => {
  it('4接続で最後まで進め（特権の選択と使用を含む）、「もう一度」のあとも超富豪モードで2ゲーム目に特権の選択が出る', async () => {
    const roomId = await createRoom(server.base, { cpuDelayMs: 20 });
    const clients = [0, 1, 2, 3].map((i) => new Client(server.base, roomId, { name: `P${i}`, autoHost: true }));
    for (const c of clients) await join(c);
    const [host] = clients;
    await setChofugo(host, 5);
    for (const c of clients) c.auto = true;
    host.send({ type: 'start' });
    await Promise.all(clients.map((c) => c.waitState((s) => s.matchPhase === 'matchResult', 170_000, 'matchResult')));
    expect(host.state.view.results.length).toBe(5);
    expect(host.state.view.rules).toEqual(ALL16);
    for (const c of clients) expect(c.rejectedOwn).toEqual([]);

    const events = eventsOf(host);
    // 1ゲーム目には特権がない。2ゲーム目以降は毎ゲーム、選択が始まる（1位が都落ちしない限り）
    expect(events.some((e) => e.type === 'abilitySelectStart' && e.gameNo === 1)).toBe(false);
    const starts = events.filter((e) => e.type === 'abilitySelectStart');
    expect(starts.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'abilitiesChosen').length).toBe(starts.length);
    expect(events.some((e) => e.type === 'ability')).toBe(true);
    // 1種類が同じゲームで2回使われない
    const used = new Set();
    for (const e of events.filter((x) => x.type === 'ability')) {
      const k = `${e.gameNo}:${e.ability}`;
      expect(used.has(k)).toBe(false);
      used.add(k);
      expect(ALL_ABILITIES).toContain(e.ability);
    }
    // 見える情報：選んだ種類は本人だけ。透視・強奪の中身は当事者だけ。手札の漏れなし
    for (const c of clients) {
      const me = c.state.seat;
      for (const e of eventsOf(c)) {
        if (e.type === 'abilitiesChosen') expect(e.abilities === null).toBe(e.seat !== me);
      }
      for (const st of c.states) {
        const g = st.view?.game;
        if (!g) continue;
        if (g.abilities === null || g.abilities.holder !== me) {
          expect(g.myAbilities).toBe(null);
          expect(g.peek).toBe(null);
          const mine = st.view.mine;
          if (mine?.kind === 'turn') {
            expect(mine.abilities).toEqual([]);
            expect(mine.skipAvailable).toBe(false);
            expect(mine.plays.some((p) => p.canSkip)).toBe(false);
          }
        }
        if (g.peek === null || g.abilities?.holder !== me) continue;
        expect(g.peek.target).not.toBe(me);
      }
    }
    expect(checkNoLeak(clients)).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    expect(await testRoute(server.base, roomId, 'replay')).toMatchObject({ ok: true });

    // 同じメンバーでもう一度：超富豪モードのまま、1ゲーム目は特権なし、2ゲーム目に選択が出る
    const oldMatch = host.state.matchId;
    host.send({ type: 'rematch' });
    await host.waitState((s) => s.matchId !== oldMatch && s.matchPhase !== null);
    expect(host.state.room.config).toEqual({ mode: 'chofugo', rules: ALL16, gameCount: 5 });
    const newMatch = host.state.matchId;
    await host.waitFor(
      () => (eventsOf(host).some((e) => e.type === 'abilitySelectStart' && e.gameNo === 2 && host.state.matchId === newMatch) ? true : undefined),
      120_000,
      'ability select in game 2 after rematch',
    );
    const after = host.states.filter((s) => s.matchId === newMatch).flatMap((s) => s.events);
    expect(after.some((e) => e.type === 'abilitySelectStart' && e.gameNo === 1)).toBe(false);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    for (const c of clients) c.close();
  });
});

describe('人間の大富豪（design-3 §6.1、§6.2）', () => {
  it('途中の保存は期限を変えずに state を返し、期限の直前の保存は時間切れで確定する。特権を使っても手番の期限は変わらない', async () => {
    const timing = { cpuDelayMs: 20, abilityMs: 2500, turnMs: 15_000, exchangeMs: 15_000, respondMs: 15_000, choiceMs: 15_000 };
    const { roomId, holder, others } = await holderRoom(timing, { stopOnAbility: true });
    // 席0が大富豪になり、特権の選択が来るまで（受け身の人が大富豪になったゲームは飛ばす）
    await holder.waitFor(() => (holder.manual ? true : undefined), 150_000, 'ability select for holder');
    const sel = holder.state;
    expect(sel.matchPhase).toBe('ability');
    expect(sel.view.mine).toMatchObject({ kind: 'abilitySelect', draft: [] });
    const slots = sel.view.mine.slots;
    expect(slots).toBeGreaterThanOrEqual(1);
    const awaitId = sel.view.mine.awaitId;
    const d0 = sel.deadlines.find((d) => d.awaitId === awaitId);
    expect(d0).toMatchObject({ seat: 0, kind: 'abilitySelect' });
    expect(d0.at - sel.serverTime).toBeLessThanOrEqual(timing.abilityMs);
    // ほかの人には、選んでいる人と個数だけ
    const o = (await others[0].waitState((s) => s.matchPhase === "ability" && s.view.gameNo === sel.view.gameNo, 5000, "others see selecting")).view;
    expect(o.game.abilities).toMatchObject({ holder: 0, slots, selecting: true });
    expect(o.game.myAbilities).toBe(null);
    expect(o.mine).toBe(null);

    // 途中の保存：同じ番号の待ちが残り、期限は変わらない
    holder.send({ type: 'action', action: { type: 'selectAbilities', awaitId, abilities: ['revolution'], confirm: false } });
    const s1 = await holder.waitState((s) => s.view.mine?.kind === 'abilitySelect' && s.view.mine.draft.join() === 'revolution');
    expect(s1.view.mine.awaitId).toBe(awaitId);
    expect(s1.deadlines.find((d) => d.awaitId === awaitId).at).toBe(d0.at);
    // 内容が変わらない保存でも state が返る（版番号は変わらない）
    const n = holder.states.length;
    holder.send({ type: 'action', action: { type: 'selectAbilities', awaitId, abilities: ['revolution'], confirm: false } });
    await holder.waitFor(() => (holder.states.length > n ? true : undefined), 5000, 'echo state');
    const echo = holder.states[n];
    expect(echo.version).toBe(s1.version);
    expect(echo.eventsFull).toBe(false);
    expect(echo.view.mine.draft).toEqual(['revolution']);
    // ほかの人には途中の内容は届かない
    expect(JSON.stringify(others.map((c) => c.states.map((s) => s.view)))).not.toMatch(/"draft":\["revolution"\]/);
    // 期限の直前に保存し直す → 時間切れの auto はその内容で確定する
    const wait = d0.at - Date.now() - 500;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    holder.send({ type: 'action', action: { type: 'selectAbilities', awaitId, abilities: ['ban'], confirm: false } });
    const chosen = await holder.waitFor(() => eventsOf(holder).find((e) => e.type === 'abilitiesChosen' && e.seat === 0 && e.gameNo === sel.view.gameNo), 10_000, 'timeout confirm');
    expect(chosen.abilities).toEqual(['ban']);
    expect(chosen.count).toBe(1);
    // ほかの人には個数だけ
    const seen = await others[0].waitFor(() => eventsOf(others[0]).find((e) => e.seq === chosen.seq), 5000, "chosen seen by others");
    expect(seen).toMatchObject({ type: 'abilitiesChosen', seat: 0, count: 1, abilities: null });
    // 時間切れのあとに届いた古い番号の保存は拒否される
    const late = await holder.waitError(holder.send({ type: 'action', action: { type: 'selectAbilities', awaitId, abilities: ['skip'], confirm: false } }));
    expect(late.code).toBe('actionRejected');
    expect(['staleAwait', 'wrongPhase', 'wrongAwaitKind']).toContain(late.engineError);

    // 自分の手番で独裁を使う：新しい番号の待ちに continues が付き、期限は元のまま
    holder.resume();
    await holder.waitFor(() => (holder.manual ? true : undefined), 60_000, 'turn with ability');
    const t = holder.state;
    expect(t.view.mine.kind).toBe('turn');
    const ban = t.view.mine.abilities.find((u) => u.id === 'ban');
    expect(ban).toMatchObject({ usable: true });
    const turnId = t.view.mine.awaitId;
    const td = t.deadlines.find((d) => d.awaitId === turnId);
    const rank = ban.ranks.includes(7) ? 7 : ban.ranks[0];
    holder.send({ type: 'action', action: { type: 'useAbility', awaitId: turnId, ability: 'ban', rank } });
    const t2 = await holder.waitState((s) => s.view.mine?.kind === 'turn' && s.view.mine.awaitId !== turnId);
    expect(t2.view.awaiting).toEqual([{ id: t2.view.mine.awaitId, seat: 0, kind: 'turn', timer: 'turn', continues: turnId }]);
    expect(td.at).not.toBe(null);
    expect(t2.deadlines).toEqual([{ ...td, awaitId: t2.view.mine.awaitId }]);
    expect(t2.view.game.ban).toBe(rank);
    expect(t2.view.mine.abilities.some((u) => u.id === 'ban')).toBe(false);
    expect(t2.view.game.abilities).toMatchObject({ holder: 0, remaining: 0, selecting: false });
    // 古い番号の操作は拒否される
    const stale = await holder.waitError(holder.send({ type: 'action', action: { type: 'pass', awaitId: turnId } }));
    expect([stale.code, stale.engineError]).toEqual(['actionRejected', 'staleAwait']);
    // 全員に「独裁」の出来事と封じた数字が見える
    await others[0].waitState((s) => s.view.game?.ban === rank);
    expect(eventsOf(others[0]).some((e) => e.type === 'ability' && e.ability === 'ban' && e.rank === rank && e.seat === 0)).toBe(true);
    holder.stopOnAbility = false;
    holder.resume();
    await holder.waitState((s) => s.matchPhase === 'gameResult' || s.matchPhase === 'exchange', 60_000);
    expect(holder.rejectedOwn).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    expect(await testRoute(server.base, roomId, 'replay')).toMatchObject({ ok: true });
    for (const c of [holder, ...others]) c.close();
  });

  it('選択の途中で持ち主が切断すると代役が確定する。復帰でき、全員不在から再開できる', async () => {
    const timing = { cpuDelayMs: 20, disconnectGraceMs: 300, abilityMs: 30_000, turnMs: 15_000, exchangeMs: 15_000 };
    const { roomId, holder, others } = await holderRoom(timing);
    await holder.waitFor(() => (holder.manual ? true : undefined), 150_000, 'ability select for holder');
    const gameNo = holder.state.view.gameNo;
    holder.send({ type: 'action', action: { type: 'selectAbilities', awaitId: holder.state.view.mine.awaitId, abilities: ['peek'], confirm: false } });
    await holder.waitState((s) => s.view.mine?.draft?.[0] === 'peek');
    holder.close();
    await holder.waitClosed();
    // 猶予がたつと代役（CPU の方針：透視を除く5種から枠の数だけ）が確定する
    const chosen = await others[0].waitFor(() => eventsOf(others[0]).find((e) => e.type === 'abilitiesChosen' && e.seat === 0 && e.gameNo === gameNo), 15_000, 'substitute confirm');
    expect(chosen.count).toBeGreaterThanOrEqual(1);
    expect(others[0].state.room.seats[0].away).toBe(true);
    // 復帰：選んだ種類が本人に見える（代役が選んだので透視は含まない）
    const back = new HolderClient(server.base, roomId, { name: 'H', token: holder.token });
    back.manual = true;
    await back.connect();
    back.hello();
    const full = await back.waitState((s) => s.seat === 0 && s.eventsFull);
    expect(full.view.game.myAbilities.chosen.length).toBe(chosen.count);
    expect(full.view.game.myAbilities.chosen).not.toContain('peek');
    const ev = full.events.find((e) => e.type === 'abilitiesChosen' && e.seat === 0);
    expect(ev.abilities).toEqual(full.view.game.myAbilities.chosen);
    back.resume();
    // 全員不在 → 一時停止。つなぎ直すと再開する
    for (const c of [back, ...others]) c.close();
    await Promise.all([back, ...others].map((c) => c.waitClosed()));
    await new Promise((r) => setTimeout(r, 300));
    const again = [new HolderClient(server.base, roomId, { name: 'H', token: holder.token })];
    for (let i = 0; i < 3; i++) again.push(new PassiveClient(server.base, roomId, { name: `P${i + 1}`, token: others[i].token }));
    for (const c of again) {
      await c.connect();
      c.hello();
    }
    await Promise.all(again.map((c) => c.waitState((s) => s.seat !== null && !s.room.paused)));
    for (const c of again) c.maybeAct();
    // ゲームが最後まで進む
    await again[0].waitState((s) => s.matchPhase === 'gameResult' || (s.view?.gameNo ?? 0) > gameNo, 90_000);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    expect(await testRoute(server.base, roomId, 'replay')).toMatchObject({ ok: true });
    for (const c of again) c.close();
  });
});
