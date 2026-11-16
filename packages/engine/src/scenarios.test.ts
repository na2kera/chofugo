// decisions §14 の各場面を、状態を直接作って確かめる（design §8.3）。
import { describe, expect, it } from 'vitest';
import { Driver, scene } from './test/helpers.ts';

describe('§14.1 場が流れる条件', () => {
  it('出した人が抜けたあと、その席に着いたら流れ、親はその席から進行方向で次の残っている人', () => {
    const d = new Driver(scene({ rules: [], hands: ['S4 S5', 'H6 H7', 'D9', 'C8 C3'], turn: 1 }));
    d.play(1, 'H6');
    d.play(2, 'D9'); // 2 が上がる
    d.pass(3);
    d.pass(0);
    d.pass(1);
    expect(d.events.filter((e) => e.type === 'fieldCleared').at(-1)).toMatchObject({ reason: 'allPassed', leader: 3 });
  });
});

describe('§14.2 順位の確定', () => {
  it('上がりは上から、強制最下位は下から埋める', () => {
    const d = new Driver(scene({ rules: ['forbidden_finish'], hands: ['S2', 'H6 H3', 'D9 D4', 'C8 C7'], turn: 0 }));
    d.play(0, 'S2', { confirmFoul: true });
    expect(d.places()).toEqual([4, null, null, null]);
    d.pass(1);
    d.pass(2);
    d.pass(3);
    d.play(1, 'H3');
    d.play(2, 'D4');
    d.play(3, 'C7');
    d.pass(1);
    d.pass(2);
    d.play(3, 'C8'); // 3 が1位
    expect(d.places()?.[3]).toBe(1);
  });
});

