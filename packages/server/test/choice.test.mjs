// その2：7渡しの選択（choice の待ち）の時間切れ・CPU・代役と、7渡しの中身の見え方（design-2 §3.2、§3.5、§6.5）。
// 配りはでたらめなので、7渡しだけを ON にし、7の組を優先して出す席を置いて、起きるまで無制限の試合を回す。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, chooseAction, createRoom, deadlineProblems, startServer, PORTS } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: PORTS.choice });
});
afterAll(async () => {
  await server?.stop();
});

const rank7 = (p) => p.play.shape === 'group' && p.play.rank === 7;

/**
 * 7の組を優先して出す席。choice の待ちには何もしない（hold: true のとき）か、でたらめに選ぶ。
 * paused の間は何もしない（ゲームを止めて、つなぎ直しの確認をするため）。
 */
class SevenClient extends Client {
  constructor(base, roomId, opts) {
    super(base, roomId, opts);
    this.hold = opts.hold ?? false;
    this.paused = false;
    /** ゲームの結果の画面で次のゲームを配らない（試合を終えるため）。 */
    this.noNext = false;
    /** 真を返したら、その state で操作する前に止まる（次のゲームを配る前に止めるため）。 */
    this.pauseWhen = null;
    this.auto = true;
  }

  checkPause() {
    if (!this.paused && this.pauseWhen?.()) {
      this.paused = true;
      this.pauseWhen = null;
    }
    return this.paused;
  }

  maybeAct() {
    if (this.checkPause()) return;
    const mine = this.state?.view?.mine;
    if (!mine || this.acted.has(mine.awaitId)) return;
    if (mine.kind === 'choice' && this.hold) return;
    this.acted.add(mine.awaitId);
    let action;
    if (mine.kind === 'turn') {
      const p = mine.plays.find((x) => rank7(x) && !x.foul);
      action = p ? { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape } : chooseAction(mine, this.state.view.game.hand);
    } else {
      action = chooseAction(mine, this.state.view.game.hand);
    }
    const id = this.send({ type: 'action', action });
    (this.autoReqs ??= new Set()).add(id);
  }

  maybeNextGame() {
    if (!this.checkPause() && !this.noNext) super.maybeNextGame();
  }

  resume() {
    this.paused = false;
    this.maybeAct();
    if (this.autoHost && this.state) this.maybeNextGame();
  }
}

const eventsOf = (cs) => cs.flatMap((c) => c.states.flatMap((s) => s.events));

