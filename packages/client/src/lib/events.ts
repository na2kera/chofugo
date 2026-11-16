// 出来事の受け取り（design-client §5.3、§7.8）。
// 通し番号で重複を除き、メッセージと演出に回す。出たカードの履歴もここでためる。
// 出来事の種類ごとのメッセージと演出は、下の2つの関数（表）で決める。種類は engine の VisibleEvent が正。

import type { CardId, Play, SeatId, VisibleEvent } from '@chofugo/engine';
import { cardShort, playSummary, rankKey } from './cards.ts';

/**
 * 出たカードの履歴の1行。turn = 手番で出した手、respond = 返しの一周で返した手（4止めの4を含む）、
 * discard = 10捨てで捨てたカード（「10捨て」と添える、design-2 §4.5）。
 */
export type HistoryItem = { seq: number; seat: SeatId; cards: CardId[]; via: 'turn' | 'respond' | 'discard' };

export type Feed = {
  matchId: string | null;
  seen: Set<number>;
  /** 履歴を持っているゲームの番号。 */
  gameNo: number | null;
  history: HistoryItem[];
  /** 出来事から分かる、いま場のいちばん上の手（演出用。場が流れたら null）。 */
  top: { seat: SeatId; play: Play } | null;
};

export function emptyFeed(): Feed {
  return { matchId: null, seen: new Set(), gameNo: null, history: [], top: null };
}

export type Incoming = { matchId: string | null; events: readonly VisibleEvent[]; eventsFull: boolean };

/** 演出（その1は4つだけ、§7.8）。演出に使うカードや席は出来事の中身から取る。 */
export type Anim =
  | { kind: 'play'; seq: number; seat: SeatId; play: Play }
  | { kind: 'sweep'; seq: number; seat: SeatId; play: Play }
  | { kind: 'revolution'; seq: number }
  | { kind: 'placed'; seq: number; seat: SeatId; red: boolean };

export type IngestResult = {
  feed: Feed;
  /** 新しく届いた出来事（eventsFull のときは空。演出をしない）。 */
  fresh: VisibleEvent[];
};

function applyToHistory(feed: Feed, e: VisibleEvent): void {
  if (feed.gameNo !== e.gameNo) {
    feed.gameNo = e.gameNo;
    feed.history = [];
    feed.top = null;
  }
  if (e.type === 'play') {
    feed.history.push({ seq: e.seq, seat: e.seat, cards: e.play.cards, via: 'turn' });
    feed.top = { seat: e.seat, play: e.play };
  } else if (e.type === 'respond') {
    feed.history.push({ seq: e.seq, seat: e.seat, cards: e.play.cards, via: 'respond' });
    // 4止め（toDiscard）の4は捨て札へ置かれ、場のいちばん上は8のまま（design-2 §6.2）
    if (e.toDiscard !== true) feed.top = { seat: e.seat, play: e.play };
  } else if (e.type === 'discard') {
    feed.history.push({ seq: e.seq, seat: e.seat, cards: e.cards, via: 'discard' });
  } else if (e.type === 'fieldCleared' || e.type === 'gameStart') {
    feed.top = null;
  }
}

/** 届いた出来事を受け取る。入力の feed は変えない。 */
export function ingest(prev: Feed, msg: Incoming): IngestResult {
  let feed: Feed =
    prev.matchId === msg.matchId
      ? { ...prev, seen: new Set(prev.seen), history: prev.history.slice() }
      : { ...emptyFeed(), matchId: msg.matchId };
  if (msg.eventsFull) {
    // 接続・復帰の直後。演出をせず、現在のゲームの分から作り直す
    feed = { ...emptyFeed(), matchId: msg.matchId };
    for (const e of msg.events) {
      feed.seen.add(e.seq);
      applyToHistory(feed, e);
    }
    return { feed, fresh: [] };
  }
  const fresh: VisibleEvent[] = [];
  for (const e of msg.events) {
    if (feed.seen.has(e.seq)) continue;
    feed.seen.add(e.seq);
    fresh.push(e);
  }
  fresh.sort((a, b) => a.seq - b.seq);
  // 演出は「その時点の」場のいちばん上を使うので、ここでは履歴だけ進める
  for (const e of fresh) applyToHistory(feed, e);
  return { feed, fresh };
}

