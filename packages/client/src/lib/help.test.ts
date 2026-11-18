import { describe, expect, it } from 'vitest';
import { ALL_ABILITY_IDS, ALL_RULE_IDS, DAIFUGO_MODE_DEFAULT_RULES, type MyAwaiting } from '@chofugo/engine';
import { ABILITY_DEMOS, RULE_DEMOS, type RuleDemoData } from '../rule-demos.ts';
import {
  advanceDemo,
  demoOf,
  demoProblems,
  demoShape,
  FRAME_MS,
  frameDuration,
  helpSections,
  LAST_FRAME_MS,
  nextAdvanceAt,
  nextFrame,
  parseFixedFrame,
  showYourTurn,
} from './help.ts';

describe('見本のコマの進め方（design-5 §6.6）', () => {
  it('次のコマへ。最後のあとは最初へ戻る', () => {
    expect(nextFrame(0, 3)).toBe(1);
    expect(nextFrame(1, 3)).toBe(2);
    expect(nextFrame(2, 3)).toBe(0);
    expect(nextFrame(3, 4)).toBe(0);
  });

  it('1コマ 1.4 秒、最後のコマだけ 2.2 秒', () => {
    expect(frameDuration(0, 4)).toBe(FRAME_MS);
    expect(frameDuration(2, 4)).toBe(FRAME_MS);
    expect(frameDuration(3, 4)).toBe(LAST_FRAME_MS);
    expect(FRAME_MS).toBe(1400);
    expect(LAST_FRAME_MS).toBe(2200);
  });

  it('自動で進むと、進んだ時刻から次の時刻を数える', () => {
    let c = { frame: 0, since: 0 };
    expect(nextAdvanceAt(c, 3)).toBe(1400);
    c = advanceDemo(c, 3, 1400);
    expect(c).toEqual({ frame: 1, since: 1400 });
    c = advanceDemo(c, 3, nextAdvanceAt(c, 3));
    expect(c).toEqual({ frame: 2, since: 2800 });
    // 最後のコマは 2.2 秒出してから最初へ
    expect(nextAdvanceAt(c, 3)).toBe(5000);
    expect(advanceDemo(c, 3, 5000)).toEqual({ frame: 0, since: 5000 });
  });

  it('押したら次のコマへ進み、そこから数え直す（押した直後に自動でもう1つ進まない）', () => {
    const c0 = { frame: 0, since: 0 };
    // 本来は 1400 で進むところ、1300 で押した
    const c1 = advanceDemo(c0, 4, 1300);
    expect(c1.frame).toBe(1);
    expect(nextAdvanceAt(c1, 4)).toBe(2700);
    expect(nextAdvanceAt(c1, 4)).not.toBe(1400);
    // 最後のコマで押すと最初へ
    expect(advanceDemo({ frame: 3, since: 0 }, 4, 500)).toEqual({ frame: 0, since: 500 });
  });

  it('見本ページの frame= は1から数え、範囲の外は端に寄せる', () => {
    expect(parseFixedFrame('2', 4)).toBe(1);
    expect(parseFixedFrame('1', 4)).toBe(0);
    expect(parseFixedFrame('9', 3)).toBe(2);
    expect(parseFixedFrame('0', 3)).toBe(0);
    expect(parseFixedFrame(null, 3)).toBeNull();
    expect(parseFixedFrame('x', 3)).toBeNull();
    expect(parseFixedFrame('1.5', 3)).toBeNull();
  });
});

describe('見本の枠の大きさ（design-5 §6.5）', () => {
  it('札が1コマでもあれば札の行を空け、行はいちばん多い数だけ空ける', () => {
    expect(demoShape(RULE_DEMOS.temp_reverse_on_j!)).toEqual({ badges: true, rows: 0 });
    expect(demoShape(RULE_DEMOS.triple3_trump!)).toEqual({ badges: false, rows: 0 });
    expect(demoShape(RULE_DEMOS.triple_a_trade!)).toEqual({ badges: false, rows: 2 });
  });
});

