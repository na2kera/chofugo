// その2（カスタムモード）の関数のテスト（design-2 §4.7、§6.2、§6.3）。

import { describe, expect, it } from 'vitest';
import type { LegalPlay, MyAwaiting, Play, VisibleEvent } from '@chofugo/engine';
import { choiceButtons, choiceCards, choicePrompt, nextGift, toggleChoice, type Gift, type GiftInput } from './choice.ts';
import { animsFor, emptyFeed, eventMessage, ingest } from './events.ts';
import { errorText } from './errors.ts';
import { dimReason, DIM_REASON_TEXT, evaluateSelection, initialRespondSelection } from './selection.ts';

const g = (cards: string[], rank: number | null): Play => ({ shape: 'group', cards, rank: rank as never, jokers: [] });
const lp = (cards: string[], rank: number | null): LegalPlay => ({ cards, shape: 'group', play: g(cards, rank), foul: false });
const ev = (seq: number, body: Record<string, unknown>, gameNo = 1): VisibleEvent => ({ seq, gameNo, ...body }) as VisibleEvent;
const names = (seat: number) => ['あなた', 'たろう', 'ゆい', 'CPU 4'][seat]!;

describe('7渡し・10捨ての選び方', () => {
  const hand = ['club-3', 'diamond-4', 'spade-6', 'heart-7'];
  const give = { awaitId: 3, kind: 'choice' as const, rule: 'give_on_7' as const, max: 2, to: 1 as const };

  it('上限まで選べ、上限を超えるといちばん前に選んだカードと入れ替わる', () => {
    let p: string[] = [];
    p = toggleChoice(give, hand, p, 'club-3')!;
    p = toggleChoice(give, hand, p, 'spade-6')!;
    expect(p).toEqual(['club-3', 'spade-6']);
    expect(toggleChoice(give, hand, p, 'heart-7')).toEqual(['spade-6', 'heart-7']);
    // 外せる
    expect(toggleChoice(give, hand, p, 'club-3')).toEqual(['spade-6']);
    // 手札にないカードは選べない
    expect(toggleChoice(give, hand, p, 'joker-0')).toBeNull();
  });

  it('手札が上限より少ないとき・上限が0のとき', () => {
    expect(toggleChoice({ max: 3 }, ['club-3'], [], 'club-3')).toEqual(['club-3']);
    expect(toggleChoice({ max: 0 }, ['club-3'], [], 'club-3')).toBeNull();
    // 送るのは手札にあるカードだけ（手札から消えたカードは送らない）
    expect(choiceCards(give, ['spade-6'], ['club-3', 'spade-6'])).toEqual(['spade-6']);
    expect(choiceCards(give, hand, [])).toEqual([]);
  });

  it('メッセージとボタンの文言（0枚のときは右のボタンに枚数を出さない）', () => {
    expect(choicePrompt(give)).toBe('次の人に渡すカードを2枚まで選べます');
    expect(choicePrompt({ rule: 'discard_on_10', max: 1 })).toBe('捨てるカードを1枚まで選べます');
    expect(choiceButtons(give, 0)).toEqual({ skip: '渡さない', send: '渡す' });
    expect(choiceButtons(give, 2)).toEqual({ skip: '渡さない', send: '2枚を渡す' });
    expect(choiceButtons({ rule: 'discard_on_10' }, 1)).toEqual({ skip: '捨てない', send: '1枚を捨てる' });
  });
});

