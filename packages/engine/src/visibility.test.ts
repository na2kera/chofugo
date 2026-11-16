// 見える情報のテスト（design §3.8、§3.9）。
// ある席の手札と公開情報を固定し、ほかの席の非公開の手札だけを入れ替えても、
// その席の viewFor / legalPlays / eventsFor が変わらないことを確かめる。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  awaiting,
  createMatch,
  eventsFor,
  IMPLEMENTED_RULE_IDS,
  legalPlays,
  viewFor,
  type Action,
  type MatchState,
  type RuleId,
  type SeatId,
} from './index.ts';
import { sortCardIds } from './cards.ts';
import { deepClone } from './clone.ts';
import { nextInt, rngFromSeed, type RngState } from './rng.ts';
import { cfg, cs, randomAction, scene } from './test/helpers.ts';

const SEATS: SeatId[] = [0, 1, 2, 3];

/** viewer 以外の2席の手札から1枚ずつ入れ替える（枚数は変わらない）。 */
function swapHidden(s: MatchState, viewer: SeatId, rng: RngState): MatchState | null {
  const g = s.game!;
  const others = SEATS.filter((x) => x !== viewer && g.hands[x]!.length > 0);
  if (others.length < 2) return null;
  const a = others[nextInt(rng, others.length)]!;
  const rest = others.filter((x) => x !== a);
  const b = rest[nextInt(rng, rest.length)]!;
  const t = deepClone(s);
  const ha = t.game!.hands[a]!;
  const hb = t.game!.hands[b]!;
  const i = nextInt(rng, ha.length);
  const j = nextInt(rng, hb.length);
  const ca = ha[i]!;
  ha[i] = hb[j]!;
  hb[j] = ca;
  t.game!.hands[a] = sortCardIds(ha);
  t.game!.hands[b] = sortCardIds(hb);
  return t;
}

/** viewer から見て同じ状態か（view・出せる手）。 */
function sameForViewer(a: MatchState, b: MatchState, viewer: SeatId) {
  expect(viewFor(b, viewer)).toStrictEqual(viewFor(a, viewer));
  expect(legalPlays(b, viewer)).toStrictEqual(legalPlays(a, viewer));
}

function viewerAction(s: MatchState, viewer: SeatId, rng: RngState): Action | null {
  // viewer 自身の操作か、他人の操作のうち非公開の手札によらないもの（パス・スキップ）
  const ws = awaiting(s);
  const mine = ws.find((w) => w.seat === viewer);
  if (mine !== undefined) {
    const only: MatchState = { ...s, game: { ...s.game!, awaiting: [mine] } };
    return randomAction(only, rng);
  }
  const w = ws[0];
  if (w === undefined) return null;
  if (w.kind === 'respond') return { type: 'respond', seat: w.seat, awaitId: w.id, cards: null };
  if (w.kind === 'turn' && s.game!.lastPlayer !== null) return { type: 'pass', seat: w.seat, awaitId: w.id };
  return null;
}

describe('見える情報', () => {
  it('非公開の手札を入れ替えても、その席から見える状態・出せる手・出来事は変わらない', () => {
    const rng = rngFromSeed([3, 1, 4, 1]);
    let checked = 0;
    let respondChecked = 0;
    for (let m = 0; m < 30; m++) {
      const rules = IMPLEMENTED_RULE_IDS.filter((_, i) => (m + i) % 3 !== 0) as RuleId[];
      const created = createMatch(cfg(rules, 5), [m + 11, 5, 8, 13]);
      if (!created.ok) throw new Error();
      let s = created.state;
      let steps = 0;
      while (s.phase !== 'matchResult' && steps < 5000) {
        steps++;
        if (s.phase === 'gameResult') {
          const r = applyAction(s, { type: 'nextGame' });
          if (!r.ok) throw new Error();
          s = r.state;
          continue;
        }
        // 交換フェーズは対象外（下位に選択待ちが出るかどうかが、待ちとして公開される。engine-assumptions.md）
        if (s.phase === 'play' && nextInt(rng, 4) === 0) {
          const viewer = SEATS[nextInt(rng, 4)]!;
          const t = swapHidden(s, viewer, rng);
          if (t !== null) {
            sameForViewer(s, t, viewer);
            const a = viewerAction(s, viewer, rng);
            if (a !== null) {
              if (a.type === 'respond' || awaiting(s)[0]?.kind === 'respond') respondChecked++;
              const ra = applyAction(s, a);
              const rb = applyAction(t, a);
              expect(rb.ok).toBe(ra.ok);
              // 都落ちは手札を全員に公開する決まり（§4.1）なので、その手のあとは比べない
              const revealed = ra.ok && ra.events.some((e) => e.type === 'dethrone');
              if (ra.ok && rb.ok && !revealed) {
                expect(eventsFor(rb.events, viewer)).toStrictEqual(eventsFor(ra.events, viewer));
                sameForViewer(ra.state, rb.state, viewer);
                expect(awaiting(rb.state)).toStrictEqual(awaiting(ra.state));
              }
            }
            checked++;
          }
        }
        const r = applyAction(s, randomAction(s, rng));
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(respondChecked).toBeGreaterThan(0);
  }, 60_000);

  it('返しの一周: スペードの3がどの席にあっても、ほかの席から見た待ちと view は同じ', () => {
    const base = (h1: string, h2: string) =>
      scene({ rules: ['spade3_beats_joker'], hands: ['X0 S4', h1, h2, 'C3 CK'], turn: 0 });
    const a = base('S3 H6', 'D7 D8');
    const b = base('D7 H6', 'S3 D8');
    const play: Action = { type: 'play', seat: 0, awaitId: 100, cards: ['joker-0'] };
    const ra = applyAction(a, play);
    const rb = applyAction(b, play);
    if (!ra.ok || !rb.ok) throw new Error();
    for (const viewer of [0, 3] as SeatId[]) {
      expect(eventsFor(rb.events, viewer)).toStrictEqual(eventsFor(ra.events, viewer));
      expect(viewFor(rb.state, viewer)).toStrictEqual(viewFor(ra.state, viewer));
    }
    expect(awaiting(rb.state)).toStrictEqual(awaiting(ra.state));
    // 席1は返せる手が見え、スキップした場合の続きも同じ待ちになる
    expect(legalPlays(ra.state, 1).map((p) => p.cards)).toEqual([cs('S3')]);
    expect(legalPlays(rb.state, 1)).toEqual([]);
  });

  it('viewFor は他人の手札・乱数の状態を含めない', () => {
    const s = createMatch(cfg([...IMPLEMENTED_RULE_IDS] as RuleId[]), [1, 2, 3, 4]);
    if (!s.ok) throw new Error();
    const v = viewFor(s.state, 2);
    const text = JSON.stringify(v);
    for (const seat of [0, 1, 3] as SeatId[]) {
      for (const card of s.state.game!.hands[seat]!) expect(text).not.toContain(`"${card}"`);
    }
    expect(text).not.toContain('rng');
    expect(v.game?.handCounts).toEqual(s.state.game!.hands.map((h) => h.length));
    // 配った出来事も自分の手札だけ
    const ev = eventsFor(s.events, 2);
    const deal = ev.find((e) => e.type === 'deal');
    expect(deal).toMatchObject({ hand: s.state.game!.hands[2] });
    expect(JSON.stringify(ev)).not.toContain(`"${s.state.game!.hands[0]![0]}"`);
  });
});