/** 出来事の列から演出の列を作る（場が流れる演出には、その直前の場のいちばん上を使う）。 */
export function animsFor(before: Feed['top'], fresh: readonly VisibleEvent[]): Anim[] {
  let top = before;
  const out: Anim[] = [];
  for (const e of fresh) {
    switch (e.type) {
      case 'play':
        out.push({ kind: 'play', seq: e.seq, seat: e.seat, play: e.play });
        top = { seat: e.seat, play: e.play };
        break;
      case 'respond':
        // 4止めの4は場に出ないので、場の演出をせず、いちばん上（8）も置き換えない（design-2 §6.2）
        if (e.toDiscard === true) break;
        out.push({ kind: 'play', seq: e.seq, seat: e.seat, play: e.play });
        top = { seat: e.seat, play: e.play };
        break;
      case 'fieldCleared':
        if (top !== null) out.push({ kind: 'sweep', seq: e.seq, seat: top.seat, play: top.play });
        top = null;
        break;
      case 'revolution':
        out.push({ kind: 'revolution', seq: e.seq });
        break;
      case 'placed':
        out.push({ kind: 'placed', seq: e.seq, seat: e.seat, red: e.reason === 'foul' || e.reason === 'dethrone' });
        break;
      case 'gameStart':
        top = null;
        break;
      default:
        break;
    }
  }
  return out;
}

/** 演出の待ち行列に足す。たまったら（3つ以上）残りを省いて最新の状態に合わせる（§5.3）。 */
export function enqueueAnims(queue: readonly Anim[], add: readonly Anim[]): Anim[] {
  const q = [...queue, ...add];
  return q.length >= 3 ? [] : q;
}

export type NameOf = (seat: SeatId) => string;

/**
 * 出来事ごとのメッセージ（§5.3、§7.7、§7.8、design-2 §4.5）。null ならメッセージを出さない。
 * 1回の state に複数あれば順に短く切り替え、最後の1つを残す。
 * me は自分の席（7渡しの当事者の言い方を変えるため）。nameOf は自分の席に「あなた」を返す。
 */
export function eventMessage(e: VisibleEvent, nameOf: NameOf, me: SeatId | null = null): string | null {
  switch (e.type) {
    case 'play':
      return `${nameOf(e.seat)} が ${playSummary(e.play)}${e.play.shape === 'run' ? 'を' : ''} 出した`;
    case 'pass':
      return `${nameOf(e.seat)} は パスした`;
    case 'fieldCleared':
      // 強制流しは、直前の特権の出来事で「強制流し！」と出しているので重ねない（design-3 §4.5）
      if (e.reason === 'forceFlush') return null;
      if (e.reason === 'flush_on_8') return '8切り！';
      if (e.reason === 'triple3_trump') return '砂嵐！';
      return '場が流れた';
    case 'revolution':
      return e.active ? '革命！' : '革命が戻った';
    case 'tempReverse':
      // 解除は場が流れるときに起き、「場が流れた」と重なるので出さない
      return e.active ? 'J バック！' : null;
    case 'suitLock':
      return '縛り！';
    case 'respond':
      // toDiscard が付くのは4止めだけ（design-2 §6.2）
      return e.toDiscard === true ? '4止め！' : 'スペ3返し！';
    case 'placed':
      return placedMessage(nameOf(e.seat), e.place, e.reason);
    case 'exchangeDone':
      return '交換が終わった';
    case 'gameStart':
    case 'deal':
    case 'exchangeStart':
    case 'exchange':
    case 'returnRoundStart':
    case 'respondSkip':
    case 'returnRoundEnd':
    case 'dethrone':
    case 'gameEnd':
    case 'matchEnd':
      return null;
    // その2の出来事（design-2 §4.5）
    case 'seqLock':
      return '激縛り！';
    case 'orderReverse':
      // 解除は場が流れるときに起き、「場が流れた」と重なるので出さない（J バックと同じ）
      return e.active ? '9リバース！' : null;
    case 'give':
      if (me !== null && e.from === me) return `${nameOf(e.from)} が ${nameOf(e.to)} に 渡した`;
      if (me !== null && e.to === me) return `${nameOf(e.from)} から ${e.count}枚 受け取った`;
      return `${nameOf(e.from)} が ${nameOf(e.to)} に ${e.count}枚 渡した`;
    case 'discard':
      return `${nameOf(e.seat)} が ${e.cards.length}枚 捨てた`;
    case 'skipped':
      return e.seats.length === 0 ? null : `K スキップ！ ${e.seats.map((x) => nameOf(x)).join('・')} を飛ばした`;
    case 'choiceStart':
    case 'choiceSkip':
      // 選んでいる間は「◯◯ が選んでいます」の表示で分かる。選ばなかったときはメッセージなし
      return null;
    // その3の出来事（design-3 §4.5）
    case 'abilitySelectStart':
      // 選んでいる間は選択の画面の案内で分かる
      return null;
    case 'abilitiesChosen':
      return `${nameOf(e.seat)} が 特権を ${e.count}個 選んだ`;
    case 'ability':
      return abilityMessage(e, nameOf, me);
  }
}

