// 通信の部分のテスト。偽の WebSocket と偽のタイマーで RoomClient を動かす。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateMessage } from '@chofugo/server/protocol';
import type { VisibleEvent } from '@chofugo/engine';
import { NOTICE_MS, RoomClient, type SocketLike } from './RoomClient.ts';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // テストから動かす
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  json(): Record<string, unknown>[] {
    return this.sent.filter((s) => s !== 'ping').map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const ROOM = 'AAAAAAAAAAAAAAAAAAAAAA';
let sockets: FakeSocket[];
let client: RoomClient;

function make(): RoomClient {
  return new RoomClient(ROOM, 'ws://test', () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  });
}

function state(over: Partial<StateMessage> = {}): StateMessage {
  return {
    type: 'state',
    room: {
      roomId: ROOM,
      phase: 'playing',
      seats: [0, 1, 2, 3].map((seat) => ({ seat: seat as 0, kind: 'human' as const, name: `p${seat}`, connected: true, away: false })),
      host: 0,
      config: { mode: 'daifugo', rules: [], gameCount: 5 },
      paused: false,
    },
    seat: 0,
    isHost: true,
    matchId: 'm1',
    matchPhase: 'play',
    version: 1,
    view: null,
    events: [],
    eventsFull: false,
    deadlines: [],
    serverTime: Date.now(),
    ...over,
  };
}

const ev = (seq: number, body: Record<string, unknown>): VisibleEvent => ({ seq, gameNo: 1, ...body }) as VisibleEvent;

/** 開いて hello を送り、席の入った state を受け取った状態にする。 */
function joined(): FakeSocket {
  client.start();
  const s = sockets.at(-1)!;
  s.open();
  client.join('なまえ');
  s.receive(state({ eventsFull: true }));
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  client = make();
});

afterEach(() => {
  client.dispose();
  vi.useRealTimers();
});

describe('つながる前の無応答', () => {
  it('つながらないまま15秒たったら捨てて、失敗として数え、つなぎ直す', () => {
    client.start();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(14_999);
    expect(sockets[0]!.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sockets[0]!.closed).toBe(true);
    expect(client.getSnapshot().status).toBe('connecting');
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
  });

  it('3回続けて固まったら、あきらめる', () => {
    client.start();
    vi.advanceTimersByTime(15_000); // 1回目
    vi.advanceTimersByTime(1000 + 15_000); // 2回目
    vi.advanceTimersByTime(2000 + 15_000); // 3回目
    expect(client.getSnapshot().status).toBe('gaveUp');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(3);
  });
});

