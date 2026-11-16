// state.ts の関数の単体テスト（開発サーバーを起動しない）：設定の直し方、保存の形式の番号、期限についての検査（design-2 §3.1、§3.3、§3.4）。

import { describe, expect, it } from 'vitest';
import { createMatch } from '@chofugo/engine';
import { DEFAULT_TIMING } from '../src/timing.ts';
import { ALL_RULE_IDS } from '@chofugo/engine';
import { buildMatchConfig, deadlineProblems, initialRoom, isCurrentFormat, modeHasAbilities, normalizeRules, keepSeatDeadlinesOnRejoin, pause, rejoinKind, resetSeatDeadlines, resetSeatDeadlinesOnAwayReturn, resume, settleDeadlines, switchSeatDeadlinesToBot, STATE_FORMAT, syncDeadlines } from '../src/state.ts';

describe('normalizeRules', () => {
  it('モードで選べないルール・前提のないルールを除き、ALL_RULE_IDS の順に並べる', () => {
    expect(normalizeRules('daifugo', ['skip_on_k', 'runs', 'flush_on_8', 'give_on_7'])).toEqual(['flush_on_8', 'runs']);
    expect(normalizeRules('custom', ['block_flush_with_4', 'skip_on_k'])).toEqual(['skip_on_k']);
    expect(normalizeRules('custom', ['skip_on_k', 'block_flush_with_4', 'flush_on_8'])).toEqual(['flush_on_8', 'block_flush_with_4', 'skip_on_k']);
    expect(normalizeRules('daifugo', [])).toEqual([]);
  });

  it('超富豪モードは送られたルールを使わず16種すべてにする（design-3 §3.1）', () => {
    expect(normalizeRules('chofugo', [])).toEqual([...ALL_RULE_IDS]);
    expect(normalizeRules('chofugo', ['runs'])).toEqual([...ALL_RULE_IDS]);
    expect(modeHasAbilities('chofugo')).toBe(true);
    expect(modeHasAbilities('custom')).toBe(false);
    expect(modeHasAbilities('daifugo')).toBe(false);
  });
});

describe('buildMatchConfig（design-3 §6.6）', () => {
  it('rules・gameCount・abilities をそのまま写し、元の配列とは別にする', () => {
    const rules = ['flush_on_8', 'dethrone'];
    const c = buildMatchConfig('m', { rules, gameCount: null, abilities: true });
    expect(c).toEqual({ matchId: 'm', rules: ['flush_on_8', 'dethrone'], gameCount: null, abilities: true });
    rules.push('runs');
    expect(c.rules.length).toBe(2);
    expect(createMatch(buildMatchConfig('m2', { rules: [...ALL_RULE_IDS], gameCount: 5, abilities: true }), [1, 2, 3, 4]).ok).toBe(true);
  });
});

describe('保存の形式の番号', () => {
  it('いまの番号だけを受け付ける', () => {
    const s = initialRoom('r', 0, { ...DEFAULT_TIMING });
    expect(s.v).toBe(STATE_FORMAT);
    expect(STATE_FORMAT).toBe(4);
    expect(isCurrentFormat(s)).toBe(true);
    expect(isCurrentFormat({ ...s, v: 1 })).toBe(false);
    expect(isCurrentFormat({ ...s, v: 2 })).toBe(false);
    expect(isCurrentFormat({ ...s, v: 3 })).toBe(false);
    const { v: _v, ...noV } = s;
    expect(isCurrentFormat(noV)).toBe(false);
    expect(isCurrentFormat(null)).toBe(false);
  });
});

