// その3：CPU の大富豪（design-3 §3.4、§6.8）。人間1席を受け身にして CPU を大富豪にし、
// 特権の選択 → 特権の使用（約1秒ごと）→ カードを出す、が止まらずに進むこと。
// 選択の途中で開発サーバーを止めて起動し直しても続けられること、アラームが2回鳴っても結果が変わらないこと。

import { afterAll, describe, expect, it } from 'vitest';
import { PassiveClient, createRoom, deadlineProblems, startServer, testRoute, PORTS } from './helpers.mjs';

const PORT = PORTS.chofugo2;
let server;
afterAll(async () => {
  await server?.stop();
});

const eventsOf = (c) => c.states.flatMap((s) => s.events);

describe('CPU の大富豪', () => {
  it('特権の選択・使用・カードを出す、が止まらずに進み、再起動とアラームの二重発火をまたいでも続く', async () => {
    server = await startServer({ port: PORT });
    const cpuDelayMs = 150;
    const roomId = await createRoom(server.base, { cpuDelayMs });
    const solo = new PassiveClient(server.base, roomId, { name: 'solo', autoHost: true });
    await solo.connect();
    solo.hello();
    await solo.waitState((s) => s.isHost, 10_000, 'host');
    solo.send({ type: 'setConfig', mode: 'chofugo', rules: [], gameCount: null });
    await solo.waitState((s) => s.room.config.mode === 'chofugo', 10_000, 'config');
    solo.send({ type: 'start' });

    // CPU が特権を選んでいる state（受け身の人が大富豪になったゲームは飛ばす）
    const sel = await solo.waitState((s) => s.matchPhase === 'ability' && s.view.awaiting.some((a) => a.kind === 'abilitySelect' && a.seat !== 0), 150_000, 'cpu selecting');
    const holder = sel.view.awaiting[0].seat;
    const gameNo = sel.view.gameNo;
    const d = sel.deadlines.find((x) => x.kind === 'abilitySelect');
    expect(d.seat).toBe(holder);
    expect(d.at - sel.serverTime).toBeLessThanOrEqual(cpuDelayMs);
    expect(sel.view.game.abilities).toMatchObject({ holder, selecting: true });

    // アラームを2回続けて鳴らしても、結果は1回分と同じ
    const v1 = (await testRoute(server.base, roomId, 'alarm')).version;
    const v2 = (await testRoute(server.base, roomId, 'alarm')).version;
    expect(v2).toBe(v1);

    // 開発サーバーを止めて起動し直す（メモリ上の状態はすべて消える）
    solo.autoHost = false;
    solo.auto = false;
    const dir = server.persistDir;
    await server.stop({ keep: true });
    await solo.waitClosed(10_000);
    server = await startServer({ port: PORT, persistDir: dir });
    const again = new PassiveClient(server.base, roomId, { name: 'solo', token: solo.token, autoHost: true });
    await again.connect();
    again.hello();
    const back = await again.waitState((s) => s.seat === 0 && s.eventsFull, 20_000, 'rejoined');
    expect(back.view.gameNo).toBe(gameNo);
    again.maybeAct();

    // 特権の確定は1回だけ。CPU は透視を選ばない
    const chosen = await again.waitFor(() => eventsOf(again).find((e) => e.type === 'abilitiesChosen' && e.gameNo === gameNo) ?? back.events.find((e) => e.type === 'abilitiesChosen'), 20_000, 'cpu chose');
    expect(chosen.seat).toBe(holder);
    expect(chosen.abilities).toBe(null);
    const all = () => [...back.events, ...eventsOf(again)].filter((e, i, arr) => arr.findIndex((x) => x.seq === e.seq) === i);
    expect(all().filter((e) => e.type === 'abilitiesChosen' && e.gameNo === gameNo).length).toBe(1);

    // CPU の大富豪が特権を使い（手番の待ちは新しい番号・約1秒）、そのあとカードを出す（またはパスする）まで。
    // そのゲームで使わなければ（スキップだけを選んだなど）、次の CPU の大富豪のゲームを待つ
    const found = await again.waitFor(
      () => {
        for (const st of again.states) {
          const use = st.events.find((e) => e.type === 'ability' && e.seat !== 0 && e.ability !== 'skip' && e.ability !== 'forceFlush');
          if (use === undefined) continue;
          const a = st.view.awaiting.find((x) => x.seat === use.seat);
          if (a === undefined || a.kind !== 'turn') continue;
          const after = all().find((e) => e.seq > use.seq && (e.type === 'play' || e.type === 'pass' || e.type === 'ability') && e.seat === use.seat && e.gameNo === use.gameNo);
          if (after !== undefined) return { st, use, a, after };
        }
        return undefined;
      },
      150_000,
      'cpu used an ability and continued',
    );
    expect(found.a.continues).toBeTypeOf('number');
    const dl = found.st.deadlines.find((x) => x.awaitId === found.a.id);
    expect(dl.at - found.st.serverTime).toBeLessThanOrEqual(cpuDelayMs);
    expect(dl.at - found.st.serverTime).toBeGreaterThan(0);
    expect(['play', 'pass', 'ability']).toContain(found.after.type);
    // CPU は透視を使わない
    expect(all().some((e) => e.type === 'ability' && e.seat !== 0 && e.ability === 'peek')).toBe(false);

    // ゲームの結果まで進む（次のゲームは配らずに試合を終える）
    again.autoHost = false;
    await again.waitState((s) => s.matchPhase === 'gameResult' && s.view.gameNo >= found.use.gameNo, 120_000, 'gameResult');
    again.send({ type: 'endMatch' });
    await again.waitState((s) => s.matchPhase === 'matchResult', 20_000, 'matchResult');
    expect(again.errors.filter((e) => e.code === 'actionRejected')).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    expect(await testRoute(server.base, roomId, 'replay')).toMatchObject({ ok: true });
    again.close();
  });
});