describe('見本のデータ（design-5 §4.3、§6.2）', () => {
  const all: [string, RuleDemoData][] = [
    ...Object.entries(RULE_DEMOS).map(([k, v]) => [`rule:${k}`, v!] as [string, RuleDemoData]),
    ...Object.entries(ABILITY_DEMOS).map(([k, v]) => [`ability:${k}`, v!] as [string, RuleDemoData]),
  ];

  it('第1弾の3つがある（J バック・砂嵐・闇市）', () => {
    expect(Object.keys(RULE_DEMOS).sort()).toEqual(['temp_reverse_on_j', 'triple3_trump', 'triple_a_trade'].sort());
    expect(Object.keys(ABILITY_DEMOS)).toEqual([]);
  });

  it.each(all)('%s：コマ2〜4、場4枚以下、行2つ以下・各4枚以下、説明16文字以下、カードの ID、同じコマに同じカードが2回出ない', (_, data) => {
    expect(demoProblems(data)).toEqual([]);
  });

  it('ID はルール・特権の ID だけ', () => {
    for (const k of Object.keys(RULE_DEMOS)) expect(ALL_RULE_IDS as readonly string[]).toContain(k);
    for (const k of Object.keys(ABILITY_DEMOS)) expect(ALL_ABILITY_IDS as readonly string[]).toContain(k);
  });

  it('見本のない項目は null（名前と説明の文だけを出す）', () => {
    expect(demoOf({ kind: 'rule', id: 'flush_on_8' })).toBeNull();
    expect(demoOf({ kind: 'ability', id: 'revolution' })).toBeNull();
    expect(demoOf({ kind: 'rule', id: 'triple3_trump' })).not.toBeNull();
  });

  describe('検査が誤りを見つける', () => {
    it('コマの数・場の枚数・行の数・行の枚数・説明の長さ', () => {
      expect(demoProblems([{ field: [], note: 'a' }])).toEqual(['コマの数が 1']);
      expect(demoProblems(Array.from({ length: 5 }, () => ({ field: [], note: 'a' })))).toEqual(['コマの数が 5']);
      const p = demoProblems([
        { field: ['spade-3', 'spade-4', 'spade-5', 'spade-6', 'spade-7'], note: 'あいうえおかきくけこさしすせそたち' },
        {
          field: [],
          rows: [
            { label: 'あなた', cards: ['club-3', 'club-4', 'club-5', 'club-6', 'club-7'] },
            { label: '相手', cards: [] },
            { label: '捨て札', cards: [] },
          ],
          note: '',
        },
      ]);
      expect(p).toContain('1コマ目：場が 5枚');
      expect(p).toContain('1コマ目：説明が 17文字');
      expect(p).toContain('2コマ目：行が 3つ');
      expect(p).toContain('2コマ目：「あなた」が 5枚');
      expect(p).toContain('2コマ目：説明がない');
    });

    it('16文字ちょうどは通る（半角も1文字に数える）', () => {
      expect(demoProblems([{ field: [], note: 'あいうえおかきくけこさしすせそた' }, { field: [], note: 'J より弱い数字を出す' }])).toEqual([]);
    });

    it('知らないカード・同じコマの中の重なり（場と行を合わせて）・行にないカードの強調', () => {
      const p = demoProblems([
        { field: ['spade-1', 'heart-11'], rows: [{ label: '相手', cards: ['heart-11', 'back', 'back'], mark: ['club-9'] }], note: 'a' },
        { field: ['heart-11'], rows: [{ label: 'あなた', cards: ['spade-9'] }], note: 'b' },
      ]);
      expect(p).toEqual(['1コマ目：知らないカード spade-1', '1コマ目：heart-11 が2回', '1コマ目：「相手」にない club-9 を強調']);
    });

    it('行のカードが0枚でもよい（見出しとカード1枚ぶんの高さを残す）', () => {
      expect(demoProblems([{ field: ['club-6'], rows: [{ label: 'ほかの人', cards: [] }], note: 'a' }, { field: [], note: 'b' }])).toEqual([]);
    });
  });
});

describe('一覧の「使う・使わない」（design-5 §3.1）', () => {
  const usedNames = (mode: 'daifugo' | 'custom' | 'chofugo', rules: readonly (typeof ALL_RULE_IDS)[number][]) =>
    helpSections(mode, rules).map((s) => [s.title, s.entries.filter((e) => e.used).map((e) => e.item.id)]);

  it('見出しは 定番・応用・特殊・特権 で、並びはロビーと同じ（特権は ALL_ABILITY_IDS の順）', () => {
    const secs = helpSections('daifugo', []);
    expect(secs.map((s) => s.title)).toEqual(['定番', '応用', '特殊', '特権']);
    expect(secs.map((s) => s.entries.length)).toEqual([8, 8, 8, 6]);
    expect(secs[3]!.entries.map((e) => e.item.id)).toEqual([...ALL_ABILITY_IDS]);
    expect(secs[0]!.entries[0]!.name).toBe('8切り');
    expect(secs[3]!.entries[4]!.item).toEqual({ kind: 'ability', id: 'revolution' });
    expect(secs[0]!.entries[1]!.item).toEqual({ kind: 'rule', id: 'revolution' });
  });

  it('大富豪モード：設定に入っているルールだけが明るい。特権は暗い', () => {
    const u = usedNames('daifugo', DAIFUGO_MODE_DEFAULT_RULES);
    expect(u[0]![1]).toEqual(helpSections('daifugo', []).at(0)!.entries.map((e) => e.item.id).filter((id) => (DAIFUGO_MODE_DEFAULT_RULES as readonly string[]).includes(id)));
    expect(u[1]![1]).toEqual([]);
    expect(u[2]![1]).toEqual([]);
    expect(u[3]![1]).toEqual([]);
  });

  it('カスタムモード：ON のルールだけが明るい。特権は暗い', () => {
    const u = usedNames('custom', ['flush_on_8', 'triple3_trump', 'triple_a_trade']);
    expect(u).toEqual([
      ['定番', ['flush_on_8']],
      ['応用', ['triple3_trump']],
      ['特殊', ['triple_a_trade']],
      ['特権', []],
    ]);
  });

  it('超富豪モード：24種と特権6種がすべて明るい', () => {
    const secs = helpSections('chofugo', ALL_RULE_IDS);
    expect(secs.every((s) => s.entries.every((e) => e.used))).toBe(true);
  });
});

describe('「あなたの番です」を出す条件（design-5 §6.4）', () => {
  it('手番・返し・選択・交換・特権の選択のときだけ', () => {
    const kinds = ['turn', 'respond', 'choice', 'exchangeGive', 'abilitySelect'] as const;
    for (const kind of kinds) expect(showYourTurn({ awaitId: 1, kind } as MyAwaiting)).toBe(true);
    expect(showYourTurn(null)).toBe(false);
    expect(showYourTurn(undefined)).toBe(false);
  });
});