describe('deadlineProblems', () => {
  const room = () => {
    const s = initialRoom('r', 0, { ...DEFAULT_TIMING });
    s.pausedAt = null;
    const r = createMatch({ matchId: 'm', rules: ['give_on_7'], gameCount: 5 }, [1, 2, 3, 4]);
    if (!r.ok) throw new Error('createMatch');
    s.match = r.state;
    return s;
  };

  it('期限のない待ち・時刻のない期限・待ちのない期限を見つける', () => {
    const s = room();
    expect(deadlineProblems(s).length).toBeGreaterThan(0);
    syncDeadlines(s, 1000);
    expect(deadlineProblems(s)).toEqual([]);
    s.deadlines[0].at = null;
    expect(deadlineProblems(s)[0]).toMatch(/has no time/);
    s.deadlines[0].at = 2000;
    s.deadlines.push({ ...s.deadlines[0], awaitId: 999 });
    expect(deadlineProblems(s)).toEqual(['deadline 999 has no await']);
  });

  it('待ちの実体と突き合わせ、待ちのあるフェーズで待ちが0なら問題にする（design-3 §6.5）', () => {
    const s = room();
    syncDeadlines(s, 1000);
    expect(deadlineProblems(s)).toEqual([]);
    const saved = s.match.game.awaiting;
    s.match.game.awaiting = [];
    const p = deadlineProblems(s);
    expect(p).toContain('phase play has no await');
    expect(p.some((x) => /has no await$/.test(x) && x.startsWith('deadline'))).toBe(true);
    s.match.game.awaiting = saved;
    // ability のフェーズも待ちのあるフェーズとして見る
    s.match.phase = 'ability';
    s.match.game.awaiting = [{ id: 900, seat: 1, kind: 'abilitySelect', timer: 'ability' }];
    expect(deadlineProblems(s)).toContain('await 900 (abilitySelect, seat 1) has no deadline');
  });

  it('一時停止中と試合のないときは確かめない', () => {
    const s = room();
    syncDeadlines(s, 1000);
    pause(s, 1500);
    expect(deadlineProblems(s)).toEqual([]);
    expect(deadlineProblems(initialRoom('r', 0, { ...DEFAULT_TIMING }))).toEqual([]);
  });
});

describe('syncDeadlines の continues（design-3 §6.1）', () => {
  const setup = () => {
    const s = initialRoom('r', 0, { ...DEFAULT_TIMING });
    s.pausedAt = null;
    s.seats[0] = { ...s.seats[0], kind: 'human', name: 'A', connected: true };
    s.seats[1] = { ...s.seats[1], kind: 'cpu', name: 'CPU 2' };
    const r = createMatch({ matchId: 'm', rules: [...ALL_RULE_IDS], gameCount: 5, abilities: true }, [1, 2, 3, 4]);
    if (!r.ok) throw new Error('createMatch');
    s.match = r.state;
    return s;
  };
  /** 手番の待ちを、seat の席の id 番に置き換える（continues つき）。 */
  const setTurn = (s, seat, id, continues) => {
    const a = { id, seat, kind: 'turn', timer: 'turn' };
    if (continues !== undefined) a.continues = continues;
    s.match.game.awaiting = [a];
  };

  it('人間は元の期限の時刻をそのまま引き継ぐ。continues のない新しい待ちは秒数いっぱい', () => {
    const s = setup();
    setTurn(s, 0, 100);
    syncDeadlines(s, 1000);
    expect(s.deadlines).toMatchObject([{ awaitId: 100, at: 1000 + DEFAULT_TIMING.turnMs }]);
    setTurn(s, 0, 101, 100);
    syncDeadlines(s, 9000);
    expect(s.deadlines).toEqual([{ awaitId: 101, seat: 0, kind: 'turn', timer: 'turn', at: 1000 + DEFAULT_TIMING.turnMs, remaining: null, extended: false }]);
    // 期限を過ぎていても、そのまま引き継ぐ（すぐに時間切れの auto が出る）
    setTurn(s, 0, 102, 101);
    syncDeadlines(s, 40_000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 102, at: 1000 + DEFAULT_TIMING.turnMs });
    // continues のない新しい待ち（強制流しのあと）は数え直す
    setTurn(s, 0, 103);
    syncDeadlines(s, 50_000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 103, at: 50_000 + DEFAULT_TIMING.turnMs });
    expect(deadlineProblems(s)).toEqual([]);
  });

  it('一時停止中に引き継ぐと、残り時間を引き継ぐ', () => {
    const s = setup();
    setTurn(s, 0, 100);
    syncDeadlines(s, 1000);
    pause(s, 11_000);
    expect(s.deadlines[0]).toMatchObject({ at: null, remaining: DEFAULT_TIMING.turnMs - 10_000 });
    setTurn(s, 0, 101, 100);
    syncDeadlines(s, 20_000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 101, at: null, remaining: DEFAULT_TIMING.turnMs - 10_000 });
    resume(s, 30_000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 101, at: 30_000 + DEFAULT_TIMING.turnMs - 10_000, remaining: null });
  });

  it('CPU・代役は約1秒に付け直す。元の期限がなければ、人間でも秒数いっぱい', () => {
    const s = setup();
    setTurn(s, 1, 100);
    syncDeadlines(s, 1000);
    setTurn(s, 1, 101, 100);
    syncDeadlines(s, 1500);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 101, at: 1500 + DEFAULT_TIMING.cpuDelayMs });
    // 代役（切断して猶予がたった人間）
    s.seats[0].away = true;
    s.seats[0].connected = false;
    setTurn(s, 0, 102);
    syncDeadlines(s, 2000);
    setTurn(s, 0, 103, 102);
    syncDeadlines(s, 2500);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 103, at: 2500 + DEFAULT_TIMING.cpuDelayMs });
    // 元の期限が消えている（アラームの処理で先に消した）なら、ふつうの新しい待ちと同じ
    s.seats[0].away = false;
    s.seats[0].connected = true;
    s.deadlines = [];
    setTurn(s, 0, 104, 103);
    syncDeadlines(s, 3000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 104, at: 3000 + DEFAULT_TIMING.turnMs });
  });

  it('同じ番号のまま残った待ち（途中の保存）の期限は変えない', () => {
    const s = setup();
    s.match.phase = 'ability';
    s.match.game.awaiting = [{ id: 200, seat: 0, kind: 'abilitySelect', timer: 'ability' }];
    syncDeadlines(s, 1000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 200, at: 1000 + DEFAULT_TIMING.abilityMs });
    syncDeadlines(s, 30_000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 200, at: 1000 + DEFAULT_TIMING.abilityMs });
  });
});

