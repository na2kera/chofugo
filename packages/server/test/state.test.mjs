// state.ts の関数の単体テスト（開発サーバーを起動しない）：設定の直し方、保存の形式の番号、期限についての検査（design-2 §3.1、§3.3、§3.4）。

import { describe, expect, it } from 'vitest';
import { createMatch } from '@chofugo/engine';
import { DEFAULT_TIMING } from '../src/timing.ts';
import { deadlineProblems, initialRoom, isCurrentFormat, normalizeRules, pause, STATE_FORMAT, syncDeadlines } from '../src/state.ts';

describe('normalizeRules', () => {
  it('モードで選べないルール・前提のないルールを除き、ALL_RULE_IDS の順に並べる', () => {
    expect(normalizeRules('daifugo', ['skip_on_k', 'runs', 'flush_on_8', 'give_on_7'])).toEqual(['flush_on_8', 'runs']);
    expect(normalizeRules('custom', ['block_flush_with_4', 'skip_on_k'])).toEqual(['skip_on_k']);
    expect(normalizeRules('custom', ['skip_on_k', 'block_flush_with_4', 'flush_on_8'])).toEqual(['flush_on_8', 'block_flush_with_4', 'skip_on_k']);
    expect(normalizeRules('daifugo', [])).toEqual([]);
  });
});

describe('保存の形式の番号', () => {
  it('いまの番号だけを受け付ける', () => {
    const s = initialRoom('r', 0, { ...DEFAULT_TIMING });
    expect(s.v).toBe(STATE_FORMAT);
    expect(STATE_FORMAT).toBe(2);
    expect(isCurrentFormat(s)).toBe(true);
    expect(isCurrentFormat({ ...s, v: 1 })).toBe(false);
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

  it('一時停止中と試合のないときは確かめない', () => {
    const s = room();
    syncDeadlines(s, 1000);
    pause(s, 1500);
    expect(deadlineProblems(s)).toEqual([]);
    expect(deadlineProblems(initialRoom('r', 0, { ...DEFAULT_TIMING }))).toEqual([]);
  });
});
