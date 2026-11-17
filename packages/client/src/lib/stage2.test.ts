// 第2段階（特殊ルール8種）の関数のテスト（design-4 §4.6）。
// 選び方（闇市の枚数の決まり、Q ボンバーの上限と入れ替え）、新しい出来事のメッセージと履歴、受け取ったカードの強調、新しい「出せない理由」。

import { describe, expect, it } from 'vitest';
import { ALL_RULE_IDS, RULE_MODULES, type LegalPlay, type MyAwaiting, type Play, type RuleId, type VisibleEvent } from '@chofugo/engine';
import {
  CALL_RANKS,
  callLabel,
  callPrompt,
  choiceButtons,
  choiceKindOf,
  choicePrompt,
  chooseBody,
  nextGift,
  pickFrame,
  SKIP_CHOOSE_BODY,
  toggleCall,
  toggleChoice,
  tradeCount,
  tradeReady,
  trimForTrade,
  type ChooseInput,
  type GiftInput,
} from './choice.ts';
import { animsFor, emptyFeed, eventLines, eventMessage, ingest } from './events.ts';
import { dimReason, DIM_REASON_TEXT } from './selection.ts';
import { ADVANCED_RULE_ORDER, LOBBY_RULE_ORDER, RULES_TEXT, SPECIAL_RULE_ORDER } from '../rules-text.ts';

type TurnMine = Extract<MyAwaiting, { kind: 'turn' }>;
type ChoiceMine = Extract<MyAwaiting, { kind: 'choice' }>;

const g = (cards: string[], rank: number | null): Play => ({ shape: 'group', cards, rank: rank as never, jokers: [] });
const lp = (cards: string[], rank: number | null): LegalPlay => ({ cards, shape: 'group', play: g(cards, rank), foul: false });
const ev = (seq: number, body: Record<string, unknown>, gameNo = 1): VisibleEvent => ({ seq, gameNo, ...body }) as VisibleEvent;
const names = (seat: number) => ['あなた', 'たろう', 'ゆい', 'CPU 4'][seat]!;

const salvage: ChoiceMine = { awaitId: 5, kind: 'choice', rule: 'triple9_salvage', max: 2, to: null };
const trade: ChoiceMine = { awaitId: 5, kind: 'choice', rule: 'triple_a_trade', max: 2, to: null, targets: [1, 2, 3] };
const call: ChoiceMine = { awaitId: 5, kind: 'choice', rule: 'call_discard_on_q', max: 2, to: null };
const hand = ['club-3', 'diamond-4', 'spade-6', 'heart-7'];
const input = (over: Partial<ChooseInput> = {}): ChooseInput => ({ hand, picked: [], handCounts: [4, 6, 1, 7], target: null, ranks: [], ...over });

describe('表示名とロビーの並び（design-4 §4.1）', () => {
  it('24種すべてに表示名と説明がある。特殊の8種は §4.1 の並びと名前', () => {
    for (const id of ALL_RULE_IDS) {
      expect(RULES_TEXT[id].name.length).toBeGreaterThan(0);
      expect(RULES_TEXT[id].text.length).toBeGreaterThan(0);
    }
    expect(SPECIAL_RULE_ORDER.map((id) => RULES_TEXT[id].name)).toEqual(['5色縛り', '6戻し', 'オーメン', 'DEATH', '銀河鉄道', '闇市', 'Q ボンバー', '大革命']);
    // 定番・応用・特殊で24種がちょうど1回ずつ並ぶ
    const all = [...LOBBY_RULE_ORDER, ...ADVANCED_RULE_ORDER, ...SPECIAL_RULE_ORDER];
    expect(new Set(all).size).toBe(24);
    expect([...all].sort()).toEqual([...ALL_RULE_IDS].sort());
  });

  it('6戻しは J バックが前提（ロビーで押せない形になる。4止めと同じ仕組み）', () => {
    const requires = (id: RuleId) => RULE_MODULES.find((m) => m.id === id)?.requires ?? [];
    expect(requires('cancel_reverse_on_6')).toEqual(['temp_reverse_on_j']);
  });
});

