// state.ts の関数の単体テスト（開発サーバーを起動しない）：設定の直し方、保存の形式の番号、期限についての検査（design-2 §3.1、§3.3、§3.4）。

import { describe, expect, it } from 'vitest';
import { createMatch } from '@chofugo/engine';
import { DEFAULT_TIMING } from '../src/timing.ts';
import { ALL_RULE_IDS } from '@chofugo/engine';
import { buildMatchConfig, deadlineProblems, initialRoom, isCurrentFormat, modeHasAbilities, normalizeRules, keepSeatDeadlinesOnRejoin, pause, resetSeatDeadlines, resetSeatDeadlinesOnAwayReturn, resume, STATE_FORMAT, syncDeadlines } from '../src/state.ts';

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
