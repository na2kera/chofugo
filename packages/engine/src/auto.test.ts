// auto 操作（timeout: decisions §8、cpu: design §3.6・decisions §14.9）。
import { describe, expect, it } from 'vitest';
import type { GameEvent, RuleId } from './index.ts';
import { Driver, cs, scene } from './test/helpers.ts';

function autoOnce(rules: RuleId[], hands: string[], policy: 'cpu' | 'timeout', prep?: (d: Driver) => void): GameEvent[] {
  const d = new Driver(scene({ rules, hands, turn: 0 }));
  prep?.(d);
  return d.apply({ type: 'auto', awaitId: d.current().id, policy });
}

describe('時間切れ（§8）', () => {
  it('親でないときはパス', () => {
    const ev = autoOnce([], ['S5 S9', 'H6 H8', 'D4', 'C4'], 'timeout', (d) => d.play(0, 'S5'));
    expect(ev[0]).toMatchObject({ type: 'pass', seat: 1 });
  });
  it('親のときは1枚出しのうち、いちばん弱いカード', () => {
    const ev = autoOnce([], ['S9 H5 D5 C2', 'H6', 'D4', 'C4'], 'timeout');
    expect(ev[0]).toMatchObject({ type: 'play', play: { cards: cs('H5') } });
  });
  it('強さが逆なら逆の向きでいちばん弱いもの', () => {
    const d = new Driver(scene({ rules: [], revolution: true, hands: ['S9 H5 C2', 'H6', 'D4', 'C4'], turn: 0 }));
    const ev = d.apply({ type: 'auto', awaitId: d.current().id, policy: 'timeout' });
    expect(ev[0]).toMatchObject({ type: 'play', play: { cards: cs('C2') } });
  });
  it('反則上がりになる手は、ほかに出せる手がある限り選ばない', () => {
    // 2 とジョーカーしかない: 1枚出しはどれも反則にならない（2枚残る）
    const a = autoOnce(['forbidden_finish'], ['S2 X0', 'H6', 'D4', 'C4'], 'timeout');
    expect(a[0]).toMatchObject({ type: 'play', play: { cards: cs('S2') } });
    // 最後の1枚が2: ほかに出せる手がないので反則で出す
    const b = autoOnce(['forbidden_finish'], ['S2', 'H6', 'D4', 'C4'], 'timeout');
    expect(b[0]).toMatchObject({ type: 'play', foul: true });
  });
  it('返しの一周はスキップ', () => {
    const ev = autoOnce(['spade3_beats_joker'], ['X0 S4', 'S3 H5', 'D4', 'C4'], 'timeout', (d) => d.play(0, 'X0'));
    expect(ev[0]).toMatchObject({ type: 'respondSkip', seat: 1 });
  });
});

describe('CPU（§3.6、§14.9）', () => {
  it('親: いちばん弱い数字、同じ数字なら枚数の多い手', () => {
    const ev = autoOnce([], ['S4 H4 S9 SK', 'H6', 'D4', 'C4'], 'cpu');
    expect(ev[0]).toMatchObject({ type: 'play', play: { cards: cs('S4 H4') } });
  });
  it('親でない: 出せる手のうちいちばん弱いもの。なければパス', () => {
    const a = autoOnce([], ['S5 S9', 'H6 HK H8', 'D4', 'C4'], 'cpu', (d) => d.play(0, 'S5'));
    expect(a[0]).toMatchObject({ type: 'play', play: { cards: cs('H6') } });
    const b = autoOnce([], ['SA S9', 'H6 HK H8', 'D4', 'C4'], 'cpu', (d) => d.play(0, 'SA'));
    expect(b[0]).toMatchObject({ type: 'pass', seat: 1 });
  });
  it('反則上がりは、パスを含めてほかに選べる行動がある限り選ばない', () => {
    const ev = autoOnce(['forbidden_finish'], ['S5 S9', 'S2', 'D4', 'C4'], 'cpu', (d) => d.play(0, 'S5'));
    expect(ev[0]).toMatchObject({ type: 'pass', seat: 1 });
  });
  it('返せるなら必ず返す', () => {
    const ev = autoOnce(['spade3_beats_joker'], ['X0 S4', 'S3 H5', 'D4', 'C4'], 'cpu', (d) => d.play(0, 'X0'));
    expect(ev[0]).toMatchObject({ type: 'respond', seat: 1, play: { cards: ['spade-3'] } });
  });
  it('並べ方: 枚数の多い順のあと、組を階段より先に', () => {
    const ev = autoOnce(['runs'], ['S3 S4 S5 H3 D3', 'H6', 'D4', 'C4'], 'cpu');
    // 3 が最弱。3枚の組（♠♥♦の3）と3枚の階段（♠3-4-5）は同じ枚数なので組が先
    expect(ev[0]).toMatchObject({ type: 'play', play: { shape: 'group', cards: cs('S3 H3 D3') } });
  });
});