describe('選択の種類と文言（design-4 §4.2）', () => {
  it('種類は engine のモジュールの choiceKind', () => {
    expect(choiceKindOf('give_on_7')).toBe('give');
    expect(choiceKindOf('discard_on_10')).toBe('discard');
    expect(choiceKindOf('triple9_salvage')).toBe('salvage');
    expect(choiceKindOf('triple_a_trade')).toBe('trade');
    expect(choiceKindOf('call_discard_on_q')).toBe('call');
  });

  it('銀河鉄道：10捨てと同じ選び方。メッセージとボタン', () => {
    expect(choicePrompt(salvage)).toBe('交換するカードを2枚まで選べます');
    expect(choicePrompt({ rule: 'triple9_salvage', max: 1 })).toBe('交換するカードを1枚まで選べます');
    expect(choiceButtons(salvage, 0)).toEqual({ skip: '交換しない', send: '交換' });
    expect(choiceButtons(salvage, 2)).toEqual({ skip: '交換しない', send: '2枚を交換' });
    expect(toggleChoice(salvage, hand, ['club-3', 'spade-6'], 'heart-7')).toEqual(['spade-6', 'heart-7']);
    expect(chooseBody(salvage, input({ picked: ['club-3'] }))).toEqual({ cards: ['club-3'] });
    expect(chooseBody(salvage, input())).toBeNull();
  });

  it('闇市・Q ボンバー：ボタンの文言。メッセージは闇市で相手を選んだあとだけ', () => {
    expect(choiceButtons(trade, 0)).toEqual({ skip: '使わない', send: '交換' });
    expect(choiceButtons(trade, 2)).toEqual({ skip: '使わない', send: '2枚を交換' });
    expect(choiceButtons(call, 0)).toEqual({ skip: '宣言しない', send: '宣言する' });
    expect(choicePrompt(trade)).toBeNull();
    expect(choicePrompt(trade, 2)).toBe('渡すカードを2枚選んでください');
    expect(choicePrompt(trade, 1)).toBe('渡すカードを1枚選んでください');
    expect(choicePrompt(call)).toBeNull();
    // 既存の7渡し・10捨ては変わらない
    expect(choicePrompt({ rule: 'give_on_7', max: 2 })).toBe('次の人に渡すカードを2枚まで選べます');
    expect(choiceButtons({ rule: 'discard_on_10' }, 1)).toEqual({ skip: '捨てない', send: '1枚を捨てる' });
  });

  it('選ばないときに送る内容は、どの種類でも cards が空だけ', () => {
    expect(SKIP_CHOOSE_BODY).toEqual({ cards: [] });
  });
});

describe('闇市の枚数の決まり（decisions §19.3）', () => {
  it('枚数は min(上限, 相手の手札)。上限は engine が min(2, 自分の手札) で決めている', () => {
    expect(tradeCount(trade, [4, 6, 1, 7], null)).toBeNull();
    expect(tradeCount(trade, [4, 6, 1, 7], 1)).toBe(2);
    expect(tradeCount(trade, [4, 6, 1, 7], 2)).toBe(1);
    expect(tradeCount({ max: 1 }, [1, 6, 1, 7], 3)).toBe(1);
  });

  it('相手を選び、ちょうどの枚数を選んだときだけ送れる。送る内容に target が付く', () => {
    expect(tradeReady(trade, hand, ['club-3', 'spade-6'], [4, 6, 1, 7], null)).toBe(false);
    expect(tradeReady(trade, hand, ['club-3'], [4, 6, 1, 7], 1)).toBe(false);
    expect(tradeReady(trade, hand, ['club-3', 'spade-6'], [4, 6, 1, 7], 1)).toBe(true);
    expect(tradeReady(trade, hand, ['club-3', 'spade-6'], [4, 6, 1, 7], 2)).toBe(false);
    expect(tradeReady(trade, hand, ['spade-6'], [4, 6, 1, 7], 2)).toBe(true);
    // 手札にないカードは数えない
    expect(tradeReady(trade, hand, ['club-3', 'joker-0'], [4, 6, 1, 7], 1)).toBe(false);
    expect(chooseBody(trade, input({ picked: ['club-3', 'spade-6'], target: 1 }))).toEqual({ cards: ['club-3', 'spade-6'], target: 1 });
    expect(chooseBody(trade, input({ picked: ['club-3', 'spade-6'] }))).toBeNull();
    expect(chooseBody(trade, input({ picked: ['club-3'], target: 3 }))).toBeNull();
  });

  it('相手を変えて枚数が減ったら、あとから選んだカードを残す', () => {
    expect(trimForTrade(['club-3', 'spade-6'], 1)).toEqual(['spade-6']);
    expect(trimForTrade(['club-3', 'spade-6'], 2)).toEqual(['club-3', 'spade-6']);
    expect(trimForTrade(['club-3'], 2)).toEqual(['club-3']);
    expect(trimForTrade(['club-3', 'spade-6'], null)).toEqual(['club-3', 'spade-6']);
    // 相手を選んだあとは、ちょうどの枚数を上限に選ぶ（超えたらいちばん前のカードと入れ替え）
    expect(toggleChoice({ max: 1 }, hand, ['spade-6'], 'club-3')).toEqual(['club-3']);
  });
});

