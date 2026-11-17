// 第2段階の横断の場面（design-4 §2.9、§6.6）: 新しい選択の待ちの JSON 往復・時間切れ・CPU、透視との関係、
// 24種のでたらめな対戦に不正な操作を混ぜる検査。
import { describe, expect, it } from 'vitest';
import { ALL_RULE_IDS, applyAction, awaiting, createMatch, viewFor, type Action, type MatchState, type RuleId } from './index.ts';
import { RULE_MODULES } from './rules/index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { Driver, assertJsonSafe, cfg, cs, randomAction, scene } from './test/helpers.ts';

/** 新しい選択の待ち3種（席0が手を出した直後）。 */
const CHOICES: { name: string; make: () => Driver }[] = [
  {
    name: '銀河鉄道',
    make: () => {
      const d = new Driver(scene({ rules: ['triple9_salvage'], hands: ['S9 H9 D9 C4 C5 CK', 'HK', 'D7', 'C3'], turn: 0, discard: 'S3 H3' }));
      d.play(0, 'S9 H9 D9');
      return d;
    },
  },
  {
    name: '闇市',
    make: () => {
      const d = new Driver(scene({ rules: ['triple_a_trade'], hands: ['SA HA DA C4 C5 CK', 'H2 X0 H6', 'D7 D8', 'C3 C9'], turn: 0 }));
      d.play(0, 'SA HA DA');
      return d;
    },
  },
  {
    name: 'Q ボンバー',
    make: () => {
      const d = new Driver(scene({ rules: ['call_discard_on_q'], hands: ['SQ C4 D4 CK', 'H4 X0', 'D7 D8', 'C3 C9'], turn: 0 }));
      d.play(0, 'SQ');
      return d;
    },
  },
];

const roundTrip = (s: MatchState): MatchState => JSON.parse(JSON.stringify(s)) as MatchState;

describe('新しい選択の待ち（銀河鉄道・闇市・Q ボンバー）', () => {
  for (const { name, make } of CHOICES) {
    it(`${name}: 状態を JSON に書き出して読み戻しても続けられる。時間切れは何もしない。CPU は決まりどおりに選ぶ`, () => {
      const d = make();
      expect(d.current()).toMatchObject({ seat: 0, kind: 'choice', timer: 'choice' });
      assertJsonSafe(d.state);
      // JSON 往復した状態に同じ操作を適用すると、結果が完全に同じ
      for (const policy of ['timeout', 'cpu'] as const) {
        const a: Action = { type: 'auto', awaitId: d.current().id, policy };
        const r1 = applyAction(d.state, a);
        const r2 = applyAction(roundTrip(d.state), a);
        expect(r2).toStrictEqual(r1);
        if (!r1.ok) throw new Error(r1.error.message);
        assertJsonSafe(r1.state);
        expect(r1.state.game!.awaiting[0]).toMatchObject({ seat: 1, kind: 'turn' });
        if (policy === 'timeout') expect(r1.events.map((e) => e.type)).toEqual(['choiceSkip']);
        else expect(r1.events[0]!.type).not.toBe('choiceSkip');
      }
    });
  }

  it('CPU の選び方: 銀河鉄道はいちばん弱い2枚、Q ボンバーはいちばん多い数字', () => {
    const a = CHOICES[0]!.make();
    expect(a.auto('cpu')[0]).toMatchObject({ type: 'salvage', put: cs('C4 C5') });
    const q = CHOICES[2]!.make();
    expect(q.auto('cpu')[0]).toMatchObject({ type: 'callDiscard', ranks: [4], discards: [{ seat: 0, cards: cs('C4 D4') }, { seat: 1, cards: cs('H4') }] });
  });
});