describe('§14.3 上がりが決まる時点', () => {
  it('A が最後のジョーカー、B が最後のスペードの3で返すと、A が先・B が次の順位', () => {
    const d = new Driver(scene({ rules: ['spade3_beats_joker'], hands: ['X0', 'S3', 'D9 D4', 'C8 C7'], turn: 0 }));
    d.play(0, 'X0');
    expect(d.places()).toEqual([1, null, null, null]);
    d.respond(1, 'S3');
    expect(d.places()).toEqual([1, 2, null, null]);
    // 流れたあとの親は 1 の次の 2
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
    const types = d.types();
    expect(types.indexOf('placed')).toBeLessThan(types.indexOf('returnRoundStart'));
  });

  it('1位の確定と都落ちは返しの一周より前に処理し、都落ちした人は一周に参加しない', () => {
    const d = new Driver(
      scene({ rules: ['spade3_beats_joker', 'dethrone'], prevRanks: [3, 4, 1, 2], hands: ['X0', 'H5 H6', 'S3 D4', 'C8 C7'], turn: 0 }),
    );
    d.play(0, 'X0');
    const start = d.events.find((e) => e.type === 'returnRoundStart');
    expect(start).toMatchObject({ participants: [1, 3] });
    const t = d.types();
    expect(t.indexOf('dethrone')).toBeLessThan(t.indexOf('returnRoundStart'));
    expect(d.places()).toEqual([1, null, 4, null]);
    expect(d.current()).toMatchObject({ seat: 1, kind: 'respond' });
    d.respond(1, null);
    d.respond(3, null);
    // 不成立: ジョーカーを出した 0 は抜けているので、0 の次の残っている 1 が親
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('返した人が1位になった場合も都落ちが起きる', () => {
    const d = new Driver(
      scene({ rules: ['spade3_beats_joker', 'dethrone'], prevRanks: [3, 1, 4, 2], hands: ['X0 H9', 'H5 H6', 'S3', 'C8 C7'], turn: 0 }),
    );
    d.play(0, 'X0');
    d.respond(1, null);
    d.respond(2, 'S3');
    expect(d.places()).toEqual([null, 4, 1, null]);
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
  });

  it('返しの一周の参加者が全員抜けていれば一周は不成立で終わる', () => {
    const d = new Driver(
      scene({ rules: ['spade3_beats_joker', 'dethrone'], prevRanks: [3, 1, 4, 2], hands: ['X0', 'H5 H6', 'S3', 'C8 C7'], turn: 0 }),
    );
    // 0 の上がりで1位 → 前の大富豪 1 が都落ち → 残りは 2 と 3
    d.play(0, 'X0');
    expect(d.events.find((e) => e.type === 'returnRoundStart')).toMatchObject({ participants: [2, 3] });
  });
});

describe('§14.4 禁止上がりの判定と、反則のときの効果', () => {
  it('反則の判定は出す直前の向き。反則でも8切りなどの効果は起きる', () => {
    const d = new Driver(
      scene({ rules: ['forbidden_finish', 'revolution', 'flush_on_8'], hands: ['S3 H3 D3 C3', 'H5 H6', 'D9 D4', 'C8 C7'], turn: 0 }),
    );
    d.play(0, 'S3 H3 D3 C3'); // 3の4枚組は通常時には反則ではない
    expect(d.places()?.[0]).toBe(1);
    expect(d.game.revolution).toBe(true);
  });
});

describe('§14.6 ジョーカーの解釈を決める時点', () => {
  it('出した時点の解釈を記録し、あとで向きが変わっても変えない', () => {
    const d = new Driver(
      scene({ rules: ['runs', 'revolution'], hands: ['S5 S6 X0 H9', 'D8 D9 D10 DJ C4', 'C3', 'H4'], turn: 0 }),
    );
    d.play(0, 'S5 S6 X0');
    const before = structuredLike(d.game.field[0]);
    d.pass(1);
    d.pass(2);
    d.pass(3);
    d.play(0, 'H9');
    expect(d.game.field).toHaveLength(1);
    // 0 の階段は捨て札へ。記録されていた解釈は 5-6-7
    expect(before).toMatchObject({ play: { low: 5, high: 7, jokers: [{ rank: 7 }] } });
  });

  it('縛りは、比べる2つの手のどちらかにジョーカーが含まれていれば成立しない', () => {
    const d = new Driver(scene({ rules: ['suit_lock'], hands: ['S5 S3', 'X0 H4', 'S9 D4', 'C8 C7'], turn: 0 }));
    d.play(0, 'S5');
    d.play(1, 'X0'); // ジョーカーの1枚出し（すぐ流れる）
    expect(d.game.suitLock).toBeNull();
  });
});

describe('§14.7 返しの一周が無視する制限と守る制限', () => {
  it('参加するのは、一周が始まる時点で残っている、出した人以外の全員（パス済みでも）', () => {
    const d = new Driver(scene({ rules: ['spade3_beats_joker'], hands: ['H4 X0 S9', 'H5 S3', 'D6', 'C7 C8'], turn: 0 }));
    d.play(0, 'H4');
    d.play(1, 'H5');
    d.play(2, 'D6'); // 2 が上がる
    d.pass(3);
    d.play(0, 'X0');
    expect(d.events.find((e) => e.type === 'returnRoundStart')).toMatchObject({ participants: [1, 3] });
  });
});

function structuredLike<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('§2.4 親が出せる手を持たないとき（その1のルールだけでは起きないため、中心の処理を直接確かめる）', () => {
  it('出せる手がない親はパスでき、場が流れた扱いになって次の人が親になる', async () => {
    const { makeCtx, legalTurnPlays, doPass } = await import('./game.ts');
    const s = JSON.parse(JSON.stringify(scene({ rules: [], tempReverse: true, hands: ['S5', 'H6 H7', 'D4 D9', 'C4 C8'], turn: 0 })));
    const c = makeCtx(s);
    // すべての手を封じる仮のモジュール（その3の独裁を想定）
    c.mods.push({ id: 'diamond3_start', restrictPlay: () => ({ kind: 'suitLock' }), onFieldCleared: () => [{ type: 'setTempReverse', active: false }] });
    expect(legalTurnPlays(c, 0)).toEqual([]);
    doPass(c, 0);
    expect(s.game.tempReverse).toBe(false);
    expect(s.game.awaiting).toEqual([expect.objectContaining({ seat: 1, kind: 'turn' })]);
    expect(c.events.map((e: { type: string }) => e.type)).toEqual(['pass', 'tempReverse', 'fieldCleared']);
    expect(c.events[2]).toMatchObject({ reason: 'leaderPassed', leader: 1 });
  });
});