describe('闇市の相手・Q ボンバーの数字のボタンの枠（client-assumptions J5・J6）', () => {
  it('選んでいるボタンだけ金の塗り（btn）、選んでいないボタンは金の線の枠（btn2）', () => {
    expect(pickFrame(true)).toBe('btn');
    expect(pickFrame(false)).toBe('btn2');
  });
});

describe('Q ボンバーの上限と入れ替え', () => {
  it('3〜2 の13個と JOKER。表記は「7」「K」「2」「JOKER」', () => {
    expect(CALL_RANKS).toHaveLength(14);
    expect(CALL_RANKS.map(callLabel).join(',')).toBe('3,4,5,6,7,8,9,10,J,Q,K,A,2,JOKER');
    expect(callPrompt(2)).toBe('Q ボンバー：数字を2個まで宣言');
  });

  it('押すと選び、もう一度押すと外す。上限を超えたら、いちばん前に選んだものと入れ替える', () => {
    let p = toggleCall(2, [], 7);
    p = toggleCall(2, p, 'joker');
    expect(p).toEqual([7, 'joker']);
    expect(toggleCall(2, p, 13)).toEqual(['joker', 13]);
    expect(toggleCall(2, p, 7)).toEqual(['joker']);
    expect(toggleCall(1, [7], 13)).toEqual([13]);
    expect(toggleCall(0, [], 13)).toEqual([]);
  });

  it('1個以上で送れる。cards は空で ranks だけ（target は付けない）', () => {
    expect(chooseBody(call, input())).toBeNull();
    expect(chooseBody(call, input({ ranks: [7, 'joker'], picked: ['club-3'] }))).toEqual({ cards: [], ranks: [7, 'joker'] });
    // 上限を超えた分は送らない（念のため）
    expect(chooseBody({ rule: 'call_discard_on_q', max: 1 }, input({ ranks: [7, 13] }))).toEqual({ cards: [], ranks: [7] });
  });
});