describe('4止めの返しの選び方（design-2 §4.3）', () => {
  const pairs = [lp(['spade-4', 'heart-4'], 4), lp(['spade-4', 'club-4'], 4), lp(['heart-4', 'club-4'], 4)];
  const hand = ['club-3', 'spade-4', 'heart-4', 'club-4', 'spade-9'];

  it('候補が1つなら、はじめから選んだ状態。2つ以上なら空から', () => {
    const one: MyAwaiting = { awaitId: 1, kind: 'respond', rule: 'block_flush_with_4', plays: [pairs[0]!] };
    const many: MyAwaiting = { awaitId: 1, kind: 'respond', rule: 'block_flush_with_4', plays: pairs };
    const spade3: MyAwaiting = { awaitId: 1, kind: 'respond', rule: 'spade3_beats_joker', plays: [lp(['spade-3'], 3)] };
    expect(initialRespondSelection(one)).toEqual(['spade-4', 'heart-4']);
    expect(initialRespondSelection(many)).toEqual([]);
    expect(initialRespondSelection(spade3)).toEqual(['spade-3']);
    expect(initialRespondSelection({ awaitId: 1, kind: 'respond', rule: 'spade3_beats_joker', plays: [] })).toEqual([]);
    expect(initialRespondSelection(null)).toEqual([]);
  });

  it('4を3枚持っているとき、手札の4から2枚を選ぶ', () => {
    const a = evaluateSelection(hand, pairs, []);
    expect([...a.selectable].sort()).toEqual(['club-4', 'heart-4', 'spade-4']);
    const b = evaluateSelection(hand, pairs, ['club-4']);
    expect(b.matches).toEqual([]);
    expect([...b.selectable].sort()).toEqual(['club-4', 'heart-4', 'spade-4']);
    const c = evaluateSelection(hand, pairs, ['club-4', 'spade-4']);
    expect(c.matches.map((x) => x.cards)).toEqual([['spade-4', 'club-4']]);
  });
});

describe('出せない理由（design-2 §4.5）', () => {
  const turn: MyAwaiting = { awaitId: 1, kind: 'turn', leader: true, canPass: false, plays: [lp(['diamond-3'], 3), lp(['diamond-3', 'club-3'], 3)] };

  it('ダイヤの3の義務があるとき', () => {
    expect(dimReason(turn, turn.plays, [], 'spade-9', null, { openingCard: 'diamond-3' })).toBe('opening');
    expect(DIM_REASON_TEXT.opening).toBe('最初の1手にはダイヤの3が必要');
    // 選んでいるカードと組み合わせられないときは、そちらを優先
    expect(dimReason(turn, turn.plays, ['diamond-3'], 'club-3', null, { openingCard: 'diamond-3' })).toBe('cannotCombine');
  });

  it('激縛りが発動しているとき', () => {
    const t: MyAwaiting = { ...turn, leader: false, canPass: true, plays: [lp(['heart-8'], 8)] };
    expect(dimReason(t, t.plays, [], 'heart-9', ['heart'], { seqLock: { suits: ['heart'], rank: 7 as never } })).toBe('seqLock');
    expect(DIM_REASON_TEXT.seqLock).toBe('激縛りの続きに合わない');
  });

  it('その2の状態がなければ、その1と同じ判定', () => {
    const t: MyAwaiting = { ...turn, leader: false, canPass: true, plays: [lp(['heart-8'], 8)] };
    expect(dimReason(t, t.plays, [], 'spade-9', ['heart'])).toBe('suitLock');
    expect(dimReason(t, t.plays, [], 'heart-5', ['heart'])).toBe('weaker');
    expect(dimReason(t, t.plays, [], 'spade-9', ['heart'], { seqLock: null, openingCard: null })).toBe('suitLock');
  });

  it('4止めの返しでは縛りを理由にしない。選択の待ちでは自分の番の理由を出さない', () => {
    const r: MyAwaiting = { awaitId: 1, kind: 'respond', rule: 'block_flush_with_4', plays: [lp(['spade-4', 'heart-4'], 4)] };
    expect(dimReason(r, r.plays, [], 'club-9', ['heart'])).toBe('weaker');
    const c: MyAwaiting = { awaitId: 1, kind: 'choice', rule: 'give_on_7', max: 1, to: 1 };
    expect(dimReason(c, [], [], 'club-9', null)).toBe('notYourTurn');
  });
});