describe('つなぎ直したときの期限（decisions §18.1）', () => {
  const setup = () => {
    const s = initialRoom('r', 0, { ...DEFAULT_TIMING });
    s.pausedAt = null;
    s.seats[0] = { ...s.seats[0], kind: 'human', name: 'A', connected: true };
    const r = createMatch({ matchId: 'm', rules: [...ALL_RULE_IDS], gameCount: 5, abilities: true }, [1, 2, 3, 4]);
    if (!r.ok) throw new Error('createMatch');
    s.match = r.state;
    s.match.game.awaiting = [{ id: 100, seat: 0, kind: 'turn', timer: 'turn' }];
    syncDeadlines(s, 1000);
    return s;
  };
  const T = DEFAULT_TIMING.turnMs;
  const M = DEFAULT_TIMING.rejoinMinMs;

  it('残りが rejoinMinMs 以上なら期限を変えない', () => {
    const s = setup();
    keepSeatDeadlinesOnRejoin(s, 0, 1000 + T - M);
    expect(s.deadlines[0]).toMatchObject({ at: 1000 + T, extended: false });
  });

  it('残りが短いときは1回だけ rejoinMinMs に延ばし、2回目は延ばさない', () => {
    const s = setup();
    const now1 = 1000 + T - 3000;
    keepSeatDeadlinesOnRejoin(s, 0, now1);
    expect(s.deadlines[0]).toMatchObject({ at: now1 + M, extended: true });
    keepSeatDeadlinesOnRejoin(s, 0, now1 + M - 1000);
    expect(s.deadlines[0]).toMatchObject({ at: now1 + M, extended: true });
    // 期限を過ぎていても（アラームがまだ鳴っていない）延ばさない
    keepSeatDeadlinesOnRejoin(s, 0, now1 + M + 500);
    expect(s.deadlines[0].at).toBe(now1 + M);
  });

  it('印は特権で作り直した手番（continues）に引き継ぐ', () => {
    const s = setup();
    keepSeatDeadlinesOnRejoin(s, 0, 1000 + T - 1000);
    const at = s.deadlines[0].at;
    s.match.game.awaiting = [{ id: 101, seat: 0, kind: 'turn', timer: 'turn', continues: 100 }];
    syncDeadlines(s, 1000 + T);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 101, at, extended: true });
    keepSeatDeadlinesOnRejoin(s, 0, at - 500);
    expect(s.deadlines[0].at).toBe(at);
  });

  it('一時停止中は残り時間で比べる。延ばす長さはその待ちの秒数を超えない', () => {
    const s = setup();
    pause(s, 1000 + T - 2000);
    keepSeatDeadlinesOnRejoin(s, 0, 1000 + T);
    expect(s.deadlines[0]).toMatchObject({ at: null, remaining: M, extended: true });
    s.timing = { ...s.timing, rejoinMinMs: 60_000 };
    s.pausedAt = null;
    s.match.game.awaiting = [{ id: 102, seat: 0, kind: 'respond', timer: 'respond' }];
    syncDeadlines(s, 5000);
    keepSeatDeadlinesOnRejoin(s, 0, 5000 + 3000);
    // rejoinMinMs（60秒）ではなく、返しの一周の秒数（10秒）まで
    expect(s.deadlines[0]).toMatchObject({ awaitId: 102, at: 5000 + 3000 + DEFAULT_TIMING.respondMs, extended: true });
  });

  it('新しく席に着いたとき（resetSeatDeadlines）は秒数いっぱい。印は変えない', () => {
    const s = setup();
    resetSeatDeadlines(s, 0, 20_000);
    expect(s.deadlines[0]).toMatchObject({ at: 20_000 + T, extended: false });
  });

  it('代役からの復帰は、まだ延ばしていない待ちだけ秒数いっぱい。2回目は期限を変えない（decisions §18.2）', () => {
    const s = setup();
    // 代役の期限（約1秒）から戻る
    s.deadlines[0].at = 20_000 + DEFAULT_TIMING.cpuDelayMs;
    resetSeatDeadlinesOnAwayReturn(s, 0, 20_000);
    expect(s.deadlines[0]).toMatchObject({ at: 20_000 + T, extended: true });
    // もう一度代役になり、また戻る：代役の期限のまま
    s.deadlines[0].at = 40_000 + DEFAULT_TIMING.cpuDelayMs;
    resetSeatDeadlinesOnAwayReturn(s, 0, 40_000);
    expect(s.deadlines[0]).toMatchObject({ at: 40_000 + DEFAULT_TIMING.cpuDelayMs, extended: true });
    // 猶予の中の復帰でも延ばさない
    keepSeatDeadlinesOnRejoin(s, 0, 40_000 + 500);
    expect(s.deadlines[0].at).toBe(40_000 + DEFAULT_TIMING.cpuDelayMs);
  });

  it('猶予の中の復帰で延ばしたあとは、代役から戻っても期限を変えない', () => {
    const s = setup();
    keepSeatDeadlinesOnRejoin(s, 0, 1000 + T - 1000);
    expect(s.deadlines[0].extended).toBe(true);
    s.deadlines[0].at = 50_000 + DEFAULT_TIMING.cpuDelayMs;
    resetSeatDeadlinesOnAwayReturn(s, 0, 50_000);
    expect(s.deadlines[0].at).toBe(50_000 + DEFAULT_TIMING.cpuDelayMs);
  });

  it('代役からの復帰の印も、特権で作り直した手番（continues）に引き継ぐ', () => {
    const s = setup();
    resetSeatDeadlinesOnAwayReturn(s, 0, 2000);
    s.match.game.awaiting = [{ id: 101, seat: 0, kind: 'turn', timer: 'turn', continues: 100 }];
    syncDeadlines(s, 3000);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 101, at: 2000 + T, extended: true });
  });
});