/** 特権の使用のメッセージ。革命は続く revolution の出来事で「革命！」と出すので、ここでは出さない。 */
function abilityMessage(e: Extract<VisibleEvent, { type: 'ability' }>, nameOf: NameOf, me: SeatId | null): string | null {
  const target = e.target ?? null;
  switch (e.ability) {
    case 'peek':
      if (target === null) return null;
      if (me !== null && target === me) return `${nameOf(e.seat)} に ${e.cards?.length ?? 0}枚 見られた`;
      return `${nameOf(e.seat)} が ${nameOf(target)} に 透視を使った`;
    case 'steal':
      if (target === null) return null;
      if (me !== null && e.seat === me && e.given !== undefined && e.taken !== undefined) return `${cardShort(e.given)} を渡して ${cardShort(e.taken)} を受け取った`;
      if (me !== null && target === me && e.given !== undefined && e.taken !== undefined) return `${cardShort(e.taken)} を取られて ${cardShort(e.given)} を受け取った`;
      return `${nameOf(e.seat)} が ${nameOf(target)} に 強奪を使った`;
    case 'forceFlush':
      return '強制流し！';
    case 'ban':
      return e.rank === undefined ? '独裁！' : `独裁！ ${rankKey(e.rank)} は出せない`;
    case 'revolution':
      return null;
    case 'skip':
      return 'スキップ！';
  }
}

/**
 * 1回の state で届いた出来事のメッセージの列（design-3 §4.5）。
 * 特権のスキップのあとに飛ばされた席（skipped）が続いたら、「スキップ！ △△ を飛ばした」の1行にまとめる
 * （K スキップと重なったときも、特権のスキップの言い方にする）。
 */
export function eventLines(events: readonly VisibleEvent[], nameOf: NameOf, me: SeatId | null = null): string[] {
  const out: string[] = [];
  let skipAt = -1;
  for (const e of events) {
    if (e.type === 'ability' && e.ability === 'skip') {
      skipAt = out.length;
      out.push('スキップ！');
      continue;
    }
    if (e.type === 'skipped' && skipAt >= 0 && e.seats.length > 0) {
      out[skipAt] = `スキップ！ ${e.seats.map((x) => nameOf(x)).join('・')} を飛ばした`;
      skipAt = -1;
      continue;
    }
    const t = eventMessage(e, nameOf, me);
    if (t !== null) out.push(t);
  }
  return out;
}

/** 順位が確定したときのメッセージ（§7.7）。届いた順位と理由から作り、「最下位」と決め打ちしない。 */
export function placedMessage(name: string, place: number, reason: 'finish' | 'foul' | 'dethrone' | 'last'): string {
  switch (reason) {
    case 'finish':
      return `${name} が ${place}位で 上がった`;
    case 'foul':
      return `${name} は 反則で ${place}位`;
    case 'dethrone':
      return `都落ち！ ${name} は ${place}位`;
    case 'last':
      return `${name} は ${place}位`;
  }
}