describe('7渡しの選択', () => {
  it('時間切れ（渡さない）・CPU の選択と、give の中身はふつうの配信でも全件の配信でも当事者だけ', async () => {
    const timing = { cpuDelayMs: 20, choiceMs: 400, turnMs: 20_000, exchangeMs: 20_000, respondMs: 20_000 };
    const roomId = await createRoom(server.base, timing);
    let me = new SevenClient(server.base, roomId, { name: 'me', hold: true, autoHost: true });
    await me.connect();
    me.hello();
    await me.waitState((s) => s.isHost);
    me.send({ type: 'setConfig', mode: 'custom', rules: ['give_on_7'], gameCount: null });
    await me.waitState((s) => s.room.config.rules.length === 1);
    me.send({ type: 'start' });
    const all = [me];

    // (1) 自分の選択の時間切れ：choice の期限は choiceMs、時間切れで choiceSkip（渡さない）
    const dl = await me.waitFor(
      () => me.states.map((s) => ({ s, d: s.deadlines.find((d) => d.kind === 'choice' && d.seat === 0) })).find((x) => x.d !== undefined),
      120_000,
      'my choice await',
    );
    expect(dl.d.at - dl.s.serverTime).toBeGreaterThan(200);
    expect(dl.d.at - dl.s.serverTime).toBeLessThanOrEqual(timing.choiceMs);
    expect(dl.s.view.mine).toMatchObject({ kind: 'choice', rule: 'give_on_7', awaitId: dl.d.awaitId });
    expect(dl.s.view.game.choice).toMatchObject({ rule: 'give_on_7', seat: 0 });
    expect([1, 2, 3]).toContain(dl.s.view.game.choice.to);
    await me.waitFor(() => (eventsOf(all).some((e) => e.type === 'choiceSkip' && e.seat === 0) ? true : undefined), 5000, 'timeout skip');
    expect(eventsOf(all).some((e) => e.type === 'give' && e.from === 0)).toBe(false);

    // (2) CPU の選択：いちばん弱いカードから上限まで渡す。CPU どうしの give は、自分には枚数だけ
    const cpuGive = await me.waitFor(() => eventsOf(all).find((e) => e.type === 'give' && e.from !== 0 && e.to !== 0), 120_000, 'cpu give');
    const start = eventsOf(all).filter((e) => e.type === 'choiceStart' && e.seat === cpuGive.from && e.seq < cpuGive.seq).at(-1);
    expect(start).toMatchObject({ rule: 'give_on_7', to: cpuGive.to });
    expect(cpuGive.count).toBeGreaterThan(0);
    expect(cpuGive.count).toBeLessThanOrEqual(start.max);
    expect(cpuGive.cards).toBe(null);

    // (3) 自分が受け取る give は中身が見える
    const toMe = await me.waitFor(() => eventsOf(all).find((e) => e.type === 'give' && e.to === 0), 120_000, 'give to me');
    expect(toMe.cards.length).toBe(toMe.count);

    // (4) 復帰したときの全件の配信：ゲームを止めて、同じ本人確認の値でつなぎ直す
    //     （止める前に、CPU どうしの give と自分への give が同じゲームの中で起きるまで待つ）
    // 止める判断は、その state で操作する（次のゲームを配る）前に行う
    let target = null;
    me.pauseWhen = () => {
      const g = me.state?.view?.gameNo;
      const evs = eventsOf(all).filter((e) => e.gameNo === g && e.type === 'give');
      const a = evs.find((e) => e.from !== 0 && e.to !== 0);
      const b = evs.find((e) => e.to === 0);
      if (a && b) target = { gameNo: g, a, b };
      return target !== null;
    };
    me.checkPause();
    await me.waitFor(() => (me.paused ? true : undefined), 240_000, 'gives in one game');
    const me2 = new SevenClient(server.base, roomId, { name: 'me', token: me.token, hold: true, autoHost: true });
    me2.paused = true;
    await me2.connect();
    me2.hello();
    const full = await me2.waitState((s) => s.seat === 0 && s.eventsFull, 10_000);
    expect(full.view.gameNo).toBe(target.gameNo);
    const fa = full.events.find((e) => e.seq === target.a.seq);
    const fb = full.events.find((e) => e.seq === target.b.seq);
    expect(fa).toMatchObject({ type: 'give', from: target.a.from, to: target.a.to, count: target.a.count, cards: null });
    expect(fb).toMatchObject({ type: 'give', to: 0, count: target.b.count, cards: target.b.cards });
    // 全件の配信の中のどの give も、当事者でなければ中身がない
    for (const e of full.events) if (e.type === 'give') expect(e.cards === null).toBe(e.from !== 0 && e.to !== 0);
    me.close();
    all.push(me2);
    me = me2;
    me.resume();

    expect(me.rejectedOwn).toEqual([]);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    // 試合を終える（ゲームの結果の画面で）
    me.noNext = true;
    await me.waitState((s) => s.matchPhase === 'gameResult', 120_000);
    me.send({ type: 'endMatch' });
    await me.waitState((s) => s.matchPhase === 'matchResult');
    me.close();
  });

  it('代役（切断して猶予がたった人）の選択は CPU と同じく約1秒で選ぶ', async () => {
    const timing = { cpuDelayMs: 20, disconnectGraceMs: 300, choiceMs: 20_000, turnMs: 20_000, exchangeMs: 20_000, respondMs: 20_000 };
    const roomId = await createRoom(server.base, timing);
    const A = new SevenClient(server.base, roomId, { name: 'A', autoHost: true });
    await A.connect();
    A.hello();
    await A.waitState((s) => s.isHost);
    const B = new Client(server.base, roomId, { name: 'B' });
    await B.connect();
    B.hello();
    await B.waitState((s) => s.seat === 1);
    A.send({ type: 'setConfig', mode: 'custom', rules: ['give_on_7'], gameCount: null });
    await A.waitState((s) => s.room.config.rules.length === 1);
    A.send({ type: 'start' });
    await A.waitState((s) => s.matchPhase !== null);
    B.close();
    await A.waitState((s) => s.room.seats[1].away === true, 10_000, 'B away');
    // B の席の choice の待ちの期限は cpuDelayMs、CPU の方針で上限まで渡す
    const found = await A.waitFor(
      () => A.states.map((s) => ({ s, d: s.deadlines.find((d) => d.kind === 'choice' && d.seat === 1) })).find((x) => x.d !== undefined),
      240_000,
      'substitute choice',
    );
    expect(found.d.at - found.s.serverTime).toBeLessThanOrEqual(timing.cpuDelayMs);
    const after = await A.waitFor(
      () => eventsOf([A]).find((e) => (e.type === 'give' || e.type === 'choiceSkip') && (e.from === 1 || e.seat === 1) && e.gameNo === found.s.view.gameNo),
      5000,
      'substitute chose',
    );
    expect(after.type).toBe('give');
    expect(after.from).toBe(1);
    expect(await deadlineProblems(server.base, roomId)).toEqual([]);
    A.close();
  });
});