describe('透視（design-4 §6.6）', () => {
  it('新しい効果で見たカードが手札を離れたら消え、あとで同じカードが戻っても出ない', () => {
    const s = scene({
      rules: ['triple_a_trade', 'give_on_7'],
      hands: ['SA HA DA S3 S7 S8', 'H5 H6 HK', 'D9 D10', 'C9 C10'],
      turn: 0,
      abilities: { holder: 0, chosen: ['peek'], used: ['peek'] },
    });
    s.game!.peek = { target: 1, cards: cs('H5 HK') };
    const d = new Driver(s);
    d.play(0, 'SA HA DA');
    d.choose(0, 'S3 S8', { target: 1 }); // 席1の HK と H6 を受け取る
    expect(d.game.hands[0]).toContain('heart-13');
    expect(d.game.peek).toEqual({ target: 1, cards: cs('H5') });
    expect(viewFor(d.state, 0).game?.peek).toEqual({ target: 1, cards: cs('H5') });
    d.pass(1);
    d.pass(2);
    d.pass(3);
    // 場が流れて席0が親。7渡しで HK を席1に戻す
    d.play(0, 'S7');
    d.choose(0, 'HK');
    expect(d.game.hands[1]).toContain('heart-13');
    expect(d.game.peek).toEqual({ target: 1, cards: cs('H5') });
    expect(viewFor(d.state, 0).game?.peek).toEqual({ target: 1, cards: cs('H5') });
    expect(viewFor(d.state, 1).game?.peekedMine).toEqual(cs('H5'));
  });
});

describe('24種の組み合わせで、でたらめな対戦の途中に不正な操作を混ぜても、常に拒否され状態は変わらない', () => {
  it('新しい選択の target・ranks を含む', () => {
    const rng = rngFromSeed([24, 24, 6, 6]);
    const seen = new Set<string>();
    for (let m = 0; m < 12; m++) {
      let rules = (m % 3 === 0 ? [...ALL_RULE_IDS] : ALL_RULE_IDS.filter(() => nextInt(rng, 2) === 1)) as RuleId[];
      rules = rules.filter((r) => (RULE_MODULES.find((x) => x.id === r)?.requires ?? []).every((q) => rules.includes(q)));
      const created = createMatch(cfg(rules, 5), [m + 1, 8, 8, 8]);
      if (!created.ok) throw new Error(created.error.message);
      let s = created.state;
      let steps = 0;
      while (s.phase !== 'matchResult' && steps < 4000) {
        steps++;
        if (s.phase === 'gameResult') {
          const r = applyAction(s, { type: 'nextGame' });
          if (!r.ok) throw new Error();
          s = r.state;
          continue;
        }
        const w = awaiting(s)[0]!;
        const g = s.game!;
        const bad: Action[] = [];
        if (w.kind === 'choice' && g.pending?.type === 'choice') {
          const kind = RULE_MODULES.find((x) => x.id === g.pending!.rule)?.choiceKind;
          seen.add(kind ?? '');
          const hand = g.hands[w.seat]!;
          const base = { type: 'choose' as const, seat: w.seat, awaitId: w.id };
          bad.push({ ...base, cards: [], target: 9 as never }, { ...base, cards: [], ranks: 'x' as never });
          if (kind === 'call') {
            bad.push(
              { ...base, cards: hand.slice(0, 1).length > 0 ? hand.slice(0, 1) : ['spade-3'], ranks: [3] },
              { ...base, cards: [], ranks: [3, 3] },
              { ...base, cards: [], ranks: [3, 4, 5, 6, 7].slice(0, g.pending.max + 1) as never },
              { ...base, cards: [], ranks: [2 as never] },
              { ...base, cards: [], ranks: [3], target: ((w.seat + 1) % 4) as never },
            );
          } else {
            bad.push({ ...base, cards: hand.slice(0, 1), ranks: [3] });
            if (kind === 'trade') {
              bad.push({ ...base, cards: hand.slice(0, 1), target: w.seat }, { ...base, cards: hand.slice(0, 1) });
              const others = ([0, 1, 2, 3] as const).filter((x) => x !== w.seat && g.hands[x]!.length > 0 && !g.topOrder.includes(x) && !g.bottomOrder.includes(x));
              const t = others[0];
              if (t !== undefined) {
                const need = Math.min(g.pending.max, hand.length, g.hands[t]!.length);
                if (hand.length > need) bad.push({ ...base, cards: hand.slice(0, need + 1), target: t });
                if (need > 1) bad.push({ ...base, cards: hand.slice(0, need - 1), target: t });
              }
            } else if (hand.length > 0) {
              bad.push({ ...base, cards: hand.slice(0, 1), target: ((w.seat + 1) % 4) as never });
            }
          }
        }
        for (const a of bad) {
          const before = JSON.stringify(s);
          const r = applyAction(s, a);
          expect(r.ok, JSON.stringify(a)).toBe(false);
          expect(JSON.stringify(s)).toBe(before);
        }
        const r = applyAction(s, randomAction(s, rng));
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
      }
      expect(s.phase).toBe('matchResult');
    }
    for (const k of ['salvage', 'trade', 'call']) expect(seen, k).toContain(k);
  }, 60_000);
});