describe('第2段階の出来事のメッセージ（design-4 §4.4）', () => {
  it('5色縛り・6戻し', () => {
    expect(eventMessage(ev(1, { type: 'colorLock', color: 'red' }), names, 0)).toBe('5色縛り！ 赤だけ');
    expect(eventMessage(ev(1, { type: 'colorLock', color: 'black' }), names, 0)).toBe('5色縛り！ 黒だけ');
    expect(eventMessage(ev(1, { type: 'tempReverse', active: false, rule: 'cancel_reverse_on_6' }), names, 0)).toBe('6戻し！ J バック解除');
    // 場が流れたときの解除（rule なし）は今までどおり出さない
    expect(eventMessage(ev(1, { type: 'tempReverse', active: false }), names, 0)).toBeNull();
  });

  it('オーメン：「オーメン！」のあと、革命のメッセージ', () => {
    const lines = eventLines([ev(1, { type: 'play', seat: 1, play: g(['spade-6', 'heart-6', 'club-6'], 6), foul: false }), ev(2, { type: 'revolution', active: true, rule: 'triple6_revolution' })], names, 0);
    expect(lines).toEqual(['たろう が 6を3枚 出した', 'オーメン！', '革命！']);
    expect(eventLines([ev(2, { type: 'revolution', active: false, rule: 'triple6_revolution' })], names, 0)).toEqual(['オーメン！', '革命が戻った']);
    // ふつうの革命は今までどおり
    expect(eventLines([ev(2, { type: 'revolution', active: true })], names, 0)).toEqual(['革命！']);
  });

  it('DEATH・銀河鉄道・Q ボンバー', () => {
    const purge = ev(1, { type: 'purge', by: 1, discards: [{ seat: 2, card: 'joker-0' }, { seat: 3, card: 'spade-15' }, { seat: 0, card: 'heart-15' }] });
    expect(eventMessage(purge, names, 0)).toBe('DEATH！ 3人が1枚ずつ捨てた');
    expect(eventMessage(ev(1, { type: 'salvage', seat: 2, put: ['club-3', 'club-4'], took: ['heart-9', 'spade-5'] }), names, 0)).toBe('銀河鉄道！ ゆい が 2枚 交換した');
    expect(eventMessage(ev(1, { type: 'salvage', seat: 0, put: ['club-3'], took: ['heart-9'] }), names, 0)).toBe('銀河鉄道！ あなた が 1枚 交換した');
    expect(eventMessage(ev(1, { type: 'callDiscard', seat: 1, ranks: [7, 13], discards: [] }), names, 0)).toBe('Q ボンバー！ 7・K');
    expect(eventMessage(ev(1, { type: 'callDiscard', seat: 1, ranks: [15, 'joker'], discards: [] }), names, 0)).toBe('Q ボンバー！ 2・JOKER');
    // 選ばなかったとき（交換しない・使わない・宣言しない）はメッセージなし
    for (const rule of ['triple9_salvage', 'triple_a_trade', 'call_discard_on_q']) expect(eventMessage(ev(1, { type: 'choiceSkip', seat: 1, rule }), names, 0)).toBeNull();
  });

  it('闇市：当事者以外には「闇市！ ◯◯ と △△ が N枚 交換した」、当事者には相手の名前だけ', () => {
    expect(eventMessage(ev(1, { type: 'trade', from: 1, to: 2, count: 2, given: null, taken: null }), names, 0)).toBe('闇市！ たろう と ゆい が 2枚 交換した');
    expect(eventMessage(ev(1, { type: 'trade', from: 0, to: 2, count: 2, given: ['club-3', 'club-4'], taken: ['joker-0', 'spade-15'] }), names, 0)).toBe('ゆい と 2枚 交換した');
    expect(eventMessage(ev(1, { type: 'trade', from: 3, to: 0, count: 1, given: ['club-3'], taken: ['joker-0'] }), names, 0)).toBe('CPU 4 と 1枚 交換した');
  });

  it('大革命：「大革命！ ◯◯ が上がった」を残す（順位の「上がった」と場が流れたを重ねない）', () => {
    const evs = [
      ev(1, { type: 'play', seat: 2, play: g(['spade-15', 'heart-15', 'club-15', 'diamond-15'], 15), foul: false }),
      ev(2, { type: 'revolution', active: true }),
      ev(3, { type: 'instantWin', seat: 2, discarded: ['club-3'] }),
      ev(4, { type: 'placed', seat: 2, place: 1, reason: 'finish' }),
      ev(5, { type: 'fieldCleared', reason: 'quad2_instant_win', leader: 3 }),
    ];
    expect(eventLines(evs, names, 0)).toEqual(['ゆい が 2を4枚 出した', '革命！', '大革命！ ゆい が上がった']);
    // 都落ちが続くときは、その知らせが残る
    const dethrone = [...evs.slice(0, 4), ev(5, { type: 'dethrone', seat: 1, discarded: [] }), ev(6, { type: 'placed', seat: 1, place: 4, reason: 'dethrone' }), ev(7, { type: 'fieldCleared', reason: 'quad2_instant_win', leader: 3 })];
    expect(eventLines(dethrone, names, 0).slice(-1)).toEqual(['都落ち！ たろう は 4位']);
    // 別の人のふつうの上がりは出す
    expect(eventLines([ev(1, { type: 'instantWin', seat: 2, discarded: [] }), ev(2, { type: 'placed', seat: 3, place: 2, reason: 'finish' })], names, 0)).toEqual(['大革命！ ゆい が上がった', 'CPU 4 が 2位で 上がった']);
  });
});

describe('演出（オーメン・大革命は今ある革命の演出）', () => {
  it('オーメン：出す → 革命', () => {
    const six = g(['spade-6', 'heart-6', 'club-6'], 6);
    const a = animsFor(null, [ev(1, { type: 'play', seat: 1, play: six, foul: false }), ev(2, { type: 'revolution', active: true, rule: 'triple6_revolution' })]);
    expect(a).toEqual([
      { kind: 'play', seq: 1, seat: 1, play: six },
      { kind: 'revolution', seq: 2 },
    ]);
  });

  it('大革命：出す → 革命 の2つ（順位と場が流れる演出を省き、待ち行列の決まりで革命が消えないように）', () => {
    const twos = g(['spade-15', 'heart-15', 'club-15', 'diamond-15'], 15);
    const a = animsFor(null, [
      ev(1, { type: 'play', seat: 2, play: twos, foul: false }),
      ev(2, { type: 'revolution', active: true }),
      ev(3, { type: 'instantWin', seat: 2, discarded: [] }),
      ev(4, { type: 'placed', seat: 2, place: 1, reason: 'finish' }),
      ev(5, { type: 'fieldCleared', reason: 'quad2_instant_win', leader: 3 }),
    ]);
    expect(a).toEqual([
      { kind: 'play', seq: 1, seat: 2, play: twos },
      { kind: 'revolution', seq: 2 },
    ]);
  });
});