describe('その2の出来事のメッセージ（design-2 §4.5）', () => {
  it('札・効果の出来事', () => {
    expect(eventMessage(ev(1, { type: 'seqLock', suits: ['heart'] }), names, 0)).toBe('激縛り！');
    expect(eventMessage(ev(1, { type: 'orderReverse', active: true }), names, 0)).toBe('9リバース！');
    expect(eventMessage(ev(1, { type: 'orderReverse', active: false }), names, 0)).toBeNull();
    expect(eventMessage(ev(1, { type: 'fieldCleared', reason: 'triple3_trump', leader: 1 }), names, 0)).toBe('砂嵐！');
    expect(eventMessage(ev(1, { type: 'fieldCleared', reason: 'flush_on_8', leader: 1 }), names, 0)).toBe('8切り！');
    expect(eventMessage(ev(1, { type: 'respond', seat: 2, play: g(['spade-4', 'heart-4'], 4), toDiscard: true }), names, 0)).toBe('4止め！');
    expect(eventMessage(ev(1, { type: 'respond', seat: 2, play: g(['spade-3'], 3) }), names, 0)).toBe('スペ3返し！');
  });

  it('7渡し：当事者とそれ以外で言い方が変わる', () => {
    expect(eventMessage(ev(1, { type: 'give', from: 1, to: 2, count: 2, cards: null }), names, 0)).toBe('たろう が ゆい に 2枚 渡した');
    expect(eventMessage(ev(1, { type: 'give', from: 0, to: 1, count: 2, cards: ['club-3', 'club-4'] }), names, 0)).toBe('あなた が たろう に 渡した');
    expect(eventMessage(ev(1, { type: 'give', from: 3, to: 0, count: 1, cards: ['club-3'] }), names, 0)).toBe('CPU 4 から 1枚 受け取った');
  });

  it('10捨て・K スキップ・選ばなかったとき', () => {
    expect(eventMessage(ev(1, { type: 'discard', seat: 2, rule: 'discard_on_10', cards: ['club-3', 'club-4'] }), names, 0)).toBe('ゆい が 2枚 捨てた');
    expect(eventMessage(ev(1, { type: 'skipped', by: 1, seats: [2] }), names, 0)).toBe('K スキップ！ ゆい を飛ばした');
    expect(eventMessage(ev(1, { type: 'skipped', by: 1, seats: [2, 3] }), names, 0)).toBe('K スキップ！ ゆい・CPU 4 を飛ばした');
    expect(eventMessage(ev(1, { type: 'choiceSkip', seat: 2, rule: 'give_on_7' }), names, 0)).toBeNull();
    expect(eventMessage(ev(1, { type: 'choiceStart', rule: 'give_on_7', seat: 2, max: 1, to: 3 }), names, 0)).toBeNull();
  });

  it('拒否の理由', () => {
    expect(errorText({ code: 'actionRejected', engineError: 'invalidChoice' })).toBe('そのカードは選べない');
  });
});

