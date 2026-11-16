import { describe, expect, it } from 'vitest';
import { legalPlays, type RuleId } from '../index.ts';
import { Driver, cs, scene } from '../test/helpers.ts';

function lastHand(rules: RuleId[], last: string, opts: { revolution?: boolean } = {}) {
  return new Driver(
    scene({ rules, hands: [last, 'H4 H5', 'D4 D5', 'C4 C5'], turn: 0, ...(opts.revolution ? { revolution: true } : {}) }),
  );
}

describe('禁止上がり（decisions §6.9、§14.4）', () => {
  const ff: RuleId[] = ['forbidden_finish'];

  it('ジョーカーを含む手で上がると反則。confirmFoul がないと出せない', () => {
    const d = lastHand(ff, 'X0');
    const w = d.current();
    expect(legalPlays(d.state, 0)).toEqual([expect.objectContaining({ cards: ['joker-0'], foul: true })]);
    const r = d.try({ type: 'play', seat: 0, awaitId: w.id, cards: ['joker-0'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('confirmFoulRequired');
    d.play(0, 'X0', { confirmFoul: true });
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, place: 4, reason: 'foul' });
  });

  it('いちばん強い数字の組（通常は2、逆なら3）で上がると反則', () => {
    expect(legalPlays(lastHand(ff, 'S2').state, 0)[0]?.foul).toBe(true);
    expect(legalPlays(lastHand(ff, 'S3').state, 0)[0]?.foul).toBe(false);
    expect(legalPlays(lastHand(ff, 'S3', { revolution: true }).state, 0)[0]?.foul).toBe(true);
    expect(legalPlays(lastHand(ff, 'S2', { revolution: true }).state, 0)[0]?.foul).toBe(false);
  });

  it('8の組は8切りが ON のときだけ反則', () => {
    expect(legalPlays(lastHand(ff, 'S8').state, 0)[0]?.foul).toBe(false);
    expect(legalPlays(lastHand([...ff, 'flush_on_8'], 'S8').state, 0)[0]?.foul).toBe(true);
  });

  it('階段の途中に8や2があるだけなら反則にならない', () => {
    const d = lastHand([...ff, 'runs', 'flush_on_8'], 'S7 S8 S9');
    expect(legalPlays(d.state, 0).find((p) => p.shape === 'run')?.foul).toBe(false);
    const e = lastHand([...ff, 'runs'], 'SK SA S2');
    expect(legalPlays(e.state, 0).find((p) => p.shape === 'run')?.foul).toBe(false);
  });

  it('上がらない手は反則の印が付かない', () => {
    const d = lastHand(ff, 'X0 S5 H9');
    expect(legalPlays(d.state, 0).every((p) => !p.foul)).toBe(true);
  });

  it('OFF なら何で上がっても反則にならない', () => {
    const d = lastHand([], 'X0');
    d.play(0, 'X0');
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 0, place: 1, reason: 'finish' });
  });

  it('判定は出す直前の向き: 通常時に2の4枚組で上がると反則、3の4枚組は反則ではない（§14.4）', () => {
    const rules: RuleId[] = [...ff, 'revolution'];
    expect(legalPlays(lastHand(rules, 'S2 H2 D2 C2').state, 0).find((p) => p.cards.length === 4)?.foul).toBe(true);
    expect(legalPlays(lastHand(rules, 'S3 H3 D3 C3').state, 0).find((p) => p.cards.length === 4)?.foul).toBe(false);
  });

  it('反則上がりでも手の効果は起きる（8切りで場が流れる、革命が起きる、§14.4）', () => {
    const d = lastHand([...ff, 'flush_on_8'], 'S8');
    d.play(0, 'S8', { confirmFoul: true });
    expect(d.events.find((e) => e.type === 'fieldCleared')).toMatchObject({ reason: 'flush_on_8', leader: 1 });
    const e = lastHand([...ff, 'revolution'], 'S2 H2 D2 C2');
    e.play(0, 'S2 H2 D2 C2', { confirmFoul: true });
    expect(e.game.revolution).toBe(true);
    expect(e.events.find((x) => x.type === 'placed')).toMatchObject({ place: 4, reason: 'foul' });
  });

  it('反則上がりだけでは都落ちの引き金にならない（§4.2）', () => {
    const d = new Driver(
      scene({ rules: ['forbidden_finish', 'dethrone'], prevRanks: [3, 1, 2, 4], hands: ['X0', 'H4 H5', 'D4 D5', 'C4 C5'], turn: 0 }),
    );
    d.play(0, 'X0', { confirmFoul: true });
    expect(d.types()).not.toContain('dethrone');
    expect(cs('H4 H5')).toEqual(d.game.hands[1]);
  });
});