describe('閉じられたとき', () => {
  it('3回続けて失敗（つながる前に閉じる）したら、あきらめる', () => {
    client.start();
    sockets[0]!.serverClose(1006);
    vi.advanceTimersByTime(1000);
    sockets[1]!.serverClose(1006);
    vi.advanceTimersByTime(2000);
    sockets[2]!.serverClose(1006);
    expect(client.getSnapshot().status).toBe('gaveUp');
  });

  it('置き換えられた接続（4001）では、つなぎ直さない', () => {
    const s = joined();
    s.serverClose(4001);
    expect(client.getSnapshot().status).toBe('replaced');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('一度つながったあとは、何度切れてもつなぎ直す', () => {
    joined();
    for (let i = 0; i < 5; i++) {
      sockets.at(-1)!.serverClose(1006);
      expect(client.getSnapshot().status).toBe('reconnecting');
      vi.advanceTimersByTime(8000);
    }
    expect(sockets.length).toBeGreaterThan(5);
  });
});

describe('送信中の待ち', () => {
  it('3秒たつと解ける', () => {
    joined();
    expect(client.sendAction({ type: 'pass', awaitId: 1 }, 'pass')).toBe(true);
    expect(client.getSnapshot().pending).not.toBeNull();
    expect(client.sendAction({ type: 'pass', awaitId: 1 }, 'pass')).toBe(false); // 二重送信しない
    vi.advanceTimersByTime(2999);
    expect(client.getSnapshot().pending).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(client.getSnapshot().pending).toBeNull();
  });

  it('同じ reqId の error で解け、拒否の理由が知らせに出て、しばらくで消える', () => {
    const s = joined();
    client.sendAction({ type: 'pass', awaitId: 1 }, 'pass');
    const reqId = s.json().at(-1)!['reqId'] as number;
    s.receive({ type: 'error', code: 'actionRejected', engineError: 'cannotPass', message: 'x', reqId: reqId + 100 });
    expect(client.getSnapshot().pending).not.toBeNull();
    s.receive({ type: 'error', code: 'actionRejected', engineError: 'cannotPass', message: 'cannot pass', reqId });
    expect(client.getSnapshot().pending).toBeNull();
    expect(client.getSnapshot().notice).toBe('いまはパスできない');
    vi.advanceTimersByTime(NOTICE_MS);
    expect(client.getSnapshot().notice).toBeNull();
  });

  it('次の state で解ける', () => {
    const s = joined();
    client.sendAction({ type: 'pass', awaitId: 1 }, 'pass');
    s.receive(state());
    expect(client.getSnapshot().pending).toBeNull();
  });
});

describe('最後のゲームの結果', () => {
  const end = [ev(10, { type: 'gameEnd', places: [1, 2, 3, 4], deltas: [2, 1, -1, -2], scores: [2, 1, -1, -2] }), ev(11, { type: 'matchEnd', standings: [] })];

  it('出来事を通じて試合の結果へ進んだら、先にゲームの結果を見せる', () => {
    const s = joined();
    s.receive(state({ matchPhase: 'matchResult', events: end }));
    expect(client.getSnapshot().gameResultFirst.has('m1')).toBe(true);
  });

  it('ゲームの結果を見ている間に切れて戻ったら（eventsFull で matchResult）、試合の結果へ直接進む', () => {
    const s = joined();
    s.receive(state({ matchPhase: 'matchResult', events: end }));
    s.serverClose(1006);
    vi.advanceTimersByTime(1000);
    const s2 = sockets.at(-1)!;
    s2.open();
    s2.receive(state({ matchPhase: 'matchResult', events: end, eventsFull: true }));
    expect(client.getSnapshot().gameResultFirst.has('m1')).toBe(false);
  });

  it('試合の識別子が変わったら、古い印を片付ける', () => {
    const s = joined();
    s.receive(state({ matchPhase: 'matchResult', events: end }));
    s.receive(state({ matchId: 'm2', matchPhase: 'exchange' }));
    expect(client.getSnapshot().gameResultFirst.size).toBe(0);
  });

  it('無制限の試合をゲームの結果から終えたときは（gameEnd なし）、試合の結果を直接見せる', () => {
    const s = joined();
    s.receive(state({ matchPhase: 'matchResult', events: [ev(11, { type: 'matchEnd', standings: [] })] }));
    expect(client.getSnapshot().gameResultFirst.size).toBe(0);
  });
});

describe('メッセージの片付け', () => {
  const play = (seq: number, seat: number) => ev(seq, { type: 'play', seat, play: { shape: 'group', cards: ['spade-9'], rank: 9, jokers: [] }, foul: false });

  it('試合の識別子が変わったら、メッセージの行・待ち行列・出来事の記録を捨てる', () => {
    const s = joined();
    s.receive(state({ events: [play(1, 1), ev(2, { type: 'pass', seat: 2 }), ev(3, { type: 'pass', seat: 3 })] }));
    expect(client.getSnapshot().line).toBe('p1 が 9を1枚 出した');
    expect(client.getSnapshot().feed.history).toHaveLength(1);
    s.receive(state({ matchId: 'm2', matchPhase: 'exchange' }));
    expect(client.getSnapshot().line).toBeNull();
    expect(client.getSnapshot().feed.history).toHaveLength(0);
    // 古い待ち行列のメッセージが、あとから出てこない
    vi.advanceTimersByTime(5000);
    expect(client.getSnapshot().line).toBeNull();
  });

  it('eventsFull（復帰）でも、古いメッセージと待ち行列を捨てる', () => {
    const s = joined();
    s.receive(state({ events: [play(1, 1), ev(2, { type: 'pass', seat: 2 })] }));
    s.receive(state({ eventsFull: true, events: [play(1, 1), ev(2, { type: 'pass', seat: 2 })] }));
    expect(client.getSnapshot().line).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(client.getSnapshot().line).toBeNull();
  });

  it('ホストが替わったら、知らせに1行出す', () => {
    const s = joined();
    const st = state();
    s.receive({ ...st, room: { ...st.room, host: 2 } });
    expect(client.getSnapshot().notice).toBe('p2 が ホストになった');
  });
});

describe('StrictMode 相当の「開始 → 後始末 → 開始」', () => {
  it('新しい接続でつながり、hello は1回だけ送る', () => {
    client.start();
    client.dispose();
    expect(sockets[0]!.closed).toBe(true);
    client.start();
    expect(sockets).toHaveLength(2);
    const s = sockets[1]!;
    s.open();
    client.join('なまえ');
    client.join('なまえ'); // 二重に押しても1回だけ
    expect(s.json().filter((m) => m['type'] === 'hello')).toHaveLength(1);
    expect(sockets[0]!.sent).toHaveLength(0);
    s.receive(state({ eventsFull: true }));
    expect(client.getSnapshot().ready).toBe(true);
    // 古い接続のタイマー（つながる前の15秒の期限）が残っていない。新しい接続は pong で生きている
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(5000);
      s.receive('pong');
    }
    expect(sockets).toHaveLength(2);
    expect(client.getSnapshot().status).toBe('open');
  });

  it('start を2回続けて呼んでも、接続は1本', () => {
    client.start();
    client.start();
    expect(sockets).toHaveLength(1);
  });
});

describe('7渡しで受け取ったカードの強調（design-2 §6.3）', () => {
  const view = (hand: string[]) => ({ gameNo: 1, game: { hand } }) as unknown as StateMessage['view'];
  const giveToMe = (seq: number) => ev(seq, { type: 'give', from: 3, to: 0, count: 1, cards: ['club-3'] });

  it('受け取ったら強調し、拒否では消さず、自分の操作が受理されたら消す', () => {
    const s = joined();
    s.receive(state({ view: view(['club-3', 'spade-9']), events: [giveToMe(5)] }));
    expect(client.getSnapshot().gift?.cards).toEqual(['club-3']);
    // 操作を送って拒否された
    expect(client.sendAction({ type: 'pass', awaitId: 7 }, 'pass')).toBe(true);
    const reqId = s.json().at(-1)!['reqId'] as number;
    s.receive({ type: 'error', code: 'actionRejected', message: 'x', reqId, engineError: 'staleAwait' });
    expect(client.getSnapshot().gift?.cards).toEqual(['club-3']);
    // 他人の操作で届いた state では消えない
    s.receive(state({ view: view(['club-3', 'spade-9']), events: [ev(6, { type: 'pass', seat: 1 })] }));
    expect(client.getSnapshot().gift?.cards).toEqual(['club-3']);
    // 自分の操作が受理された（返事を待っている間に state が届いた）
    expect(client.sendAction({ type: 'pass', awaitId: 8 }, 'pass')).toBe(true);
    s.receive(state({ view: view(['club-3', 'spade-9']), events: [ev(7, { type: 'pass', seat: 0 })] }));
    expect(client.getSnapshot().gift).toBeNull();
  });

  it('設定などホストの操作の返事では消さない。復帰した直後は復元しない', () => {
    const s = joined();
    s.receive(state({ view: view(['club-3']), events: [giveToMe(5)] }));
    expect(client.send({ type: 'nextGame', matchId: 'm1' }, 'next')).toBe(true);
    s.receive(state({ view: view(['club-3']), events: [ev(6, { type: 'pass', seat: 1 })] }));
    expect(client.getSnapshot().gift?.cards).toEqual(['club-3']);
    s.receive(state({ view: view(['club-3']), events: [giveToMe(5)], eventsFull: true }));
    expect(client.getSnapshot().gift).toBeNull();
  });
});
