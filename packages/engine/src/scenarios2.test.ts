// その2の固定の場面（design-2 §6.5）と、16種の組み合わせでの不正な操作のテスト。
import { describe, expect, it } from 'vitest';
import {
  ALL_RULE_IDS,
  applyAction,
  awaiting,
  createMatch,
  type Action,
  type ApplyResult,
  type MatchState,
  type RuleId,
} from './index.ts';
import { nextInt, rngFromSeed } from './rng.ts';
import { Driver, cfg, cs, randomAction, scene } from './test/helpers.ts';

describe('4止めと9リバース・激縛り・都落ち', () => {
  it('逆回り中に8が出たとき、一周の参加順は逆回り。成立したあとの手番も逆回り', () => {
    const d = new Driver(
      scene({
        rules: ['flush_on_8', 'block_flush_with_4', 'reverse_order_on_9', 'temp_reverse_on_j'],
        tempReverse: true, // 強さが逆なので、9の上に8が出せる
        hands: ['S9 S5', 'H4 D4 H3', 'C9 CJ', 'H8 DQ'],
        turn: 0,
      }),
    );
    d.play(0, 'S9');
    expect(d.current()).toMatchObject({ seat: 3 });
    d.play(3, 'H8');
    expect(d.events.at(-1)).toMatchObject({ type: 'returnRoundStart', source: 3, participants: [2, 1, 0] });
    d.respond(2, null);
    d.respond(1, 'H4 D4');
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
    expect(d.game.orderReversed).toBe(true);
  });

  it('激縛り中に8が出て4止めが成立したとき、激縛りとその基準の数字（8）が保たれる', () => {
    const d = new Driver(
      scene({ rules: ['flush_on_8', 'block_flush_with_4', 'sequence_lock'], hands: ['H6 S5', 'H7 C5', 'H8 C9', 'S4 D4 H9 DQ'], turn: 0 }),
    );
    d.play(0, 'H6');
    d.play(1, 'H7');
    d.play(2, 'H8');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 8 });
    d.respond(3, 'S4 D4');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 8 });
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
    d.play(3, 'H9');
    expect(d.game.seqLock).toEqual({ suits: ['heart'], rank: 9 });
  });

  it('4の2枚で上がった人が1位になり、8を出した本人（前の大富豪）が都落ちする', () => {
    const d = new Driver(
      scene({
        rules: ['flush_on_8', 'block_flush_with_4', 'dethrone'],
        prevRanks: [1, 2, 3, 4],
        hands: ['S8 S5 SQ', 'H4 D4', 'C9 CJ', 'D10 DQ'],
        turn: 0,
      }),
    );
    d.play(0, 'S8');
    d.respond(1, 'H4 D4');
    expect(d.events.slice(-5).map((e) => e.type)).toEqual(['respond', 'returnRoundEnd', 'placed', 'dethrone', 'placed']);
    expect(d.events.filter((e) => e.type === 'placed')).toEqual([
      expect.objectContaining({ seat: 1, place: 1, reason: 'finish' }),
      expect.objectContaining({ seat: 0, place: 4, reason: 'dethrone' }),
    ]);
    expect(d.events.find((e) => e.type === 'dethrone')).toMatchObject({ seat: 0, discarded: cs('S5 SQ') });
    // 8は場に残り、残った2人で続ける
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
    d.pass(2);
    d.pass(3);
    expect(d.events.at(-1)).toMatchObject({ type: 'fieldCleared', reason: 'allPassed', leader: 2 });
  });
});

describe('7渡しと都落ち', () => {
  it('7渡しで上がって1位になり、受け取った人（前の大富豪）が都落ちして、受け取ったカードも含めた手札が公開される', () => {
    const d = new Driver(
      scene({ rules: ['give_on_7', 'dethrone'], prevRanks: [2, 1, 3, 4], hands: ['S7 H5', 'S9 C3', 'D9 D3', 'C9 H3'], turn: 0 }),
    );
    d.play(0, 'S7');
    d.choose(0, 'H5');
    expect(d.events.slice(-4).map((e) => e.type)).toEqual(['give', 'placed', 'dethrone', 'placed']);
    expect(d.events.find((e) => e.type === 'dethrone')).toMatchObject({ seat: 1, discarded: cs('C3 H5 S9') });
    expect(d.game.discard).toEqual(expect.arrayContaining(cs('C3 H5 S9')));
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
  });
});

