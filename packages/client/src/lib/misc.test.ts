import { describe, expect, it } from 'vitest';
import type { VisibleEvent } from '@chofugo/engine';
import { evaluateExchange, toggleExchange, type ExchangeTask } from './exchange.ts';
import { animsFor, emptyFeed, enqueueAnims, eventMessage, ingest, placedMessage } from './events.ts';
import { fieldLayout, handLayout, MIN_STEP } from './layout.ts';
import { codePointLength, nameError } from './names.ts';
import { pendingAfter, PENDING_TIMEOUT_MS } from './pending.ts';
import { backoffMs, closeOutcome, shouldGiveUp } from './reconnect.ts';
import { profileSuffix } from './storage.ts';
import { barSegments, ClockSkew, remainingMs, secondsToShow } from './timer.ts';
import { cardLabel, jokerStandIn, playSummary } from './cards.ts';

describe('カード交換の選び方', () => {
  const lower: ExchangeTask = {
    awaitId: 1,
    kind: 'exchangeGive',
    role: 'lower',
    count: 2,
    forced: ['joker-0'],
    candidates: ['spade-15', 'heart-15'],
    choose: 1,
  };
  const hand = ['club-3', 'spade-15', 'heart-15', 'joker-0'];

  it('下位：決まっている分は選択済みで外せず、候補から choose 枚を選ぶ', () => {
    const ev = evaluateExchange(lower, hand, []);
    expect(ev.shown).toEqual(['joker-0']);
    expect(ev.ready).toBe(false);
    expect(ev.selectable.has('club-3')).toBe(false);
    expect(toggleExchange(lower, hand, [], 'joker-0')).toBeNull();
    expect(toggleExchange(lower, hand, [], 'club-3')).toBeNull();
    const p = toggleExchange(lower, hand, [], 'heart-15')!;
    const ev2 = evaluateExchange(lower, hand, p);
    expect(ev2.ready).toBe(true);
    expect(ev2.cards).toEqual(['joker-0', 'heart-15']);
  });

  it('下位：選び切ったあとに別の候補を押すと入れ替わる', () => {
    const p = toggleExchange(lower, hand, ['heart-15'], 'spade-15')!;
    expect(evaluateExchange(lower, hand, p).cards).toEqual(['joker-0', 'spade-15']);
  });

  it('上位：手札から count 枚を自由に選ぶ（出せる手の一覧は使わない）', () => {
    const upper: ExchangeTask = { awaitId: 2, kind: 'exchangeGive', role: 'upper', count: 2, forced: [], candidates: [], choose: 2 };
    let p: string[] = [];
    p = toggleExchange(upper, hand, p, 'club-3')!;
    expect(evaluateExchange(upper, hand, p).ready).toBe(false);
    p = toggleExchange(upper, hand, p, 'joker-0')!;
    expect(evaluateExchange(upper, hand, p).ready).toBe(true);
    // 外せる
    expect(toggleExchange(upper, hand, p, 'club-3')).toEqual(['joker-0']);
    // 3枚目は、いちばん前に選んだカードと入れ替わる
    expect(toggleExchange(upper, hand, p, 'spade-15')).toEqual(['joker-0', 'spade-15']);
  });
});

describe('残り時間', () => {
  it('サーバーとの時計のずれを補正する', () => {
    const skew = new ClockSkew();
    // サーバーの時計が 5秒進んでいて、通信に 100ms かかった
    skew.add(10_000, 5_100);
    skew.add(20_000, 15_050);
    expect(skew.offset).toBe(4950);
    const d = { at: 40_000, remainingMs: null };
    // 端末の時刻 25,050（サーバーでは約 30,000）→ 残り約 10 秒
    expect(remainingMs(d, skew.offset, 25_050)).toBe(10_000);
  });
  it('過ぎたら 0、一時停止中は remainingMs を使う', () => {
    expect(remainingMs({ at: 1000, remainingMs: null }, 0, 5000)).toBe(0);
    expect(remainingMs({ at: null, remainingMs: 12_345 }, 0, 99_999)).toBe(12_345);
  });
  it('バーの点灯数と秒数の表示', () => {
    expect(barSegments(30_000, 'turn', 15)).toBe(15);
    expect(barSegments(15_000, 'turn', 15)).toBe(8);
    expect(barSegments(0, 'turn', 15)).toBe(0);
    expect(barSegments(90_000, 'turn', 15)).toBe(15);
    expect(secondsToShow(10_001, true)).toBeNull();
    expect(secondsToShow(9_200, true)).toBe(10);
    expect(secondsToShow(3_000, false)).toBeNull();
  });
});

