// 見本ページ（開発のときだけ）。固定のデータで各画面を描く。/dev/gallery?s=<場面>
// 画像で確かめるために使う（design-client §6、§7.12）。

import type { CardId, SeatId } from '@chofugo/engine';
import { DAIFUGO_MODE_DEFAULT_RULES } from '@chofugo/engine';
import type { StateMessage } from '@chofugo/server/protocol';
import type { Anim, Feed } from '../lib/events.ts';
import type { PlayStep } from '../lib/selection.ts';
import type { Snapshot } from '../net/RoomClient.ts';
import { GameResult, MatchResult } from '../screens/Results.tsx';
import { Lobby } from '../screens/Lobby.tsx';
import { Menu } from '../screens/Menu.tsx';
import { Banner, RoomBody } from '../screens/Room.tsx';
import { Home, NameEntry } from '../screens/Simple.tsx';
import { Table } from '../screens/Table.tsx';
import { noopApi } from '../screens/types.ts';
import { devFrameStyle } from '../App.tsx';
import { deadline, gameView, group, legal, NOW, playerView, run, seats, snapOf, stateMsg } from './fixtures.ts';

const HAND12: CardId[] = ['club-3', 'diamond-4', 'spade-6', 'heart-6', 'spade-7', 'heart-7', 'diamond-8', 'club-10', 'spade-11', 'heart-13', 'club-14', 'joker-0'];
const HAND16: CardId[] = [
  'spade-3', 'club-3', 'diamond-4', 'heart-5', 'spade-6', 'heart-6', 'spade-7', 'diamond-8',
  'spade-10', 'heart-10', 'club-11', 'diamond-12', 'heart-13', 'club-14', 'spade-15', 'joker-1',
];

