// ルール設定（spec §11.5、decisions §7）。
import { describe, expect, it } from 'vitest';
import {
  ALL_RULE_IDS,
  DAIFUGO_MODE_DEFAULT_RULES,
  DAIFUGO_MODE_RULE_IDS,
  IMPLEMENTED_RULE_IDS,
  createMatch,
  type RuleId,
} from './index.ts';
import { cfg, runMatch } from './test/helpers.ts';

describe('createMatch の設定の検証', () => {
  it('定番8種は個別に ON/OFF できる（どの組み合わせでも作れる）', () => {
    for (let mask = 0; mask < 256; mask++) {
      const rules = IMPLEMENTED_RULE_IDS.filter((_, i) => mask & (1 << i));
      expect(createMatch(cfg(rules), [1, 2, 3, 4]).ok).toBe(true);
    }
  });

  it('その2の8種は未実装としてエラーになる', () => {
    const notYet = ALL_RULE_IDS.filter((id) => !(IMPLEMENTED_RULE_IDS as readonly RuleId[]).includes(id));
    expect(notYet).toHaveLength(8);
    for (const id of notYet) {
      const r = createMatch(cfg(['flush_on_8', id]), [1, 2, 3, 4]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: 'notImplemented', rule: id });
    }
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
    expect([...DAIFUGO_MODE_RULE_IDS].sort()).toEqual([...IMPLEMENTED_RULE_IDS].sort());
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
    expect(state.config).toEqual({ matchId: 'm-test', rules: ['flush_on_8', 'runs'], gameCount: 5 });
  });
});

describe('ルールの登録表', () => {
  it('実装済みの ID の一覧と、登録されたモジュールが一致する', async () => {
    const { RULE_MODULES } = await import('./index.ts');
    expect(RULE_MODULES.map((m) => m.id).sort()).toEqual([...IMPLEMENTED_RULE_IDS].sort());
  });
});