function ev(seq: number, body: Record<string, unknown>, gameNo = 1): VisibleEvent {
  return { seq, gameNo, ...body } as VisibleEvent;
}

describe('出来事の重複の除き方', () => {
  const play1 = ev(3, { type: 'play', seat: 1, play: { shape: 'group', cards: ['spade-8'], rank: 8, jokers: [] }, foul: false });
  const cleared = ev(4, { type: 'fieldCleared', reason: 'flush_on_8', leader: 1 });

  it('通し番号で重複を除く', () => {
    let f = emptyFeed();
    const a = ingest(f, { matchId: 'm', events: [play1], eventsFull: false });
    expect(a.fresh.map((e) => e.seq)).toEqual([3]);
    f = a.feed;
    const b = ingest(f, { matchId: 'm', events: [play1, cleared], eventsFull: false });
    expect(b.fresh.map((e) => e.seq)).toEqual([4]);
    expect(b.feed.history).toHaveLength(1);
  });

  it('eventsFull のときは演出をせず、履歴を作り直す', () => {
    const f = ingest(emptyFeed(), { matchId: 'm', events: [play1], eventsFull: false }).feed;
    const full = ingest(f, { matchId: 'm', events: [play1, cleared], eventsFull: true });
    expect(full.fresh).toEqual([]);
    expect(full.feed.history).toHaveLength(1);
    expect(full.feed.seen.has(4)).toBe(true);
  });

  it('試合が変わったら記録を捨てる（通し番号は試合ごとに振り直される）', () => {
    const f = ingest(emptyFeed(), { matchId: 'm1', events: [play1], eventsFull: false }).feed;
    const next = ingest(f, { matchId: 'm2', events: [play1], eventsFull: false });
    expect(next.fresh.map((e) => e.seq)).toEqual([3]);
  });

  it('ゲームが変わったら履歴は新しいゲームの分だけ', () => {
    const f = ingest(emptyFeed(), { matchId: 'm', events: [play1], eventsFull: false }).feed;
    const g2 = ev(9, { type: 'play', seat: 2, play: { shape: 'group', cards: ['club-3'], rank: 3, jokers: [] }, foul: false }, 2);
    const next = ingest(f, { matchId: 'm', events: [g2], eventsFull: false });
    expect(next.feed.history.map((h) => h.seq)).toEqual([9]);
  });

  it('場が流れる演出は、出来事の中のカードを使う（8切り）', () => {
    const anims = animsFor(null, [play1, cleared]);
    expect(anims.map((a) => a.kind)).toEqual(['play', 'sweep']);
    expect(anims[1]).toMatchObject({ kind: 'sweep', play: { cards: ['spade-8'] } });
  });

  it('演出がたまったら（3つ以上）省く', () => {
    const a = animsFor(null, [play1]);
    expect(enqueueAnims([], a)).toHaveLength(1);
    expect(enqueueAnims(a, a)).toHaveLength(2);
    expect(enqueueAnims([...a, ...a], a)).toEqual([]);
  });

  it('メッセージ', () => {
    const name = (s: number) => ['A', 'B', 'C', 'D'][s]!;
    expect(eventMessage(play1, name)).toBe('B が 8を1枚 出した');
    expect(eventMessage(cleared, name)).toBe('8切り！');
    expect(eventMessage(ev(5, { type: 'tempReverse', active: false }), name)).toBeNull();
    expect(placedMessage('B', 2, 'finish')).toBe('B が 2位で 上がった');
    expect(placedMessage('B', 3, 'dethrone')).toBe('都落ち！ B は 3位');
    expect(placedMessage('B', 4, 'foul')).toBe('B は 反則で 4位');
    expect(placedMessage('B', 3, 'last')).toBe('B は 3位');
  });
});

