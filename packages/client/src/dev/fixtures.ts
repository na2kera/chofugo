// 見本ページ（/dev/gallery）の固定のデータ。開発のときだけ読み込まれる。

import type { CardId, GameView, LegalPlay, Place, PlayerView, Play, RuleId, SeatId, Suit } from '@chofugo/engine';
import { DAIFUGO_MODE_DEFAULT_RULES } from '@chofugo/engine';
import type { DeadlineView, SeatInfo, StateMessage } from '@chofugo/server/protocol';
import { emptyFeed, type Feed } from '../lib/events.ts';
import type { Snapshot } from '../net/RoomClient.ts';

export const NOW = 1_800_000_000_000;

const ROOM_ID = 'K7M2QX9DaBcDeFgHiJkLmN';

export function seats(names: [string, string, string, string] = ['なつき', 'たろう', 'ゆい', 'CPU 4'], kinds?: SeatInfo['kind'][]): SeatInfo[] {
  return names.map((name, i) => {
    const kind = kinds?.[i] ?? (name.startsWith('CPU') ? 'cpu' : name === '' ? 'empty' : 'human');
    return { seat: i as SeatId, kind, name: kind === 'empty' ? null : name, connected: kind === 'human', away: false };
  });
}

export function group(cards: CardId[], rank: number | null, jokers: Play['jokers'] = []): Play {
  return { shape: 'group', cards, rank: rank as never, jokers };
}

export function run(cards: CardId[], suit: Suit, low: number, high: number, jokers: Play['jokers'] = []): Play {
  return { shape: 'run', cards, suit, low: low as never, high: high as never, jokers };
}

export function legal(play: Play, foul = false): LegalPlay {
  return { cards: play.cards, shape: play.shape, play, foul };
}

export function gameView(over: Partial<GameView> = {}): GameView {
  return {
    hand: [],
    handCounts: [12, 5, 9, 7],
    discard: [],
    field: [],
    lastPlayer: null,
    direction: 1,
    passed: [false, false, false, false],
    places: [null, null, null, null],
    placeReasons: [null, null, null, null],
    revolution: false,
    tempReverse: false,
    reversed: false,
    suitLock: null,
    returnRound: null,
    exchange: null,
    myExchange: null,
    starter: 0,
    ...over,
  };
}

export function playerView(over: Partial<PlayerView> = {}): PlayerView {
  return {
    matchId: 'm1',
    seat: 0,
    rules: [...DAIFUGO_MODE_DEFAULT_RULES],
    gameCount: 5,
    gameNo: 3,
    phase: 'play',
    scores: [1, 3, -2, -2],
    prevRanks: [2, 1, 3, 4] as Place[],
    results: [],
    game: gameView(),
    awaiting: [],
    mine: null,
    standings: null,
    ...over,
  };
}

export function deadline(seat: SeatId, kind: DeadlineView['kind'], leftMs: number, awaitId = 10): DeadlineView {
  return { awaitId, seat, kind, at: NOW + leftMs, remainingMs: null };
}

export function stateMsg(over: Partial<StateMessage> & { view?: PlayerView | null } = {}): StateMessage {
  const view = over.view === undefined ? playerView() : over.view;
  return {
    type: 'state',
    room: {
      roomId: ROOM_ID,
      phase: view === null ? 'lobby' : 'playing',
      seats: seats(),
      host: 0,
      config: { rules: (view?.rules ?? [...DAIFUGO_MODE_DEFAULT_RULES]) as RuleId[], gameCount: view?.gameCount ?? 5 },
      paused: false,
      ...(over.room ?? {}),
    },
    seat: 0,
    isHost: true,
    matchId: view === null ? null : view.matchId,
    matchPhase: view === null ? null : view.phase,
    version: 1,
    view,
    events: [],
    eventsFull: true,
    deadlines: [],
    serverTime: NOW,
    ...over,
  } as StateMessage;
}

export function snapOf(state: StateMessage | null, over: Partial<Snapshot> = {}): Snapshot {
  const feed: Feed = emptyFeed();
  return {
    status: 'open',
    joinStage: 'joined',
    ready: true,
    state,
    feed,
    line: null,
    anim: null,
    pending: null,
    offset: 0,
    gameResultFirst: new Set(),
    joinError: null,
    ...over,
  };
}
