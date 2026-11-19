import { describe, expect, it } from 'vitest';
import { ALL_ABILITY_IDS, ALL_RULE_IDS, DAIFUGO_MODE_DEFAULT_RULES, type MyAwaiting } from '@chofugo/engine';
import { ABILITY_DEMOS, RULE_DEMOS, type RuleDemoData } from '../rule-demos.ts';
import {
  advanceDemo,
  closeOverlay,
  demoBadgeProps,
  demoButtonLabel,
  demoOf,
  demoSpeech,
  demoProblems,
  demoShape,
  FRAME_MS,
  frameDuration,
  helpSections,
  LAST_FRAME_MS,
  nextAdvanceAt,
  nextFrame,
  openOverlay,
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
    expect(demoShape(RULE_DEMOS.temp_reverse_on_j)).toEqual({ badges: true, rows: 0 });
    expect(demoShape(RULE_DEMOS.triple3_trump)).toEqual({ badges: false, rows: 0 });
    expect(demoShape(RULE_DEMOS.triple_a_trade)).toEqual({ badges: false, rows: 2 });
    // 札と行の両方がある見本（大革命・Q ボンバー）と、行が2つの見本（銀河鉄道）
    expect(demoShape(RULE_DEMOS.quad2_instant_win)).toEqual({ badges: true, rows: 1 });
    expect(demoShape(RULE_DEMOS.call_discard_on_q)).toEqual({ badges: true, rows: 1 });
    expect(demoShape(RULE_DEMOS.triple9_salvage)).toEqual({ badges: false, rows: 2 });
    expect(demoShape(ABILITY_DEMOS.ban)).toEqual({ badges: true, rows: 0 });
  });
});