describe('出たカードの履歴（design-4 §4.4）', () => {
  const play4 = ev(1, { type: 'play', seat: 1, play: g(['club-4', 'diamond-4', 'heart-4'], 4), foul: false });

  it('DEATH・銀河鉄道・Q ボンバー・大革命で捨て札に入ったカードを、誰のカードかとルール名を添えて足す', () => {
    const r = ingest(emptyFeed(), {
      matchId: 'm',
      eventsFull: false,
      events: [
        play4,
        ev(2, { type: 'purge', by: 1, discards: [{ seat: 2, card: 'joker-0' }, { seat: 3, card: 'spade-15' }] }),
        ev(3, { type: 'salvage', seat: 0, put: ['club-3', 'club-5'], took: ['heart-9', 'spade-5'] }),
        ev(4, { type: 'callDiscard', seat: 2, ranks: [7], discards: [{ seat: 2, cards: ['spade-7'] }, { seat: 0, cards: ['heart-7', 'club-7'] }] }),
        ev(5, { type: 'instantWin', seat: 3, discarded: ['club-8'] }),
        ev(6, { type: 'instantWin', seat: 1, discarded: [] }),
      ],
    });
    expect(r.feed.history.map((h) => [h.seq, h.seat, h.via, h.rule, h.cards])).toEqual([
      [1, 1, 'turn', undefined, ['club-4', 'diamond-4', 'heart-4']],
      [2, 2, 'effect', 'triple4_purge', ['joker-0']],
      [2, 3, 'effect', 'triple4_purge', ['spade-15']],
      [3, 0, 'effect', 'triple9_salvage', ['club-3', 'club-5']],
      [4, 2, 'effect', 'call_discard_on_q', ['spade-7']],
      [4, 0, 'effect', 'call_discard_on_q', ['heart-7', 'club-7']],
      [5, 3, 'effect', 'quad2_instant_win', ['club-8']],
    ]);
    // 1つの出来事から複数の行ができても、seq と seat で1行が決まる（Menu の key）
    const keys = r.feed.history.map((h) => `${h.seq}:${h.seat}`);
    expect(new Set(keys).size).toBe(keys.length);
    // 場のいちばん上は変わらない
    expect(r.feed.top?.play.cards).toEqual(['club-4', 'diamond-4', 'heart-4']);
  });

  it('闇市は当事者にだけ、渡したカードと受け取ったカードを元の持ち主の行に出す', () => {
    const mine = ingest(emptyFeed(), { matchId: 'm', eventsFull: false, events: [ev(1, { type: 'trade', from: 0, to: 2, count: 2, given: ['club-3', 'club-4'], taken: ['joker-0', 'spade-15'] })] });
    expect(mine.feed.history.map((h) => [h.seat, h.rule, h.cards])).toEqual([
      [0, 'triple_a_trade', ['club-3', 'club-4']],
      [2, 'triple_a_trade', ['joker-0', 'spade-15']],
    ]);
    const other = ingest(emptyFeed(), { matchId: 'm', eventsFull: false, events: [ev(1, { type: 'trade', from: 1, to: 2, count: 2, given: null, taken: null })] });
    expect(other.feed.history).toEqual([]);
  });

  it('復帰した直後（eventsFull）も同じ履歴を作り直す', () => {
    const r = ingest(emptyFeed(), { matchId: 'm', eventsFull: true, events: [play4, ev(2, { type: 'purge', by: 1, discards: [{ seat: 2, card: 'joker-0' }] })] });
    expect(r.feed.history.map((h) => h.via)).toEqual(['turn', 'effect']);
  });
});