describe('待ちの途中で JSON に書き出して読み戻す（design-2 §6.5）', () => {
  const roundTrip = (s: MatchState): MatchState => JSON.parse(JSON.stringify(s)) as MatchState;
  const ok = (r: ApplyResult) => {
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  it('choice の待ち: 読み戻した状態からでも、残りの効果（上がりの判定）がちょうど1回だけ処理される', () => {
    const d = new Driver(scene({ rules: ['give_on_7', 'revolution'], hands: ['S7 H7 D7 C7 H5', 'S9 C3', 'D9', 'C9'], turn: 0 }));
    d.play(0, 'S7 H7 D7 C7');
    const s = roundTrip(d.state);
    expect(s).toStrictEqual(d.state);
    const w = awaiting(s)[0]!;
    const a: Action = { type: 'choose', seat: 0, awaitId: w.id, cards: cs('H5') };
    const r1 = ok(applyAction(d.state, a));
    const r2 = ok(applyAction(s, a));
    expect(r2).toStrictEqual(r1);
    expect(r1.events.map((e) => e.type)).toEqual(['give', 'placed']);
    expect(r1.state.game!.pending).toBeNull();
    expect(r1.state.game!.revolution).toBe(true); // 革命は1回だけ（もう一度処理されていない）
    // 同じ待ちには二度と適用できない
    expect(applyAction(r1.state, a).ok).toBe(false);
  });

  it('4止めの respond の待ち: 読み戻した状態からでも、残りの8切りがちょうど1回だけ処理される', () => {
    const d = new Driver(scene({ rules: ['flush_on_8', 'block_flush_with_4'], hands: ['S8 S5', 'H4 D4 H9', 'C9 CJ', 'D10 DQ'], turn: 0 }));
    d.play(0, 'S8');
    d.respond(1, null);
    d.respond(2, null);
    let s = roundTrip(d.state);
    expect(s).toStrictEqual(d.state);
    const w = awaiting(s)[0]!;
    const a: Action = { type: 'respond', seat: 3, awaitId: w.id, cards: null };
    const r1 = ok(applyAction(d.state, a));
    const r2 = ok(applyAction(s, a));
    expect(r2).toStrictEqual(r1);
    expect(r1.events.filter((e) => e.type === 'fieldCleared')).toEqual([expect.objectContaining({ reason: 'flush_on_8', leader: 0 })]);
    s = r1.state;
    expect(s.game!.pending).toBeNull();
    expect(s.game!.discard).toEqual(cs('S8'));
  });
});

describe('16種の組み合わせで、でたらめな対戦の途中に不正な操作を混ぜても、常に拒否され状態は変わらない', () => {
  it('choice・4止めの respond を含む', () => {
    const rng = rngFromSeed([16, 16, 2, 2]);
    let choiceSeen = 0;
    for (let m = 0; m < 12; m++) {
      let rules = (m % 3 === 0 ? [...ALL_RULE_IDS] : ALL_RULE_IDS.filter(() => nextInt(rng, 2) === 1)) as RuleId[];
      if (!rules.includes('flush_on_8')) rules = rules.filter((r) => r !== 'block_flush_with_4');
      const created = createMatch(cfg(rules, 5), [m + 1, 7, 7, 7]);
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
        const ws = awaiting(s);
        const w = ws[0]!;
        const g = s.game!;
        const other = ([0, 1, 2, 3] as const).find((x) => !ws.some((a) => a.seat === x))!;
        const foreign = g.hands.find((h, i) => i !== w.seat && h.length > 0)?.[0] ?? 'nope';
        const bad: Action[] = [
          { type: 'choose', seat: other, awaitId: w.id, cards: [] },
          { type: 'choose', seat: w.seat, awaitId: w.id - 1000, cards: [] },
          { type: 'auto', awaitId: s.nextAwaitId, policy: 'cpu' },
        ];
        if (w.kind === 'choice') {
          choiceSeen++;
          const hand = g.hands[w.seat]!;
          const max = g.pending?.type === 'choice' ? g.pending.max : 0;
          // 上限を超える枚数（手札が足りなければ、手札にないカードを混ぜる）
          const overMax = hand.length > max ? hand.slice(0, max + 1) : [...hand, foreign];
          bad.push(
            { type: 'choose', seat: w.seat, awaitId: w.id, cards: [foreign] },
            { type: 'choose', seat: w.seat, awaitId: w.id, cards: [hand[0]!, hand[0]!] },
            { type: 'choose', seat: w.seat, awaitId: w.id, cards: overMax },
            { type: 'play', seat: w.seat, awaitId: w.id, cards: hand.slice(0, 1) },
            { type: 'pass', seat: w.seat, awaitId: w.id },
          );
        } else {
          bad.push({ type: 'choose', seat: w.seat, awaitId: w.id, cards: [] });
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
    expect(choiceSeen).toBeGreaterThan(0);
  }, 60_000);
});