describe('見本のデータ（design-5 §4.3、§6.2）', () => {
  const all: [string, RuleDemoData][] = [
    ...ALL_RULE_IDS.map((k) => [`rule:${k}`, RULE_DEMOS[k]] as [string, RuleDemoData]),
    ...ALL_ABILITY_IDS.map((k) => [`ability:${k}`, ABILITY_DEMOS[k]] as [string, RuleDemoData]),
  ];

  it('30個そろっている（ルール24種・特権6種。余分な ID もない）', () => {
    expect(all).toHaveLength(30);
    expect(Object.keys(RULE_DEMOS).sort()).toEqual([...ALL_RULE_IDS].sort());
    expect(Object.keys(ABILITY_DEMOS).sort()).toEqual([...ALL_ABILITY_IDS].sort());
    for (const [, data] of all) expect(Array.isArray(data)).toBe(true);
  });

  it.each(all)('%s：コマ2〜4、場4枚以下、行2つ以下・各4枚以下、説明16文字以下、カードの ID、同じコマに同じカードが2回出ない', (_, data) => {
    expect(demoProblems(data)).toEqual([]);
  });

  it('革命はルールと特権で別の見本を引く', () => {
    expect(demoOf({ kind: 'rule', id: 'revolution' })).toBe(RULE_DEMOS.revolution);
    expect(demoOf({ kind: 'ability', id: 'revolution' })).toBe(ABILITY_DEMOS.revolution);
    expect(RULE_DEMOS.revolution).not.toBe(ABILITY_DEMOS.revolution);
  });

  it('行のカードが0枚の見本（禁止上がりの2コマ目）', () => {
    const f = RULE_DEMOS.forbidden_finish[1]!;
    expect(f.rows).toEqual([{ label: 'あなた', cards: [] }]);
    expect(demoProblems(RULE_DEMOS.forbidden_finish)).toEqual([]);
  });

  it('宣言の札（Q ボンバー）と独裁の札（独裁）は、カードではなく札で表す', () => {
    const q = RULE_DEMOS.call_discard_on_q;
    expect(q[1]!.badges).toEqual([{ kind: 'call', ranks: [7, 13] }]);
    expect(q[2]!.badges).toEqual([{ kind: 'call', ranks: [7, 13] }]);
    const b = ABILITY_DEMOS.ban;
    expect(b[1]!.badges).toEqual([{ kind: 'ban', rank: 15 }]);
    // 札の数字は場や行のカードに出さない（特定のマークのカードに見えないように）
    expect(b.flatMap((f) => [...f.field, ...(f.rows ?? []).flatMap((r) => r.cards)])).not.toContain('heart-15');
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

describe('見本の札を場の札の形にする（design-5 §6.2）', () => {
  const none = { revolution: false, tempReverse: false, suitLock: null, seqLock: null, colorLock: null, orderReversed: false, ban: null, call: null };

  it('札がなければ何も出さない形', () => {
    expect(demoBadgeProps([])).toEqual(none);
  });

  it('宣言（call）と独裁（ban）がそのまま渡る', () => {
    expect(demoBadgeProps([{ kind: 'call', ranks: [7, 13] }])).toEqual({ ...none, call: [7, 13] });
    expect(demoBadgeProps([{ kind: 'call', ranks: ['joker'] }])).toEqual({ ...none, call: ['joker'] });
    expect(demoBadgeProps([{ kind: 'ban', rank: 15 }])).toEqual({ ...none, ban: 15 });
    // 見本のデータから引いても同じ
    expect(demoBadgeProps(RULE_DEMOS.call_discard_on_q[2]!.badges ?? [])).toEqual({ ...none, call: [7, 13] });
    expect(demoBadgeProps(ABILITY_DEMOS.ban[1]!.badges ?? [])).toEqual({ ...none, ban: 15 });
  });

  it('ほかの札（革命・J バック・逆回り・縛り・激縛り・色縛り）', () => {
    expect(
      demoBadgeProps([
        { kind: 'revolution' },
        { kind: 'tempReverse' },
        { kind: 'orderReverse' },
        { kind: 'suitLock', suits: ['heart'] },
        { kind: 'seqLock', suits: ['spade', 'club'] },
        { kind: 'colorLock', color: 'red' },
      ]),
    ).toEqual({ ...none, revolution: true, tempReverse: true, orderReversed: true, suitLock: ['heart'], seqLock: ['spade', 'club'], colorLock: 'red' });
  });
});

describe('見本の読み上げ（design-5 §6.8）', () => {
  it('場のカード・コマの説明（場が空なら「場は空」）', () => {
    expect(demoSpeech(RULE_DEMOS.flush_on_8[1]!)).toBe('場に ハートの8。8 を出す');
    expect(demoSpeech(RULE_DEMOS.flush_on_8[2]!)).toBe('場は空。場が流れて 出した人から');
    expect(demoSpeech(RULE_DEMOS.spade3_beats_joker[0]!)).toBe('場に ジョーカー。ジョーカーが 1枚');
  });

  it('状態の札（縛りのマーク・色・宣言・独裁も言葉で）', () => {
    expect(demoSpeech(RULE_DEMOS.suit_lock[1]!)).toBe('場に ハートの9。札 縛り ハート。同じマークが続くと 縛り');
    expect(demoSpeech(RULE_DEMOS.sequence_lock[2]!)).toBe('場に ハートの8。札 激縛り ハート。次は ハートの9 だけ');
    expect(demoSpeech(RULE_DEMOS.color_lock_on_5[0]!)).toBe('場に ハートの5。札 色縛り 赤。赤の5 を出すと');
    expect(demoSpeech(RULE_DEMOS.reverse_order_on_9[0]!)).toBe('場に クラブの9。札 逆回り。9 を出すと 逆回りに');
    expect(demoSpeech(RULE_DEMOS.call_discard_on_q[1]!)).toBe('場に スペードのQ、ハートのQ。札 宣言 7・K。数字を 2つまで宣言');
    expect(demoSpeech(ABILITY_DEMOS.ban[1]!)).toBe('場に スペードの9。札 独裁 2。場が流れるまで 2は出せない');
    expect(demoSpeech({ field: [], badges: [{ kind: 'call', ranks: ['joker'] }, { kind: 'revolution' }], note: 'a' })).toBe('場は空。札 宣言 ジョーカー、革命中。a');
  });

  it('行の見出しとカード、裏向きの枚数、強調、0枚の行', () => {
    expect(demoSpeech(RULE_DEMOS.give_on_7[1]!)).toBe('場に クラブの7。あなた：ハートのJ。次の人：裏向き 2枚、スペードの4（印つき）。手札を1枚 次の人に渡せる');
    expect(demoSpeech(ABILITY_DEMOS.peek[1]!)).toBe('場は空。相手：裏向き 1枚、スペードの2、ハートの9、クラブの4。ランダムな3枚を 見る');
    expect(demoSpeech(RULE_DEMOS.forbidden_finish[1]!)).toBe('場に ジョーカー。あなた：なし。これで上がると 反則');
  });

  it('枠のボタンの名前：何コマ目か・中身・押すと次へ', () => {
    expect(demoButtonLabel(RULE_DEMOS.triple3_trump[2]!, 2, 3)).toBe('見本 3／3コマ目。場は空。すぐに 場が流れる。押すと次へ');
  });

  it('30個すべてのコマで、説明の文を含む読み上げができる', () => {
    for (const data of [...Object.values(RULE_DEMOS), ...Object.values(ABILITY_DEMOS)]) {
      for (const f of data) expect(demoSpeech(f).endsWith(f.note)).toBe(true);
    }
  });
});

describe('メニューと説明の状態（design-5 §6.8）', () => {
  it('どちらも開いていなければ、押したほうが開く', () => {
    expect(openOverlay(null, 'menu')).toBe('menu');
    expect(openOverlay(null, 'help')).toBe('help');
  });

  it('同時には開かない（開いているほうがそのまま）', () => {
    expect(openOverlay('menu', 'help')).toBe('menu');
    expect(openOverlay('help', 'menu')).toBe('help');
  });

  it('閉じると、どちらも開いていない状態に戻る。開いていないほうを閉じても変わらない', () => {
    expect(closeOverlay('menu', 'menu')).toBeNull();
    expect(closeOverlay('help', 'help')).toBeNull();
    expect(closeOverlay('help', 'menu')).toBe('help');
    expect(closeOverlay(null, 'help')).toBeNull();
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