describe('代役への切り替えと、CPU の特権のあとの印（decisions §18.2）', () => {
  const setup = () => {
    const s = initialRoom('r', 0, { ...DEFAULT_TIMING });
    s.pausedAt = null;
    s.seats[0] = { ...s.seats[0], kind: 'human', name: 'A', connected: true };
    const r = createMatch({ matchId: 'm', rules: [...ALL_RULE_IDS], gameCount: 5, abilities: true }, [1, 2, 3, 4]);
    if (!r.ok) throw new Error('createMatch');
    s.match = r.state;
    s.match.game.awaiting = [{ id: 1, seat: 0, kind: 'turn', timer: 'turn' }];
    syncDeadlines(s, 0);
    return s;
  };
  const C = DEFAULT_TIMING.cpuDelayMs;

  it('代役に切り替わるときは、残り時間を増やさない（一時停止中も）', () => {
    const s = setup();
    switchSeatDeadlinesToBot(s, 0, DEFAULT_TIMING.turnMs - 400);
    expect(s.deadlines[0].at).toBe(DEFAULT_TIMING.turnMs);
    const t = setup();
    switchSeatDeadlinesToBot(t, 0, 5000);
    expect(t.deadlines[0].at).toBe(5000 + C);
    pause(t, 5000 + C - 500);
    switchSeatDeadlinesToBot(t, 0, 20_000);
    expect(t.deadlines[0]).toMatchObject({ at: null, remaining: 500 });
  });

  it('再現：人間1人のルームで、延長済みの待ちに全員不在をはさんでも、代役への切り替えで残りが1秒に戻らない', () => {
    const s = setup();
    const G = DEFAULT_TIMING.disconnectGraceMs;
    const A = s.seats[0];
    const left = (now) => (s.deadlines[0].at !== null ? s.deadlines[0].at - now : s.deadlines[0].remaining);
    let now = 1000;
    // 代役から戻って延長を使う
    A.connected = false;
    A.disconnectedAt = now;
    settleDeadlines(s, now, new Map()); // 全員不在 → 一時停止
    now += G + 1000;
    const how = rejoinKind(s, A, now);
    expect(how).toBe('away');
    A.connected = true;
    A.disconnectedAt = null;
    settleDeadlines(s, now, new Map([[0, how]]));
    A.away = false;
    expect(s.deadlines[0].extended).toBe(true);
    const lefts = [];
    for (let i = 0; i < 8; i++) {
      // 残りが短くなったところで切断 → 全員不在で一時停止 → 11秒後に接続（点検で代役に切り替わる）→ hello で復帰
      now += Math.max(0, left(now) - 500);
      A.connected = false;
      A.disconnectedAt = now;
      settleDeadlines(s, now, new Map());
      expect(s.pausedAt).not.toBe(null);
      now += G + 1000;
      settleDeadlines(s, now, new Map()); // 席のない接続が来たときの点検
      expect(A.away).toBe(true);
      A.connected = true;
      A.away = false;
      A.disconnectedAt = null;
      settleDeadlines(s, now, new Map([[0, 'away']]));
      lefts.push(left(now));
    }
    for (const x of lefts) expect(x).toBeLessThanOrEqual(500);
  });

  it('再現：延長済みの席が代役になり、CPU が特権を使って手番を作り直しても、印は消えない', () => {
    const s = setup();
    s.deadlines[0].extended = true;
    s.seats[0].away = true;
    s.seats[0].connected = false;
    // アラームの処理：期限切れの待ちを消してから auto（CPU が特権を使い、id=2 continues=1）、消した期限を carry に渡す
    const due = s.deadlines[0];
    s.deadlines = [];
    s.match.game.awaiting = [{ id: 2, seat: 0, kind: 'turn', timer: 'turn', continues: 1 }];
    syncDeadlines(s, 5000, [due]);
    expect(s.deadlines[0]).toMatchObject({ awaitId: 2, at: 5000 + C, extended: true });
    // 本人が戻っても秒数いっぱいにしない
    s.seats[0].away = false;
    s.seats[0].connected = true;
    resetSeatDeadlinesOnAwayReturn(s, 0, 5500);
    expect(s.deadlines[0].at).toBe(5000 + C);
    // 一覧に元が残っている場合も、CPU・代役の席で引き継ぐ
    const t = setup();
    t.deadlines[0].extended = true;
    t.seats[0].away = true;
    t.match.game.awaiting = [{ id: 2, seat: 0, kind: 'turn', timer: 'turn', continues: 1 }];
    syncDeadlines(t, 100);
    expect(t.deadlines[0]).toMatchObject({ awaitId: 2, extended: true });
  });

  it('性質：1つの待ち（continues でつながる手番を含む）の残り時間が、どんな順の復帰・切断・代役・一時停止でも増えるのは最大1回', async () => {
    const G = DEFAULT_TIMING.disconnectGraceMs;
    const mulberry = (a) => () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const stats = { scenarios: 0, extended: 0, awayReturns: 0, keepReturns: 0, pauses: 0, botContinues: 0, humanContinues: 0, expired: 0, backAfterBotContinue: 0 };
    for (let seed = 1; seed <= 800; seed++) {
      const rnd = mulberry(seed);
      const pick = (n) => Math.floor(rnd() * n);
      const s = setup();
      // 席1も人間（つながったり切れたりする）。いないシナリオ（人間1人）も混ぜる
      const two = rnd() < 0.5;
      if (two) s.seats[1] = { ...s.seats[1], kind: 'human', name: 'B', connected: true };
      let now = 0;
      let nextId = 2;
      let abilities = 0;
      let increases = 0;
      let done = false;
      const trace = [];
      const dl = () => s.deadlines.find((d) => d.seat === 0);
      const left = () => {
        const d = dl();
        return d === undefined ? null : d.at !== null ? d.at - now : d.remaining;
      };
      /** op を実行し、同じ時刻で残りが増えたかを数える（count: false は数えない操作）。 */
      const run = (name, fn, count = true) => {
        const before = left();
        fn();
        const after = left();
        trace.push(`${now} ${name} ${before}→${after}`);
        if (count && before !== null && after !== null && after > before) increases++;
      };
      const settle = (rejoined = new Map()) => {
        const wasPaused = s.pausedAt !== null;
        settleDeadlines(s, now, rejoined);
        if (!wasPaused && s.pausedAt !== null) stats.pauses++;
      };
      const backA = () => {
        const A = s.seats[0];
        const how = rejoinKind(s, A, now);
        if (how === 'away') stats.awayReturns++;
        else stats.keepReturns++;
        run(`A back(${how})`, () => { A.connected = true; A.away = false; A.disconnectedAt = null; settle(new Map([[0, how]])); });
      };
      const expire = () => {
        const due = dl();
        s.deadlines = s.deadlines.filter((d) => d !== due);
        stats.expired++;
        // 代役（CPU）が特権を使って同じ手番を作り直す（1ゲームに最大3回）。期限が約1秒になるのは延長に数えない
        if (s.seats[0].away && abilities < 3 && rnd() < 0.8) {
          abilities++;
          stats.botContinues++;
          s.match.game.awaiting = [{ id: nextId, seat: 0, kind: 'turn', timer: 'turn', continues: due.awaitId }];
          nextId++;
          syncDeadlines(s, now, [due]);
          settle();
          // 作り直した直後（約1秒の期限の中）に本人が戻る順を多めに作る
          if (rnd() < 0.5) {
            stats.backAfterBotContinue++;
            backA();
          }
          return;
        }
        done = true;
      };
      const advance = (dt) => {
        const end = now + dt;
        for (let g = 0; g < 100 && !done; g++) {
          let next = null;
          if (s.pausedAt === null) {
            const d = dl();
            if (d?.at !== undefined && d.at !== null) next = d.at;
            for (const r of s.seats) {
              if (r.kind === 'human' && !r.connected && !r.away && r.disconnectedAt !== null) {
                const t = r.disconnectedAt + G;
                if (next === null || t < next) next = t;
              }
            }
          }
          if (next === null || next > end) break;
          now = Math.max(now, next);
          run('alarm', () => settle());
          const d = dl();
          if (s.pausedAt === null && d !== undefined && d.at !== null && d.at <= now) run('expire', expire, false);
        }
        if (!done) now = Math.max(now, end);
      };
      for (let i = 0; i < 80 && !done; i++) {
        const A = s.seats[0];
        const op = pick(7);
        if (op === 0) advance(pick(4) === 0 ? 8000 + pick(8000) : pick(2500));
        // 短い時間だけ進める（代役の約1秒の期限の中で戻る順を作る）
        else if (op === 6) advance(pick(700));
        else if (op === 1 && A.connected) run('A drop', () => { A.connected = false; A.disconnectedAt = now; settle(); });
        else if (op === 2 && !A.connected) backA();
        else if (op === 3 && two) {
          const B = s.seats[1];
          if (B.connected) run('B drop', () => { B.connected = false; B.disconnectedAt = now; settle(); });
          else {
            const how = rejoinKind(s, B, now);
            run('B back', () => { B.connected = true; B.away = false; B.disconnectedAt = null; settle(new Map([[1, how]])); });
          }
        } else if (op === 4 && A.connected && !A.away && abilities < 3 && s.pausedAt === null) {
          // 本人が特権を使って同じ手番を作り直す
          abilities++;
          stats.humanContinues++;
          run('A ability', () => {
            const prev = dl();
            s.match.game.awaiting = [{ id: nextId, seat: 0, kind: 'turn', timer: 'turn', continues: prev.awaitId }];
            nextId++;
            syncDeadlines(s, now);
            settle();
          });
        } else if (op === 5) run('settle', () => settle());
      }
      stats.scenarios++;
      if (increases > 0) stats.extended++;
      if (increases > 1) throw new Error(`seed ${seed}: ${increases} increases\n${trace.join('\n')}`);
    }
    if (process.env.PROP_STATS) (await import('node:fs')).writeFileSync(process.env.PROP_STATS, JSON.stringify(stats));
    // いろいろな順が実際に起きていること
    expect(stats.extended).toBeGreaterThan(50);
    expect(stats.awayReturns).toBeGreaterThan(100);
    expect(stats.keepReturns).toBeGreaterThan(100);
    expect(stats.pauses).toBeGreaterThan(100);
    expect(stats.botContinues).toBeGreaterThan(20);
    expect(stats.humanContinues).toBeGreaterThan(20);
    expect(stats.backAfterBotContinue).toBeGreaterThan(20);
  });
});
