// ルール設定（spec §11.5、decisions §7）。
import { describe, expect, it } from 'vitest';
import {
  ALL_RULE_IDS,
  DAIFUGO_MODE_DEFAULT_RULES,
  CUSTOM_MODE_RULE_IDS,
  DAIFUGO_MODE_RULE_IDS,
  IMPLEMENTED_RULE_IDS,
  createMatch,
  type RuleId,
} from './index.ts';
import { cfg, runMatch } from './test/helpers.ts';

describe('createMatch の設定の検証', () => {
  it('定番8種は個別に ON/OFF できる（どの組み合わせでも作れる）', () => {
    for (let mask = 0; mask < 256; mask++) {
      const rules = DAIFUGO_MODE_RULE_IDS.filter((_, i) => mask & (1 << i));
      expect(createMatch(cfg(rules), [1, 2, 3, 4]).ok).toBe(true);
    }
  });

  // その2で書き換えた（その1では「その2の8種は未実装としてエラーになる」。design-2 §6.4）
  it('16種すべてを受け付け、前提を満たさない組み合わせ（4止めだけ ON）は missingRequirement', () => {
    expect([...IMPLEMENTED_RULE_IDS]).toEqual([...ALL_RULE_IDS]);
    for (const id of ALL_RULE_IDS) {
      const r = createMatch(cfg(['flush_on_8', id].filter((x, i, a) => a.indexOf(x) === i) as RuleId[]), [1, 2, 3, 4]);
      expect(r.ok, id).toBe(true);
    }
    expect(createMatch(cfg([...ALL_RULE_IDS]), [1, 2, 3, 4]).ok).toBe(true);
    const r = createMatch(cfg(['block_flush_with_4']), [1, 2, 3, 4]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'missingRequirement', rule: 'block_flush_with_4' });
    const r2 = createMatch(cfg(['revolution', 'block_flush_with_4', 'runs']), [1, 2, 3, 4]);
    expect(r2.ok).toBe(false);
  });

  it('知らないルール・重複・ゲーム数・種・形の誤りはエラー', () => {
    const bad: [unknown, unknown, string][] = [
      [{ matchId: 'x', rules: ['nope'], gameCount: 5 }, [1, 2, 3, 4], 'unknownRule'],
      [{ matchId: 'x', rules: ['runs', 'runs'], gameCount: 5 }, [1, 2, 3, 4], 'duplicateRule'],
      [{ matchId: 'x', rules: [], gameCount: 7 }, [1, 2, 3, 4], 'invalidGameCount'],
      [{ matchId: 'x', rules: [], gameCount: 5 }, [0, 0, 0, 0], 'invalidSeed'],
      [{ matchId: 'x', rules: [], gameCount: 5 }, [1, 2], 'invalidSeed'],
      [{ matchId: 1, rules: [], gameCount: 5 }, [1, 2, 3, 4], 'malformed'],
      [null, [1, 2, 3, 4], 'malformed'],
    ];
    for (const [config, seed, code] of bad) {
      const r = createMatch(config as never, seed as never);
      expect(r.ok, code).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(code);
    }
  });

  it('大富豪モードの選べるルールとおすすめ設定', () => {
    // その2で書き換えた（その1では「実装済みの一覧と同じ」。design-2 §6.4）
    expect([...DAIFUGO_MODE_RULE_IDS]).toEqual([
      'flush_on_8',
      'revolution',
      'temp_reverse_on_j',
      'spade3_beats_joker',
      'suit_lock',
      'runs',
      'forbidden_finish',
      'dethrone',
    ]);
    expect([...CUSTOM_MODE_RULE_IDS]).toEqual([...ALL_RULE_IDS]);
    expect([...DAIFUGO_MODE_DEFAULT_RULES].sort()).toEqual(['dethrone', 'flush_on_8', 'revolution', 'runs', 'spade3_beats_joker']);
  });

  it('ゲーム開始後にルールは変わらない（設定を変える操作はなく、試合を通して同じ）', () => {
    const rules: RuleId[] = ['flush_on_8', 'runs'];
    const input = cfg(rules);
    const created = createMatch(input, [1, 2, 3, 4]);
    if (!created.ok) throw new Error();
    rules.push('revolution'); // 呼び出し側の配列を変えても影響しない
    expect(created.state.config.rules).toEqual(['flush_on_8', 'runs']);
    const { state } = runMatch(cfg(['flush_on_8', 'runs']), [1, 2, 3, 4], 'cpu');
    // その3で abilities（状態の中では必ず boolean）を足した（engine-assumptions.md H）
    expect(state.config).toEqual({ matchId: 'm-test', rules: ['flush_on_8', 'runs'], gameCount: 5, abilities: false });
  });
});

describe('ルールの登録表', () => {
  it('実装済みの ID の一覧と、登録されたモジュールが一致する', async () => {
    const { RULE_MODULES } = await import('./index.ts');
    expect(RULE_MODULES.map((m) => m.id).sort()).toEqual([...IMPLEMENTED_RULE_IDS].sort());
  });
});