function mockTurn(): StateMessage {
  const plays = [
    legal(group(['spade-6', 'heart-6'], 6)),
    legal(group(['spade-7', 'heart-7'], 7)),
    legal(group(['spade-6', 'joker-0'], 6, [{ card: 'joker-0', rank: 6, suit: 'heart' }])),
    legal(group(['heart-6', 'joker-0'], 6, [{ card: 'joker-0', rank: 6, suit: 'spade' }])),
  ];
  return stateMsg({
    view: playerView({
      game: gameView({
        hand: HAND12,
        handCounts: [12, 5, 9, 7],
        field: [{ seat: 2, play: group(['spade-9', 'heart-9'], 9), via: 'turn' }],
        lastPlayer: 2,
        passed: [false, false, true, false],
        revolution: true,
        reversed: true,
        suitLock: ['spade', 'heart'],
      }),
      awaiting: [{ id: 21, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: { awaitId: 21, kind: 'turn', leader: false, plays, canPass: true },
    }),
    deadlines: [deadline(0, 'turn', 18_000, 21)],
  });
}

function theirTurn(): StateMessage {
  return stateMsg({
    view: playerView({
      game: gameView({
        hand: HAND12,
        handCounts: [12, 5, 9, 7],
        field: [{ seat: 0, play: group(['club-10'], 10), via: 'turn' }],
        lastPlayer: 0,
      }),
      awaiting: [{ id: 22, seat: 1, kind: 'turn', timer: 'turn' }],
      mine: null,
    }),
    deadlines: [deadline(1, 'turn', 21_000, 22)],
  });
}

function respond(asked: boolean): StateMessage {
  const asking: SeatId = asked ? 0 : 3;
  return stateMsg({
    view: playerView({
      rules: [...DAIFUGO_MODE_DEFAULT_RULES],
      game: gameView({
        hand: ['spade-3', ...HAND12.slice(1, 11)],
        handCounts: [11, 4, 9, 7],
        field: [{ seat: 1, play: group(['joker-1'], null), via: 'turn' }],
        lastPlayer: 1,
        returnRound: { rule: 'spade3_beats_joker', source: 1, asking },
      }),
      awaiting: [{ id: 30, seat: asking, kind: 'respond', timer: 'respond' }],
      mine: asked ? { awaitId: 30, kind: 'respond', rule: 'spade3_beats_joker', plays: [legal(group(['spade-3'], 3))] } : null,
    }),
    deadlines: [deadline(asking, 'respond', 6_000, 30)],
  });
}

function hand16(): StateMessage {
  const plays = [legal(group(['spade-10', 'heart-10'], 10)), legal(group(['spade-15'], 15)), legal(group(['joker-1'], null))];
  return stateMsg({
    view: playerView({
      game: gameView({
        hand: HAND16,
        handCounts: [16, 12, 13, 13],
        field: [{ seat: 3, play: group(['club-9', 'diamond-9'], 9), via: 'turn' }],
        lastPlayer: 3,
        myExchange: { gave: ['spade-4', 'club-5'], received: ['spade-15', 'joker-1'] },
      }),
      awaiting: [{ id: 41, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: { awaitId: 41, kind: 'turn', leader: false, plays, canPass: true },
    }),
    deadlines: [deadline(0, 'turn', 8_000, 41)],
  });
}

function field6(): StateMessage {
  return stateMsg({
    view: playerView({
      game: gameView({
        hand: HAND12.slice(0, 8),
        handCounts: [8, 3, 9, 1],
        field: [
          {
            seat: 1,
            play: group(['spade-7', 'heart-7', 'diamond-7', 'club-7', 'joker-0', 'joker-1'], 7, [
              { card: 'joker-0', rank: 7, suit: null },
              { card: 'joker-1', rank: 7, suit: null },
            ]),
            via: 'turn',
          },
        ],
        lastPlayer: 1,
        revolution: true,
        reversed: true,
      }),
      awaiting: [{ id: 50, seat: 2, kind: 'turn', timer: 'turn' }],
      mine: null,
    }),
    deadlines: [deadline(2, 'turn', 26_000, 50)],
  });
}

function longRun(): StateMessage {
  const cards = ['spade-3', 'spade-4', 'spade-5', 'spade-6', 'joker-0', 'spade-8', 'spade-9', 'spade-10', 'spade-11'];
  return stateMsg({
    view: playerView({
      game: gameView({
        hand: HAND12.slice(0, 6),
        handCounts: [6, 2, 9, 5],
        field: [{ seat: 3, play: run(cards, 'spade', 3, 11, [{ card: 'joker-0', rank: 7, suit: 'spade' }]), via: 'turn' }],
        lastPlayer: 3,
        revolution: true,
        tempReverse: true,
        reversed: false,
      }),
      awaiting: [{ id: 51, seat: 1, kind: 'turn', timer: 'turn' }],
      mine: null,
    }),
    deadlines: [deadline(1, 'turn', 12_000, 51)],
  });
}

function placedState(): StateMessage {
  return stateMsg({
    view: playerView({
      game: gameView({
        hand: HAND12.slice(0, 5),
        handCounts: [5, 0, 9, 0],
        places: [null, 2, null, 4],
        placeReasons: [null, 'finish', null, 'dethrone'],
        field: [],
      }),
      awaiting: [{ id: 60, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: { awaitId: 60, kind: 'turn', leader: true, plays: [legal(group(['club-3'], 3)), legal(group(['diamond-4'], 4))], canPass: false },
    }),
    deadlines: [deadline(0, 'turn', 29_000, 60)],
  });
}

function exchange(role: 'lower' | 'upper' | 'wait'): StateMessage {
  const hand: CardId[] = role === 'upper'
    ? ['club-3', 'diamond-4', 'heart-5', 'spade-6', 'heart-7', 'diamond-8', 'club-10', 'spade-11', 'heart-12', 'club-13', 'spade-14', 'heart-15', 'diamond-15', 'joker-0', 'joker-1', 'club-15']
    : ['club-3', 'diamond-4', 'heart-5', 'spade-6', 'heart-7', 'diamond-8', 'club-10', 'spade-11', 'heart-12', 'club-13', 'spade-14', 'heart-14', 'diamond-14'];
  const mine =
    role === 'lower'
      ? { awaitId: 5, kind: 'exchangeGive' as const, role: 'lower' as const, count: 1, forced: [], candidates: ['spade-14', 'heart-14', 'diamond-14'], choose: 1 }
      : role === 'upper'
        ? { awaitId: 6, kind: 'exchangeGive' as const, role: 'upper' as const, count: 2, forced: [], candidates: [], choose: 2 }
        : null;
  const me: SeatId = 0;
  return stateMsg({
    view: playerView({
      phase: 'exchange',
      prevRanks: role === 'upper' ? [1, 2, 3, 4] : [3, 2, 1, 4],
      game: gameView({
        hand,
        handCounts: [hand.length, 13, 14, 12],
        exchange: [
          { lower: 3, upper: role === 'upper' ? 0 : 2, count: 2, stage: role === 'upper' ? 'upperGive' : 'lowerGive' },
          { lower: role === 'upper' ? 2 : 0, upper: 1, count: 1, stage: 'lowerGive' },
        ],
        myExchange: role === 'upper' ? { gave: [], received: ['joker-1', 'club-15'] } : { gave: [], received: [] },
      }),
      awaiting:
        role === 'wait'
          ? [{ id: 7, seat: 3, kind: 'exchangeGive', timer: 'exchange' }]
          : [
              { id: mine!.awaitId, seat: me, kind: 'exchangeGive', timer: 'exchange' },
              { id: 8, seat: 3, kind: 'exchangeGive', timer: 'exchange' },
            ],
      mine,
    }),
    matchPhase: 'exchange',
    deadlines:
      role === 'wait'
        ? [deadline(3, 'exchangeGive', 41_000, 7)]
        : [deadline(me, 'exchangeGive', 52_000, mine!.awaitId), deadline(3, 'exchangeGive', 40_000, 8)],
  });
}

function resultState(final: boolean, host = true): StateMessage {
  const results = [
    { gameNo: 1, places: [2, 1, 3, 4] as const, deltas: [1, 2, -1, -2] },
    { gameNo: 2, places: [1, 4, 2, 3] as const, deltas: [2, -2, 1, -1] },
    { gameNo: 3, places: [1, 4, 3, 2] as const, deltas: [2, -2, -1, 1] },
  ].map((r) => ({ ...r, places: [...r.places] }));
  return stateMsg({
    isHost: host,
    seat: host ? 0 : 2,
    view: playerView({
      seat: host ? 0 : 2,
      phase: final ? 'matchResult' : 'gameResult',
      gameCount: 5,
      scores: [5, -2, -1, -2],
      results: results as never,
      game: gameView({ places: [1, 4, 3, 2], placeReasons: ['finish', 'dethrone', 'foul', 'last'] }),
      standings: final
        ? [
            { seat: 0, score: 5, rank: 1 },
            { seat: 2, score: -1, rank: 2 },
            { seat: 1, score: -2, rank: 3 },
            { seat: 3, score: -2, rank: 3 },
          ]
        : null,
    }),
    matchPhase: final ? 'matchResult' : 'gameResult',
  });
}

function lobby(host: boolean, names?: [string, string, string, string]): StateMessage {
  return stateMsg({
    view: null,
    isHost: host,
    seat: host ? 0 : 1,
    room: {
      roomId: 'K7M2QX9DaBcDeFgHiJkLmN',
      phase: 'lobby',
      seats: seats(names ?? ['なつき', 'たろう', 'ゆい', ''], ['human', 'human', 'human', 'empty']),
      host: 0,
      config: { rules: [...DAIFUGO_MODE_DEFAULT_RULES], gameCount: 5 },
      paused: false,
    },
  });
}

const NAMES12: [string, string, string, string] = ['ながいなまえのひとです１２', 'ABCDEFGHIJKL', 'じゅうにもじのなまえだよ', 'CPU 4'];

type Scene = { title: string; render: () => React.ReactNode };

function withSnap(st: StateMessage, over: Partial<Snapshot> = {}): Snapshot {
  return snapOf(st, over);
}

function historyFeed(): Feed {
  return {
    matchId: 'm1',
    seen: new Set(),
    gameNo: 3,
    top: null,
    history: [
      { seq: 1, seat: 1, play: group(['club-3', 'diamond-3'], 3), via: 'turn' },
      { seq: 2, seat: 2, play: group(['heart-9', 'spade-9'], 9), via: 'turn' },
      { seq: 3, seat: 3, play: run(['heart-4', 'heart-5', 'heart-6'], 'heart', 4, 6), via: 'turn' },
      { seq: 4, seat: 0, play: group(['joker-0'], null), via: 'turn' },
      { seq: 5, seat: 1, play: group(['spade-3'], 3), via: 'respond' },
    ],
  };
}

const SCENES: Record<string, Scene> = {
  home: { title: 'ホーム', render: () => <Home go={() => {}} /> },
  name: { title: '名前の入力', render: () => <NameEntry state={lobby(false)} onJoin={() => {}} joinError={null} /> },
  'name-full': {
    title: '名前の入力（満員）',
    render: () => <NameEntry state={stateMsg({ ...lobby(false), seat: null, room: { ...lobby(false).room, seats: seats(['なつき', 'たろう', 'ゆい', 'みき'], ['human', 'human', 'human', 'human']) } })} onJoin={() => {}} joinError={null} />,
  },
  'lobby-host': { title: 'ロビー（ホスト）', render: () => <Lobby state={lobby(true)} snap={withSnap(lobby(true))} api={noopApi} /> },
  'lobby-guest': { title: 'ロビー（ホスト以外、説明を開いた）', render: () => <Lobby state={lobby(false)} snap={withSnap(lobby(false))} api={noopApi} initialOpen="spade3_beats_joker" /> },
  'lobby-12': { title: 'ロビー（12文字の名前）', render: () => <Lobby state={lobby(true, NAMES12)} snap={withSnap(lobby(true, NAMES12))} api={noopApi} /> },
  'exchange-lower': {
    title: '交換（下位が選ぶ）',
    render: () => <Table state={exchange('lower')} snap={withSnap(exchange('lower'))} api={noopApi} fixedNow={NOW} />,
  },
  'exchange-upper': {
    title: '交換（上位が選ぶ、受け取ったカードに印）',
    render: () => {
      const st = exchange('upper');
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} initialSelected={['club-3', 'diamond-4']} />;
    },
  },
  'exchange-wait': { title: '交換（待つ）', render: () => <Table state={exchange('wait')} snap={withSnap(exchange('wait'))} api={noopApi} fixedNow={NOW} /> },
  'play-myturn': {
    title: '対戦（自分の番）',
    render: () => {
      const st = mockTurn();
      return <Table state={st} snap={withSnap(st, { line: 'CPU 4 は パスした' })} api={noopApi} fixedNow={NOW} initialSelected={['spade-6', 'heart-6']} />;
    },
  },
  'play-theirturn': {
    title: '対戦（相手の番）',
    render: () => {
      const st = theirTurn();
      return <Table state={st} snap={withSnap(st, { line: 'あなた が 10を1枚 出した' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-respond': {
    title: '対戦（返しの一周・聞かれている）',
    render: () => {
      const st = respond(true);
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-respond-other': {
    title: '対戦（返しの一周・ほかの人）',
    render: () => {
      const st = respond(false);
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-16': {
    title: '対戦（手札16枚・2段）',
    render: () => {
      const st = hand16();
      return <Table state={st} snap={withSnap(st, { line: 'CPU 4 が 9を2枚 出した' })} api={noopApi} fixedNow={NOW} initialSelected={['spade-10']} />;
    },
  },
  'play-field6': {
    title: '対戦（場に6枚組・革命中）',
    render: () => {
      const st = field6();
      return <Table state={st} snap={withSnap(st, { line: '革命！' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-run': {
    title: '対戦（長い階段・革命と J バック）',
    render: () => {
      const st = longRun();
      return <Table state={st} snap={withSnap(st, { line: 'J バック！' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-placed': {
    title: '対戦（上がった人・都落ち）',
    render: () => {
      const st = placedState();
      return <Table state={st} snap={withSnap(st, { line: '都落ち！ CPU 4 は 4位' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-shape': {
    title: '対戦（組か階段かの2択）',
    render: () => {
      const g = group(['spade-5', 'joker-0', 'joker-1'], 5, [{ card: 'joker-0', rank: 5, suit: null }, { card: 'joker-1', rank: 5, suit: null }]);
      const r = run(['spade-5', 'joker-0', 'joker-1'], 'spade', 5, 7, [{ card: 'joker-0', rank: 6, suit: 'spade' }, { card: 'joker-1', rank: 7, suit: 'spade' }]);
      const st = placedState();
      const step: PlayStep = { kind: 'chooseShape', options: [legal(g), legal(r)] };
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} initialStep={step} />;
    },
  },
  'play-foul': {
    title: '対戦（反則上がりの確認）',
    render: () => {
      const st = placedState();
      const step: PlayStep = { kind: 'confirmFoul', play: legal(group(['joker-0'], null), true) };
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} initialStep={step} />;
    },
  },
  'play-12': {
    title: '対戦（12文字の名前）',
    render: () => {
      const st = theirTurn();
      const s2 = { ...st, room: { ...st.room, seats: seats(NAMES12) } };
      return <Table state={s2} snap={withSnap(s2, { line: 'ABCDEFGHIJKL は パスした' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-menu': {
    title: 'メニュー（このゲームで出たカード）',
    render: () => {
      const st = theirTurn();
      return <Menu state={st} feed={historyFeed()} onClose={() => {}} onLeave={() => {}} initial="history" />;
    },
  },
  'play-anim-revolution': {
    title: '演出（革命）',
    render: () => {
      const st = field6();
      const anim: Anim = { kind: 'revolution', seq: 1 };
      return <Table state={st} snap={withSnap(st, { anim })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-reconnecting': {
    title: 'つなぎ直し中',
    render: () => {
      const st = theirTurn();
      const sn = withSnap(st, { status: 'reconnecting', ready: false });
      return (
        <>
          <RoomBody snap={sn} api={noopApi} fixedNow={NOW} />
          <Banner snap={sn} />
        </>
      );
    },
  },
  'game-result': { title: 'ゲームの結果（都落ちあり、ホスト）', render: () => <GameResult state={resultState(false)} snap={withSnap(resultState(false))} api={noopApi} finalGame={false} /> },
  'game-result-guest': {
    title: 'ゲームの結果（ホスト以外）',
    render: () => <GameResult state={resultState(false, false)} snap={withSnap(resultState(false, false))} api={noopApi} finalGame={false} />,
  },
  'game-result-final': {
    title: '最後のゲームの結果',
    render: () => <GameResult state={resultState(true)} snap={withSnap(resultState(true))} api={noopApi} finalGame />,
  },
  'match-result': { title: '試合の結果（ホスト）', render: () => <MatchResult state={resultState(true)} snap={withSnap(resultState(true))} api={noopApi} /> },
  'match-result-guest': { title: '試合の結果（ホスト以外）', render: () => <MatchResult state={resultState(true, false)} snap={withSnap(resultState(true, false))} api={noopApi} /> },
  connecting: { title: '接続中', render: () => <RoomBody snap={snapOf(null, { status: 'connecting', joinStage: 'joining', ready: false })} api={noopApi} /> },
  gaveup: { title: 'つながらない', render: () => <RoomBody snap={snapOf(null, { status: 'gaveUp', ready: false })} api={noopApi} /> },
  replaced: { title: '別の画面で開かれた', render: () => <RoomBody snap={snapOf(null, { status: 'replaced', ready: false })} api={noopApi} /> },
};


export default function Gallery() {
  const params = new URLSearchParams(location.search);
  const key = params.get('s');
  const scene = key === null ? undefined : SCENES[key];
  if (scene === undefined) {
    return (
      <div className="app" style={{ overflowY: 'auto', padding: 16 }}>
        <h1 style={{ fontWeight: 400, fontSize: 32, color: 'var(--gold)', margin: '0 0 16px' }}>見本</h1>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '32px' }}>
          {Object.entries(SCENES).map(([k, v]) => (
            <li key={k}>
              <a href={`/dev/gallery?s=${k}`} style={{ color: 'var(--gold-hi)' }}>
                {v.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="app" style={devFrameStyle()}>
      {scene.render()}
    </div>
  );
}
