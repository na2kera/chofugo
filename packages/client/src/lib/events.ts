// 出来事の受け取り（design-client §5.3、§7.8）。
// 通し番号で重複を除き、メッセージと演出に回す。出たカードの履歴もここでためる。
// 出来事の種類ごとのメッセージと演出は、下の2つの関数（表）で決める。種類は engine の VisibleEvent が正。

import type { FieldPlay, Play, SeatId, VisibleEvent } from '@chofugo/engine';
import { playSummary } from './cards.ts';

export type HistoryItem = { seq: number; seat: SeatId; play: Play; via: FieldPlay['via'] };

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
    feed.history.push({ seq: e.seq, seat: e.seat, play: e.play, via: 'turn' });
    feed.top = { seat: e.seat, play: e.play };
  } else if (e.type === 'respond') {
    feed.history.push({ seq: e.seq, seat: e.seat, play: e.play, via: 'respond' });
    feed.top = { seat: e.seat, play: e.play };
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
      case 'respond':
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
 * 出来事ごとのメッセージ（§5.3、§7.7、§7.8）。null ならメッセージを出さない。
 * 1回の state に複数あれば順に短く切り替え、最後の1つを残す。
 */
export function eventMessage(e: VisibleEvent, nameOf: NameOf): string | null {
  switch (e.type) {
    case 'play':
      return `${nameOf(e.seat)} が ${playSummary(e.play)}${e.play.shape === 'run' ? 'を' : ''} 出した`;
    case 'pass':
      return `${nameOf(e.seat)} は パスした`;
    case 'fieldCleared':
      return e.reason === 'flush_on_8' ? '8切り！' : '場が流れた';
    case 'revolution':
      return e.active ? '革命！' : '革命が戻った';
    case 'tempReverse':
      // 解除は場が流れるときに起き、「場が流れた」と重なるので出さない
      return e.active ? 'J バック！' : null;
    case 'suitLock':
      return '縛り！';
    case 'respond':
      return 'スペ3返し！';
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
  }
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