describe('つなぎ直し', () => {
  it('間隔は 1, 2, 4, 8, 8 秒', () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });
  it('閉じられた理由はコードで決める', () => {
    expect(closeOutcome(4001).kind).toBe('replaced');
    expect(closeOutcome(4003).kind).toBe('closed');
    expect(closeOutcome(4002).kind).toBe('cannotJoin');
    expect(closeOutcome(4000).kind).toBe('retry');
    expect(closeOutcome(1006).kind).toBe('retry');
  });
  it('一度もつながらないまま3回失敗したら諦める', () => {
    expect(shouldGiveUp(false, 2)).toBe(false);
    expect(shouldGiveUp(false, 3)).toBe(true);
    expect(shouldGiveUp(true, 10)).toBe(false);
  });
});

describe('送信中の待ちが解ける4つの条件', () => {
  const p = { reqId: 7, what: 'play', sentAt: 1000 };
  it('(a) 次の state が届いた', () => expect(pendingAfter(p, { type: 'state' })).toBeNull());
  it('(b) 同じ reqId の error が届いた', () => {
    expect(pendingAfter(p, { type: 'error', reqId: 7 })).toBeNull();
    expect(pendingAfter(p, { type: 'error', reqId: 8 })).toBe(p);
  });
  it('(c) 接続が切れた', () => expect(pendingAfter(p, { type: 'disconnected' })).toBeNull());
  it('(d) 3秒たっても何も届かない', () => {
    expect(pendingAfter(p, { type: 'tick', now: 1000 + PENDING_TIMEOUT_MS - 1 })).toBe(p);
    expect(pendingAfter(p, { type: 'tick', now: 1000 + PENDING_TIMEOUT_MS })).toBeNull();
  });
});

describe('そのほか', () => {
  it('開発用の席の切り替え（?p=1〜4）', () => {
    expect(profileSuffix('?p=2')).toBe('.p2');
    expect(profileSuffix('?x=1&p=4')).toBe('.p4');
    expect(profileSuffix('?p=5')).toBe('');
    expect(profileSuffix('')).toBe('');
  });
  it('名前はコードポイントで12文字まで', () => {
    expect(codePointLength('🃏🃏')).toBe(2);
    expect(nameError('あいうえおかきくけこさし')).toBeNull();
    expect(nameError('あいうえおかきくけこさしす')).not.toBeNull();
    expect(nameError('   ')).not.toBeNull();
    expect(nameError('a\u0007b')).not.toBeNull();
  });
  it('カードの読み上げ名と表記', () => {
    expect(cardLabel('spade-9')).toBe('スペードの9');
    expect(cardLabel('heart-14')).toBe('ハートのA');
    expect(cardLabel('joker-1')).toBe('ジョーカー');
    expect(playSummary({ shape: 'run', cards: [], suit: 'spade', low: 5, high: 7, jokers: [] })).toBe('♠5〜7の階段');
    expect(jokerStandIn({ shape: 'run', cards: ['joker-0'], suit: 'spade', low: 5, high: 7, jokers: [{ card: 'joker-0', rank: 6, suit: 'spade' }] }, 'joker-0')).toBe('♠6');
    expect(jokerStandIn({ shape: 'group', cards: ['joker-0'], rank: 7, jokers: [{ card: 'joker-0', rank: 7, suit: null }] }, 'joker-0')).toBe('7');
  });
  it('手札16枚は2段、ずれは30px以上（幅 336px でも）', () => {
    for (const w of [336, 366, 406]) {
      const l = handLayout(16, w);
      expect(l.rows.map((r) => r.length)).toEqual([8, 8]);
      expect(l.step).toBeGreaterThanOrEqual(MIN_STEP);
      expect(l.step % 2).toBe(0);
      expect(l.starts[0]! + 56 + 7 * l.step).toBeLessThanOrEqual(w);
    }
    expect(handLayout(8, 366).rows).toHaveLength(1);
    expect(handLayout(9, 366).rows.map((r) => r.length)).toEqual([5, 4]);
  });
  it('場は4枚以下なら大きいカード、5枚以上は重ね、8枚以上は2段', () => {
    expect(fieldLayout(4, 340).large).toBe(true);
    expect(fieldLayout(6, 340)).toMatchObject({ large: false });
    expect(fieldLayout(6, 340).rows).toHaveLength(1);
    expect(fieldLayout(9, 340).rows).toHaveLength(2);
  });
});