describe('4止めの返しと場の表示・履歴（design-2 §6.2）', () => {
  const eight = g(['spade-8', 'heart-8'], 8);
  const fours = g(['spade-4', 'heart-4'], 4);
  const base = [ev(1, { type: 'gameStart', leaderRule: 'random' }), ev(2, { type: 'play', seat: 1, play: eight, foul: false })];

  it('toDiscard の返しは、場のいちばん上（8）と演出を置き換えない。履歴には4の2枚が入る', () => {
    const a = ingest(emptyFeed(), { matchId: 'm', events: base, eventsFull: true });
    expect(a.feed.top?.play).toEqual(eight);
    const more = [
      ev(3, { type: 'returnRoundStart', rule: 'block_flush_with_4', source: 1, participants: [2, 3, 0] }),
      ev(4, { type: 'respond', seat: 2, play: fours, toDiscard: true }),
      ev(5, { type: 'returnRoundEnd', rule: 'block_flush_with_4', returnedBy: 2 }),
    ];
    const b = ingest(a.feed, { matchId: 'm', events: more, eventsFull: false });
    expect(b.feed.top?.play).toEqual(eight);
    expect(b.feed.history.map((h) => [h.via, h.cards])).toEqual([
      ['turn', ['spade-8', 'heart-8']],
      ['respond', ['spade-4', 'heart-4']],
    ]);
    // 4の2枚は場へ飛ぶ演出をしない
    expect(animsFor(a.feed.top, b.fresh)).toEqual([]);
    // そのあと全員がパスして場が流れる演出には、8 が使われる
    const sweep = animsFor(b.feed.top, [ev(6, { type: 'pass', seat: 3 }), ev(7, { type: 'fieldCleared', reason: 'allPassed', leader: 1 })]);
    expect(sweep).toEqual([{ kind: 'sweep', seq: 7, seat: 1, play: eight }]);
    // 1回の state に「8 → 4止め → 場が流れる」が入っていても同じ
    const one = animsFor(null, [...base.slice(1), ...more, ev(7, { type: 'fieldCleared', reason: 'allPassed', leader: 1 })]);
    expect(one.filter((x) => x.kind === 'sweep')).toEqual([{ kind: 'sweep', seq: 7, seat: 1, play: eight }]);
  });

  it('スペ3返し（toDiscard なし）は、その1と同じく場のいちばん上を置き換える', () => {
    const joker = g(['joker-0'], null);
    const s3 = g(['spade-3'], 3);
    const r = ingest(emptyFeed(), { matchId: 'm', events: [ev(1, { type: 'play', seat: 1, play: joker, foul: false }), ev(2, { type: 'respond', seat: 2, play: s3 })], eventsFull: true });
    expect(r.feed.top?.play).toEqual(s3);
    expect(animsFor(null, [ev(2, { type: 'respond', seat: 2, play: s3 })])).toEqual([{ kind: 'play', seq: 2, seat: 2, play: s3 }]);
  });

  it('10捨てで捨てたカードは「10捨て」として履歴に入る', () => {
    const r = ingest(emptyFeed(), {
      matchId: 'm',
      events: [ev(1, { type: 'play', seat: 1, play: g(['spade-10'], 10), foul: false }), ev(2, { type: 'discard', seat: 1, rule: 'discard_on_10', cards: ['club-3'] })],
      eventsFull: false,
    });
    expect(r.feed.history.map((h) => [h.via, h.cards])).toEqual([
      ['turn', ['spade-10']],
      ['discard', ['club-3']],
    ]);
    expect(r.feed.top?.play.cards).toEqual(['spade-10']);
  });
});

describe('7渡しで受け取ったカードの強調（design-2 §6.3）', () => {
  const base: GiftInput = { matchId: 'm', gameNo: 2, me: 0, fresh: [], eventsFull: false, hand: ['club-3', 'club-4', 'spade-9'], ownActionAccepted: false };
  const giveToMe = (seq: number, cards: string[]) => ev(seq, { type: 'give', from: 3, to: 0, count: cards.length, cards }, 2);

  it('自分が受け取る give で強調し、複数回なら足していく', () => {
    const a = nextGift(null, { ...base, fresh: [giveToMe(5, ['club-3'])] });
    expect(a).toEqual({ matchId: 'm', gameNo: 2, cards: ['club-3'] });
    const b = nextGift(a, { ...base, fresh: [giveToMe(9, ['club-4'])] });
    expect(b?.cards).toEqual(['club-3', 'club-4']);
    // 他人どうしの give では何もしない
    expect(nextGift(null, { ...base, fresh: [ev(5, { type: 'give', from: 1, to: 2, count: 1, cards: null }, 2)] })).toBeNull();
  });

  it('自分の操作が受理されたら消す。拒否・時間切れ（受理でない state）では消さない', () => {
    const a: Gift = { matchId: 'm', gameNo: 2, cards: ['club-3'] };
    expect(nextGift(a, { ...base, fresh: [ev(10, { type: 'pass', seat: 1 }, 2)] })).toEqual(a);
    expect(nextGift(a, { ...base, fresh: [ev(10, { type: 'pass', seat: 0 }, 2)], ownActionAccepted: true })).toBeNull();
  });

  it('ゲームが変わったら消す。手札からなくなったカードは外す。復帰した直後は復元しない', () => {
    const a: Gift = { matchId: 'm', gameNo: 2, cards: ['club-3', 'club-4'] };
    expect(nextGift(a, { ...base, gameNo: 3 })).toBeNull();
    expect(nextGift(a, { ...base, matchId: 'm2' })).toBeNull();
    expect(nextGift(a, { ...base, hand: ['club-4'] })?.cards).toEqual(['club-4']);
    expect(nextGift(a, { ...base, eventsFull: true, fresh: [] })).toBeNull();
    expect(nextGift(null, { ...base, eventsFull: true, fresh: [giveToMe(5, ['club-3'])] })).toBeNull();
  });
});