describe('受け取ったカードの強調（銀河鉄道・闇市、design-4 §4.2）', () => {
  const base: GiftInput = { matchId: 'm', gameNo: 2, me: 0, fresh: [], eventsFull: false, hand: ['club-3', 'heart-9', 'spade-5', 'joker-0', 'spade-15'], ownActionAccepted: false };

  it('銀河鉄道：自分の操作が受理された state で届いても、引いたカードを強調する', () => {
    const e = ev(7, { type: 'salvage', seat: 0, put: ['club-4'], took: ['heart-9'] }, 2);
    expect(nextGift(null, { ...base, fresh: [e], ownActionAccepted: true })).toEqual({ matchId: 'm', gameNo: 2, cards: ['heart-9'] });
    // 前の強調（7渡しで受け取ったカード）は、自分の操作が受理されたので消える
    expect(nextGift({ matchId: 'm', gameNo: 2, cards: ['club-3'] }, { ...base, fresh: [e], ownActionAccepted: true })?.cards).toEqual(['heart-9']);
    // ほかの人の銀河鉄道では何もしない
    expect(nextGift(null, { ...base, fresh: [ev(7, { type: 'salvage', seat: 2, put: ['club-4'], took: ['heart-9'] }, 2)] })).toBeNull();
  });

  it('闇市：使った側は受け取ったカード（taken）、相手の側は渡されたカード（given）。当事者以外は何もしない', () => {
    const fromMe = ev(8, { type: 'trade', from: 0, to: 2, count: 2, given: ['club-4', 'club-6'], taken: ['joker-0', 'spade-15'] }, 2);
    expect(nextGift(null, { ...base, fresh: [fromMe], ownActionAccepted: true })?.cards).toEqual(['joker-0', 'spade-15']);
    const toMe = ev(8, { type: 'trade', from: 3, to: 0, count: 2, given: ['club-3', 'spade-5'], taken: ['x', 'y'] }, 2);
    expect(nextGift(null, { ...base, fresh: [toMe] })?.cards).toEqual(['club-3', 'spade-5']);
    expect(nextGift(null, { ...base, fresh: [ev(8, { type: 'trade', from: 1, to: 2, count: 2, given: null, taken: null }, 2)] })).toBeNull();
  });

  it('次の自分の操作で消える。手札から消えたカードは外す。別のゲームの出来事では足さない', () => {
    const a = nextGift(null, { ...base, fresh: [ev(7, { type: 'salvage', seat: 0, put: ['club-4'], took: ['heart-9', 'spade-5'] }, 2)] });
    expect(nextGift(a, { ...base, fresh: [ev(9, { type: 'pass', seat: 0 }, 2)], ownActionAccepted: true })).toBeNull();
    expect(nextGift(a, { ...base, hand: ['spade-5'] })?.cards).toEqual(['spade-5']);
    expect(nextGift(null, { ...base, fresh: [ev(7, { type: 'salvage', seat: 0, put: ['club-4'], took: ['heart-9'] }, 1)] })).toBeNull();
  });
});

describe('出せない理由：色縛り（design-4 §4.3）', () => {
  const turn: TurnMine = { awaitId: 1, kind: 'turn', leader: false, canPass: true, plays: [lp(['heart-8'], 8)], abilities: [], skipAvailable: false };

  it('色の合わないカードは「色縛りの色に合わない」。色の合うカード・ジョーカーは今までの理由', () => {
    expect(DIM_REASON_TEXT.colorLock).toBe('色縛りの色に合わない');
    expect(dimReason(turn, turn.plays, [], 'spade-9', null, { colorLock: 'red' })).toBe('colorLock');
    expect(dimReason(turn, turn.plays, [], 'club-9', null, { colorLock: 'red' })).toBe('colorLock');
    expect(dimReason(turn, turn.plays, [], 'heart-5', null, { colorLock: 'red' })).toBe('weaker');
    expect(dimReason(turn, turn.plays, [], 'diamond-9', null, { colorLock: 'black' })).toBe('colorLock');
    expect(dimReason(turn, turn.plays, [], 'joker-0', null, { colorLock: 'red' })).toBe('weaker');
  });

  it('マーク縛りに合わないときはマーク縛りの理由を先に。返しの一周では色縛りを理由にしない', () => {
    expect(dimReason(turn, turn.plays, [], 'spade-9', ['heart'], { colorLock: 'red' })).toBe('suitLock');
    expect(dimReason(turn, turn.plays, [], 'diamond-9', ['heart', 'diamond'], { colorLock: 'black' })).toBe('colorLock');
    const r: MyAwaiting = { awaitId: 1, kind: 'respond', rule: 'spade3_beats_joker', plays: [lp(['spade-3'], 3)] };
    expect(dimReason(r, r.plays, [], 'heart-9', null, { colorLock: 'black' })).toBe('weaker');
    // 色縛りがなければ今までどおり
    expect(dimReason(turn, turn.plays, [], 'spade-9', null)).toBe('weaker');
  });
});
