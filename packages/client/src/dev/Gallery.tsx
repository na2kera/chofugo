// 見本ページ（開発のときだけ）。固定のデータで各画面を描く。/dev/gallery?s=<場面>
// 画像で確かめるために使う（design-client §6、§7.12）。

import { ALL_ABILITY_IDS } from '@chofugo/engine';
import type { AbilityId, CallRank, CardId, Color, SeatId, UsableAbility } from '@chofugo/engine';
import { ALL_RULE_IDS, DAIFUGO_MODE_DEFAULT_RULES, STAGE1_RULE_IDS, type RuleId } from '@chofugo/engine';
import type { GameMode, StateMessage } from '@chofugo/server/protocol';
import type { Anim, Feed } from '../lib/events.ts';
import type { PlayStep } from '../lib/selection.ts';
import type { AbilityPanel } from '../lib/abilities.ts';
import type { Snapshot } from '../net/RoomClient.ts';
import { GameResult, MatchResult } from '../screens/Results.tsx';
import { Lobby } from '../screens/Lobby.tsx';
import { Menu } from '../screens/Menu.tsx';
import { Help } from '../screens/Help.tsx';
import { demoOf, helpItemKey, helpSections, parseFixedFrame, type HelpItem } from '../lib/help.ts';
import { RuleDemo } from '../components/RuleDemo.tsx';
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
      mine: { awaitId: 21, kind: 'turn', leader: false, plays, canPass: true, abilities: [], skipAvailable: false },
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
      mine: { awaitId: 41, kind: 'turn', leader: false, plays, canPass: true, abilities: [], skipAvailable: false },
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
      mine: { awaitId: 60, kind: 'turn', leader: true, plays: [legal(group(['club-3'], 3)), legal(group(['diamond-4'], 4))], canPass: false, abilities: [], skipAvailable: false },
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

// ---------- その2（カスタムモード）の場面 ----------

const CUSTOM_RULES: RuleId[] = [...ALL_RULE_IDS];

/** 7渡し・10捨ての選択（選ぶ本人）。 */
function choiceMine(rule: 'give_on_7' | 'discard_on_10'): StateMessage {
  return stateMsg({
    view: playerView({
      rules: CUSTOM_RULES,
      game: gameView({
        hand: HAND12.slice(0, 10),
        handCounts: [10, 6, 9, 7],
        field: [{ seat: 0, play: group(rule === 'give_on_7' ? ['spade-7', 'heart-7'] : ['spade-10', 'heart-10'], rule === 'give_on_7' ? 7 : 10), via: 'turn' }],
        lastPlayer: 0,
        choice: { rule, seat: 0, to: rule === 'give_on_7' ? 1 : null },
      }),
      awaiting: [{ id: 70, seat: 0, kind: 'choice', timer: 'choice' }],
      mine: { awaitId: 70, kind: 'choice', rule, max: 2, to: rule === 'give_on_7' ? 1 : null },
    }),
    deadlines: [deadline(0, 'choice', 11_000, 70)],
  });
}

/** ほかの人が選んでいる。 */
function choiceOther(): StateMessage {
  return stateMsg({
    view: playerView({
      rules: CUSTOM_RULES,
      game: gameView({
        hand: HAND12,
        handCounts: [12, 4, 9, 7],
        field: [{ seat: 2, play: group(['club-7'], 7), via: 'turn' }],
        lastPlayer: 2,
        choice: { rule: 'give_on_7', seat: 2, to: 3 },
      }),
      awaiting: [{ id: 71, seat: 2, kind: 'choice', timer: 'choice' }],
      mine: null,
    }),
    deadlines: [deadline(2, 'choice', 9_000, 71)],
  });
}

/** 4止めの返し。fours = 手札の4の数（3枚なら組み合わせが3つ）。 */
function fourStop(fours: 2 | 3): StateMessage {
  const all = ['spade-4', 'heart-4', 'club-4'].slice(0, fours);
  const plays = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) plays.push(legal(group([all[i]!, all[j]!], 4)));
  const hand: CardId[] = ['club-3', ...all, 'spade-6', 'heart-7', 'diamond-9', 'club-10', 'spade-11', 'heart-13', 'joker-0'];
  return stateMsg({
    view: playerView({
      rules: CUSTOM_RULES,
      game: gameView({
        hand,
        handCounts: [hand.length, 6, 9, 7],
        field: [{ seat: 3, play: group(['spade-8', 'diamond-8'], 8), via: 'turn' }],
        lastPlayer: 3,
        returnRound: { rule: 'block_flush_with_4', source: 3, asking: 0 },
      }),
      awaiting: [{ id: 72, seat: 0, kind: 'respond', timer: 'respond' }],
      mine: { awaitId: 72, kind: 'respond', rule: 'block_flush_with_4', plays },
    }),
    deadlines: [deadline(0, 'respond', 7_000, 72)],
  });
}

/** 発動中の札がたくさん出ている場（革命・J バック・縛り・激縛り・逆回り）。 */
function badges(): StateMessage {
  return stateMsg({
    view: playerView({
      rules: CUSTOM_RULES,
      game: gameView({
        hand: HAND12,
        handCounts: [12, 5, 9, 7],
        field: [{ seat: 1, play: group(['heart-6', 'diamond-6'], 6), via: 'turn' }],
        lastPlayer: 1,
        revolution: true,
        tempReverse: true,
        reversed: false,
        suitLock: ['heart', 'diamond'],
        seqLock: { suits: ['heart', 'diamond'], rank: 6 as never },
        orderReversed: true,
        direction: -1,
      }),
      awaiting: [{ id: 73, seat: 2, kind: 'turn', timer: 'turn' }],
      mine: null,
    }),
    deadlines: [deadline(2, 'turn', 20_000, 73)],
  });
}

/** ダイヤの3スタートの最初の1手。 */
function opening(): StateMessage {
  const hand: CardId[] = ['diamond-3', 'club-3', 'heart-5', 'spade-6', 'heart-7', 'diamond-8', 'club-10', 'spade-11', 'heart-12', 'club-13', 'spade-14', 'heart-15', 'joker-0'];
  return stateMsg({
    view: playerView({
      rules: CUSTOM_RULES,
      gameNo: 1,
      prevRanks: null,
      game: gameView({ hand, handCounts: [13, 14, 13, 14], openingCard: 'diamond-3', starter: 0 }),
      awaiting: [{ id: 74, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: {
        awaitId: 74,
        kind: 'turn',
        leader: true,
        canPass: false,
        abilities: [],
        skipAvailable: false,
        plays: [legal(group(['diamond-3'], 3)), legal(group(['diamond-3', 'club-3'], 3)), legal(group(['diamond-3', 'joker-0'], 3, [{ card: 'joker-0', rank: 3, suit: null }]))],
      },
    }),
    deadlines: [deadline(0, 'turn', 27_000, 74)],
  });
}

/** 7渡しで受け取ったカードの強調（自分の番）。 */
function gifted(): StateMessage {
  const st = theirTurn();
  const view = st.view!;
  return {
    ...st,
    view: {
      ...view,
      rules: CUSTOM_RULES,
      awaiting: [{ id: 75, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: { awaitId: 75, kind: 'turn', leader: false, canPass: true, plays: [legal(group(['spade-11'], 11)), legal(group(['heart-13'], 13)), legal(group(['club-14'], 14))], abilities: [], skipAvailable: false },
    },
    deadlines: [deadline(0, 'turn', 24_000, 75)],
  };
}

function lobbyCustom(host: boolean, rules: RuleId[], mode: GameMode = 'custom'): StateMessage {
  const st = lobby(host);
  return { ...st, room: { ...st.room, config: { mode, rules, gameCount: 5 } } };
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
      config: { mode: 'daifugo', rules: [...DAIFUGO_MODE_DEFAULT_RULES], gameCount: 5 },
      paused: false,
    },
  });
}

const NAMES12: [string, string, string, string] = ['ながいなまえのひとです１２', 'ABCDEFGHIJKL', 'じゅうにもじのなまえだよ', 'CPU 4'];

// ---------- その3（超富豪モード）の場面 ----------

/** 超富豪モードのルール（第2段階から24種すべて）。 */
const CHOFUGO_RULES: RuleId[] = [...ALL_RULE_IDS];

/** 特権の選択（選ぶ人）。hand16 なら手札16枚（2段）。 */
function abilitySelectMine(draft: AbilityId[], slots: number, hand16 = true): StateMessage {
  const hand = hand16 ? HAND16 : HAND12;
  return stateMsg({
    view: playerView({
      rules: CHOFUGO_RULES,
      phase: 'ability',
      prevRanks: [1, 3, 2, 4],
      game: gameView({
        hand,
        handCounts: [hand.length, 13, 14, 13],
        abilities: { holder: 0, slots, remaining: slots, selecting: true },
        myAbilities: { chosen: [], used: [], draft },
        myExchange: { gave: ['spade-4', 'club-5'], received: ['spade-15', 'joker-1'] },
      }),
      awaiting: [{ id: 80, seat: 0, kind: 'abilitySelect', timer: 'ability' }],
      mine: { awaitId: 80, kind: 'abilitySelect', slots, draft },
    }),
    matchPhase: 'ability',
    room: { ...lobby(true).room, phase: 'playing', seats: seats(), config: { mode: 'chofugo', rules: CHOFUGO_RULES, gameCount: 5 } },
    deadlines: [deadline(0, 'abilitySelect', 44_000, 80)],
  });
}

/** ほかの人が特権を選んでいる。 */
function abilitySelectOther(names?: [string, string, string, string]): StateMessage {
  return stateMsg({
    seat: 0,
    view: playerView({
      rules: CHOFUGO_RULES,
      phase: 'ability',
      prevRanks: [3, 1, 2, 4],
      game: gameView({ hand: HAND12, handCounts: [12, 14, 14, 14], abilities: { holder: 1, slots: 2, remaining: 2, selecting: true } }),
      awaiting: [{ id: 81, seat: 1, kind: 'abilitySelect', timer: 'ability' }],
      mine: null,
    }),
    matchPhase: 'ability',
    room: { ...lobby(true).room, phase: 'playing', seats: seats(names), config: { mode: 'chofugo', rules: CHOFUGO_RULES, gameCount: 5 } },
    deadlines: [deadline(1, 'abilitySelect', 38_000, 81)],
  });
}

/** 自分が大富豪の手番。chosen の特権のボタンを並べる。leader なら場は空。 */
function abilityTurn(opts: {
  chosen: AbilityId[];
  used?: AbilityId[];
  leader?: boolean;
  hand?: CardId[];
  names?: [string, string, string, string];
  openingCard?: CardId | null;
  peek?: { target: SeatId; cards: CardId[] } | null;
  ban?: number | null;
}): StateMessage {
  const hand = opts.hand ?? HAND12;
  const used = opts.used ?? [];
  const leader = opts.leader ?? false;
  const unused = opts.chosen.filter((x) => !used.includes(x));
  const abilities: UsableAbility[] = [];
  for (const id of unused) {
    if (id === 'peek') abilities.push({ id, usable: true, targets: [1, 2, 3] });
    if (id === 'steal') abilities.push({ id, usable: true, targets: [1, 2, 3], cards: hand.filter((c) => c !== opts.openingCard) });
    if (id === 'forceFlush') abilities.push({ id, usable: !leader });
    if (id === 'ban') {
      const all = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      abilities.push({ id, usable: true, ranks: (opts.openingCard === 'diamond-3' ? all.filter((r) => r !== 3) : all) as never });
    }
    if (id === 'revolution') abilities.push({ id, usable: true });
  }
  const field = leader ? [] : [{ seat: 1 as SeatId, play: group(['club-5', 'diamond-5'], 5), via: 'turn' as const }];
  const plays = leader
    ? [legal(group([hand[0]!], 3)), legal(group([hand[1]!], 4))].map((x) => ({ ...x, canSkip: true as const }))
    : [{ ...legal(group(['spade-6', 'heart-6'], 6)), canSkip: true as const }, { ...legal(group(['spade-7', 'heart-7'], 7)), canSkip: true as const }];
  return stateMsg({
    view: playerView({
      rules: CHOFUGO_RULES,
      gameNo: 3,
      prevRanks: [1, 3, 2, 4],
      game: gameView({
        hand,
        handCounts: [hand.length, 9, 11, 13],
        field,
        lastPlayer: leader ? null : 1,
        openingCard: opts.openingCard ?? null,
        abilities: { holder: 0, slots: opts.chosen.length, remaining: unused.length, selecting: false },
        myAbilities: { chosen: opts.chosen, used, draft: opts.chosen },
        peek: opts.peek ?? null,
        ban: (opts.ban ?? null) as never,
      }),
      awaiting: [{ id: 90, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: { awaitId: 90, kind: 'turn', leader, canPass: !leader, plays, abilities, skipAvailable: unused.includes('skip') },
    }),
    room: { ...lobby(true).room, phase: 'playing', seats: seats(opts.names), config: { mode: 'chofugo', rules: CHOFUGO_RULES, gameCount: 5 } },
    deadlines: [deadline(0, 'turn', 22_000, 90)],
  });
}

/** 透視で見られた側（自分）。持ち主は左の相手。 */
function peekedTarget(): StateMessage {
  return stateMsg({
    view: playerView({
      rules: CHOFUGO_RULES,
      prevRanks: [3, 1, 2, 4],
      game: gameView({
        hand: HAND12,
        handCounts: [12, 7, 11, 13],
        field: [{ seat: 1, play: group(['club-9'], 9), via: 'turn' }],
        lastPlayer: 1,
        abilities: { holder: 1, slots: 2, remaining: 1, selecting: false },
        peekedMine: ['spade-6', 'club-10', 'heart-13'],
        ban: 7 as never,
      }),
      awaiting: [{ id: 91, seat: 2, kind: 'turn', timer: 'turn' }],
      mine: null,
    }),
    room: { ...lobby(true).room, phase: 'playing', seats: seats(), config: { mode: 'chofugo', rules: CHOFUGO_RULES, gameCount: 5 } },
    deadlines: [deadline(2, 'turn', 17_000, 91)],
  });
}

/** ポスター（dev/Poster.tsx）でも使う。 */
export function chofugoTurnScene(title: string, opts: Parameters<typeof abilityTurn>[0], extra: { panel?: AbilityPanel; steal?: CardId; skipOn?: boolean; line?: string; selected?: CardId[] } = {}): Scene {
  return {
    title,
    render: () => {
      const st = abilityTurn(opts);
      return (
        <Table
          state={st}
          snap={withSnap(st, { line: extra.line ?? null })}
          api={noopApi}
          fixedNow={NOW}
          {...(extra.panel ? { initialPanel: extra.panel } : {})}
          {...(extra.steal ? { initialStealCard: extra.steal } : {})}
          {...(extra.skipOn ? { initialSkipOn: true } : {})}
          {...(extra.selected ? { initialSelected: extra.selected } : {})}
        />
      );
    },
  };
}

// ---------- 第2段階（特殊ルール8種）の場面 ----------

const HAND10: CardId[] = HAND12.slice(0, 10);

/** 銀河鉄道・闇市・Q ボンバーの選択（選ぶ本人）。field は出した役の手。 */
function stage2Choice(opts: {
  rule: 'triple9_salvage' | 'triple_a_trade' | 'call_discard_on_q';
  max: number;
  hand?: CardId[];
  handCounts?: number[];
  names?: [string, string, string, string];
  targets?: SeatId[];
}): StateMessage {
  const hand = opts.hand ?? HAND10;
  const field =
    opts.rule === 'triple9_salvage'
      ? group(['spade-9', 'heart-9', 'club-9'], 9)
      : opts.rule === 'triple_a_trade'
        ? group(['spade-14', 'heart-14', 'diamond-14'], 14)
        : group(['spade-12', 'heart-12'], 12);
  return stateMsg({
    view: playerView({
      rules: [...ALL_RULE_IDS],
      game: gameView({
        hand,
        handCounts: opts.handCounts ?? [hand.length, 6, 1, 7],
        discard: ['club-5', 'diamond-6', 'heart-11'],
        field: [{ seat: 0, play: field, via: 'turn' }],
        lastPlayer: 0,
        choice: { rule: opts.rule, seat: 0, to: null },
      }),
      awaiting: [{ id: 100, seat: 0, kind: 'choice', timer: 'choice' }],
      mine: {
        awaitId: 100,
        kind: 'choice',
        rule: opts.rule,
        max: opts.max,
        to: null,
        ...(opts.rule === 'triple_a_trade' ? { targets: opts.targets ?? [1, 2, 3] } : {}),
      },
    }),
    room: { ...lobby(true).room, phase: 'playing', seats: seats(opts.names), config: { mode: 'custom', rules: [...ALL_RULE_IDS], gameCount: 5 } },
    deadlines: [deadline(0, 'choice', 11_000, 100)],
  });
}

/** 色縛りの札が出ている場。six なら札を6つ（革命・J バック・縛り・激縛り・色縛り・逆回り）。 */
function colorLockField(color: Color, six: boolean): StateMessage {
  return stateMsg({
    view: playerView({
      rules: [...ALL_RULE_IDS],
      game: gameView({
        hand: HAND12,
        handCounts: [12, 5, 9, 7],
        field: [{ seat: 1, play: group(color === 'red' ? ['heart-5', 'diamond-5'] : ['spade-5', 'club-5'], 5), via: 'turn' }],
        lastPlayer: 1,
        colorLock: color,
        ...(six
          ? {
              revolution: true,
              tempReverse: true,
              reversed: false,
              suitLock: ['heart', 'diamond'] as never,
              seqLock: { suits: ['heart', 'diamond'], rank: 5 as never },
              orderReversed: true,
              direction: -1 as const,
            }
          : {}),
      }),
      awaiting: [{ id: 101, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: {
        awaitId: 101,
        kind: 'turn',
        leader: false,
        canPass: true,
        // 色縛りの色のカードとジョーカーの組だけが出せる（ほかのカードは暗い）
        plays: (color === 'red' ? ['heart-6', 'heart-7', 'diamond-8', 'heart-13'] : ['spade-6', 'spade-7', 'club-10', 'spade-11', 'club-14']).map((c) =>
          legal(group([c, 'joker-0'], Number(c.split('-')[1]), [{ card: 'joker-0', rank: Number(c.split('-')[1]) as never, suit: null }])),
        ),
        abilities: [],
        skipAvailable: false,
      },
    }),
    room: { ...lobby(true).room, phase: 'playing', seats: seats(), config: { mode: 'custom', rules: [...ALL_RULE_IDS], gameCount: 5 } },
    deadlines: [deadline(0, 'turn', 19_000, 101)],
  });
}

/** 自分の番（受け取ったカードの強調・新しいメッセージを見せる）。 */
function stage2Turn(hand: CardId[]): StateMessage {
  return stateMsg({
    view: playerView({
      rules: [...ALL_RULE_IDS],
      game: gameView({
        hand,
        handCounts: [hand.length, 4, 9, 7],
        field: [{ seat: 3, play: group(['club-8'], 8), via: 'turn' }],
        lastPlayer: 3,
      }),
      awaiting: [{ id: 102, seat: 0, kind: 'turn', timer: 'turn' }],
      mine: { awaitId: 102, kind: 'turn', leader: false, canPass: true, plays: hand.map((c) => legal(group([c], 9))), abilities: [], skipAvailable: false },
    }),
    room: { ...lobby(true).room, phase: 'playing', seats: seats(), config: { mode: 'custom', rules: [...ALL_RULE_IDS], gameCount: 5 } },
    deadlines: [deadline(0, 'turn', 24_000, 102)],
  });
}

/** 相手の番（メッセージだけを見せる）。 */
function stage2Their(): StateMessage {
  return stateMsg({
    view: playerView({
      rules: [...ALL_RULE_IDS],
      game: gameView({ hand: HAND12, handCounts: [12, 4, 9, 7], field: [], lastPlayer: null, revolution: true, reversed: true }),
      awaiting: [{ id: 103, seat: 2, kind: 'turn', timer: 'turn' }],
      mine: null,
    }),
    room: { ...lobby(true).room, phase: 'playing', seats: seats(), config: { mode: 'custom', rules: [...ALL_RULE_IDS], gameCount: 5 } },
    deadlines: [deadline(2, 'turn', 26_000, 103)],
  });
}

function stage2Scene(title: string, st: () => StateMessage, extra: { line?: string; selected?: CardId[]; target?: SeatId; ranks?: CallRank[]; gift?: CardId[] } = {}): Scene {
  return {
    title,
    render: () => {
      const s = st();
      return (
        <Table
          state={s}
          snap={withSnap(s, { line: extra.line ?? null, ...(extra.gift ? { gift: { matchId: 'm1', gameNo: 3, cards: extra.gift } } : {}) })}
          api={noopApi}
          fixedNow={NOW}
          {...(extra.selected ? { initialSelected: extra.selected } : {})}
          {...(extra.target !== undefined ? { initialTradeTarget: extra.target } : {})}
          {...(extra.ranks ? { initialCallRanks: extra.ranks } : {})}
        />
      );
    },
  };
}

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
    skip: null,
    history: [
      { seq: 1, seat: 1, cards: ['club-3', 'diamond-3'], via: 'turn' },
      { seq: 2, seat: 2, cards: ['heart-9', 'spade-9'], via: 'turn' },
      { seq: 3, seat: 3, cards: ['heart-4', 'heart-5', 'heart-6'], via: 'turn' },
      { seq: 4, seat: 0, cards: ['joker-0'], via: 'turn' },
      { seq: 5, seat: 1, cards: ['spade-3'], via: 'respond' },
    ],
  };
}

// ---------- ルールの説明「？」（design-5） ----------

/**
 * ?s=help-demo&rule=<ルール ID>（特権は &ability=<特権 ID>）&frame=<コマ。1から>&rm=1（視差効果を減らす）。
 * frame を付けると、そのコマで止まる（自動で進まない）。付けなければ自動で進む。
 */
function helpParams(): { item: HelpItem; frame?: number; reduced?: boolean } {
  const q = new URLSearchParams(location.search);
  const ab = q.get('ability');
  const rule = q.get('rule');
  const item: HelpItem =
    ab !== null && (ALL_ABILITY_IDS as readonly string[]).includes(ab)
      ? { kind: 'ability', id: ab as AbilityId }
      : { kind: 'rule', id: rule !== null && (ALL_RULE_IDS as readonly string[]).includes(rule) ? (rule as RuleId) : 'temp_reverse_on_j' };
  const frame = parseFixedFrame(q.get('frame'), demoOf(item).length);
  return { item, ...(frame !== null ? { frame } : {}), ...(q.get('rm') === '1' ? { reduced: true } : {}) };
}

function helpList(mode: GameMode, rules: RuleId[], yourTurn = false): () => React.ReactNode {
  return () => <Help mode={mode} rules={rules} yourTurn={yourTurn} onClose={() => {}} />;
}

/**
 * 30個の見本の、すべてのコマを止めて並べた確認用の一覧（設計担当がルールと照らして目で確かめるため、§6.7）。
 * 1行に1つの見本。並びは説明の一覧と同じ。各コマの枠は上ぞろえなので、コマによって枠の高さが違えば目で分かる。
 * 広い画面で開く（例：&vw=1260&vh=9000。枠の中を縦横にスクロールできる）。
 */
function HelpSheet() {
  const entries = helpSections('chofugo', [...ALL_RULE_IDS]).flatMap((sec) => sec.entries.map((e) => ({ ...e, title: sec.title })));
  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ padding: 16, width: 'max-content' }}>
        {entries.map((e) => {
          const data = demoOf(e.item);
          return (
            <section key={helpItemKey(e.item)} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
              <h3 style={{ width: 120, margin: 0, fontWeight: 400, color: 'var(--gold)' }}>
                {e.title}
                <br />
                {e.name}
              </h3>
              {data.map((_, i) => (
                <div key={i} style={{ width: 260 }}>
                  <RuleDemo data={data} fixedFrame={i} reducedMotion={false} />
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 長いゲーム数（無制限の第12ゲーム）の対戦の画面。上の帯の左右が重ならないことを確かめる。 */
function longTitle(): StateMessage {
  const st = theirTurn();
  return { ...st, view: { ...st.view!, gameNo: 12, gameCount: null } };
}

const HELP_SCENES: Record<string, Scene> = {
  'help-list-daifugo': { title: 'ルールの説明（一覧・大富豪モード）', render: helpList('daifugo', [...DAIFUGO_MODE_DEFAULT_RULES]) },
  'help-list-custom': { title: 'ルールの説明（一覧・カスタム24種）', render: helpList('custom', [...ALL_RULE_IDS]) },
  'help-list-chofugo': { title: 'ルールの説明（一覧・超富豪モード）', render: helpList('chofugo', [...ALL_RULE_IDS]) },
  'help-demo': {
    title: 'ルールの説明（1つを開いた。&rule= / &ability= / &frame= / &rm=1）',
    render: () => {
      const h = helpParams();
      return (
        <Help
          mode="custom"
          rules={[...ALL_RULE_IDS]}
          yourTurn={false}
          onClose={() => {}}
          initial={h.item}
          {...(h.frame !== undefined ? { fixedFrame: h.frame } : {})}
          {...(h.reduced ? { reducedMotion: true } : {})}
        />
      );
    },
  },
  'help-sheet': { title: 'ルールの説明（30個の見本の全コマを並べた確認用。&vw=1260&vh=<高さ> で広げて開く）', render: () => <HelpSheet /> },
  'help-yourturn': {
    title: 'ルールの説明（開いている間に自分の番になった・一覧）',
    render: () => {
      const st = mockTurn();
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} initialHelp="list" />;
    },
  },
  'help-yourturn-demo': {
    title: 'ルールの説明（自分の番・闇市の3コマ目で止める）',
    render: () => {
      const st = mockTurn();
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} initialHelp={{ kind: 'rule', id: 'triple_a_trade' }} initialHelpFrame={2} />;
    },
  },
  'help-lobby': {
    title: 'ルールの説明（ロビーから開いた・カスタム）',
    render: () => {
      const st = lobbyCustom(true, [...DAIFUGO_MODE_DEFAULT_RULES, 'block_flush_with_4', 'give_on_7', 'triple_a_trade']);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} initialHelp />;
    },
  },
  'play-longtitle': {
    title: '対戦（無制限の第12ゲーム・上の帯の「？」≡）',
    render: () => {
      const st = longTitle();
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
};

const SCENES: Record<string, Scene> = {
  home: { title: 'ホーム', render: () => <Home go={() => {}} /> },
  'home-error': { title: 'ホーム（作成エラー）', render: () => <Home go={() => {}} initialError="ルームを作れませんでした。もう一度試してください" /> },
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
  // ---------- その2 ----------
  'lobby-custom': {
    title: 'ロビー（カスタム・ホスト）',
    render: () => {
      const st = lobbyCustom(true, [...DAIFUGO_MODE_DEFAULT_RULES, 'block_flush_with_4', 'give_on_7', 'discard_on_10', 'skip_on_k']);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'lobby-custom-all': {
    title: 'ロビー（カスタム・全部 ON、説明を開いた）',
    render: () => {
      const st = lobbyCustom(true, CUSTOM_RULES);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} initialOpen="diamond3_start" />;
    },
  },
  'lobby-custom-locked': {
    title: 'ロビー（カスタム・8切りが OFF で4止めを押せない）',
    render: () => {
      const st = lobbyCustom(true, ['revolution', 'runs', 'give_on_7']);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'lobby-custom-guest': {
    title: 'ロビー（カスタム・ホスト以外）',
    render: () => {
      const st = lobbyCustom(false, [...DAIFUGO_MODE_DEFAULT_RULES, 'sequence_lock', 'triple3_trump']);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'play-give': {
    title: '対戦（7渡しの選択）',
    render: () => {
      const st = choiceMine('give_on_7');
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} initialSelected={['club-3', 'diamond-4']} />;
    },
  },
  'play-discard': {
    title: '対戦（10捨ての選択・0枚）',
    render: () => {
      const st = choiceMine('discard_on_10');
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-choosing-other': {
    title: '対戦（ほかの人が7渡しを選んでいる）',
    render: () => {
      const st = choiceOther();
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-4stop': {
    title: '対戦（4止めの返し・4が3枚で選ぶ）',
    render: () => {
      const st = fourStop(3);
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} initialSelected={['spade-4']} />;
    },
  },
  'play-4stop-one': {
    title: '対戦（4止めの返し・候補が1つ）',
    render: () => {
      const st = fourStop(2);
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-badges': {
    title: '対戦（札が5つ：革命・J バック・縛り・激縛り・逆回り）',
    render: () => {
      const st = badges();
      return <Table state={st} snap={withSnap(st, { line: '激縛り！' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-opening': {
    title: '対戦（ダイヤの3スタートの最初の1手）',
    render: () => {
      const st = opening();
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-gift': {
    title: '対戦（7渡しで受け取ったカード）',
    render: () => {
      const st = gifted();
      return <Table state={st} snap={withSnap(st, { line: 'たろう から 2枚 受け取った', gift: { matchId: 'm1', gameNo: 3, cards: ['spade-11', 'heart-13'] } })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-menu-discard': {
    title: 'メニュー（出たカード・10捨てと4止めを含む）',
    render: () => {
      const st = theirTurn();
      const feed: Feed = {
        ...historyFeed(),
        history: [
          { seq: 1, seat: 1, cards: ['club-10', 'diamond-10'], via: 'turn' },
          { seq: 2, seat: 1, cards: ['club-3', 'heart-5'], via: 'discard' },
          { seq: 3, seat: 2, cards: ['spade-8'], via: 'turn' },
          { seq: 4, seat: 3, cards: ['spade-4', 'heart-4'], via: 'respond' },
        ],
      };
      return <Menu state={st} feed={feed} onClose={() => {}} onLeave={() => {}} initial="history" />;
    },
  },
  // ---------- その3 ----------
  'lobby-chofugo': {
    title: 'ロビー（超富豪・ホスト、説明を開いた）',
    render: () => {
      const st = lobbyCustom(true, CHOFUGO_RULES, 'chofugo');
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} initialOpen="give_on_7" />;
    },
  },
  'lobby-chofugo-guest': {
    title: 'ロビー（超富豪・ホスト以外）',
    render: () => {
      const st = lobbyCustom(false, CHOFUGO_RULES, 'chofugo');
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'ability-select': {
    title: '特権の選択（選ぶ人・2個のうち1個を選んだ・手札16枚）',
    render: () => {
      const st = abilitySelectMine(['steal'], 2);
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'ability-select-full': {
    title: '特権の選択（選ぶ人・枠がいっぱい・手札12枚）',
    render: () => {
      const st = abilitySelectMine(['peek', 'ban', 'skip'], 3, false);
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'ability-select-other': {
    title: '特権の選択（ほかの人）',
    render: () => {
      const st = abilitySelectOther();
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'ability-select-other-12': {
    title: '特権の選択（ほかの人・12文字の名前）',
    render: () => {
      const st = abilitySelectOther(NAMES12);
      return <Table state={st} snap={withSnap(st)} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-abilities': chofugoTurnScene('対戦（特権のボタン・親なので強制流しは暗い）', { chosen: ['peek', 'forceFlush', 'skip'], leader: true }, { line: 'たろう が 8を1枚 出した' }),
  'play-abilities-skip': chofugoTurnScene('対戦（特権のボタン・スキップ ON）', { chosen: ['steal', 'ban', 'skip'] }, { skipOn: true, selected: ['spade-6', 'heart-6'] }),
  'play-panel-peek': chofugoTurnScene('対戦（透視の選択の枠）', { chosen: ['peek', 'revolution'] }, { panel: 'peek' }),
  'play-panel-peek-12': chofugoTurnScene('対戦（透視の選択の枠・12文字の名前）', { chosen: ['peek', 'revolution'], names: NAMES12 }, { panel: 'peek' }),
  'play-panel-steal': chofugoTurnScene('対戦（強奪の選択の枠・渡すカードを選んだ）', { chosen: ['steal', 'skip'], hand: HAND16 }, { panel: 'steal', steal: 'club-3' }),
  'play-panel-ban': chofugoTurnScene('対戦（独裁の選択の枠・ダイヤの3の義務で3は暗い）', { chosen: ['ban'], leader: true, openingCard: 'diamond-3', hand: ['diamond-3', ...HAND12.slice(1)] }, { panel: 'ban' }),
  'play-panel-revolution': chofugoTurnScene('対戦（革命の確認）', { chosen: ['revolution', 'forceFlush'] }, { panel: 'revolution' }),
  'play-panel-forceflush': chofugoTurnScene('対戦（強制流しの確認）', { chosen: ['revolution', 'forceFlush'] }, { panel: 'forceFlush' }),
  'play-peek-holder': chofugoTurnScene(
    '対戦（透視で見たカード・持ち主、独裁の札）',
    { chosen: ['peek', 'ban', 'skip'], used: ['peek', 'ban'], peek: { target: 1, cards: ['heart-10', 'spade-13', 'joker-0'] }, ban: 7 },
    { line: '独裁！ 7 は出せない' },
  ),
  'play-peek-16': chofugoTurnScene(
    '対戦（透視3枚・10を含む、手札16枚、12文字の名前）',
    { chosen: ['peek', 'steal', 'skip'], used: ['peek'], peek: { target: 1, cards: ['heart-10', 'club-10', 'spade-14'] }, hand: HAND16, names: NAMES12 },
    { line: 'あなた が ABCDEFGHIJKL に 透視を使った' },
  ),
  'play-peeked': {
    title: '対戦（透視で見られた側・持ち主の札・独裁の札）',
    render: () => {
      const st = peekedTarget();
      return <Table state={st} snap={withSnap(st, { line: 'たろう に 3枚 見られた' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-menu-rules16': {
    title: 'メニュー（この試合のルール・24種）',
    render: () => {
      const st = stateMsg({ view: playerView({ rules: CUSTOM_RULES }), room: { ...theirTurn().room, config: { mode: 'custom', rules: CUSTOM_RULES, gameCount: 5 } } });
      return <Menu state={st} feed={historyFeed()} onClose={() => {}} onLeave={() => {}} initial="rules" />;
    },
  },
  // ---------- 第2段階（特殊ルール8種、design-4 §4） ----------
  'lobby-custom24': {
    title: 'ロビー（カスタム・24種すべて ON）',
    render: () => {
      const st = lobbyCustom(true, [...ALL_RULE_IDS]);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'lobby-custom24-open': {
    title: 'ロビー（カスタム・24種、銀河鉄道の説明を開いた）',
    render: () => {
      const st = lobbyCustom(true, [...ALL_RULE_IDS]);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} initialOpen="triple9_salvage" />;
    },
  },
  'lobby-custom-6locked': {
    title: 'ロビー（カスタム・J バックが OFF で6戻しを押せない）',
    render: () => {
      const st = lobbyCustom(true, [...DAIFUGO_MODE_DEFAULT_RULES, 'color_lock_on_5', 'triple6_revolution', 'call_discard_on_q']);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'lobby-custom16': {
    title: 'ロビー（カスタム・第1段階の16種だけ ON）',
    render: () => {
      const st = lobbyCustom(true, [...STAGE1_RULE_IDS]);
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'lobby-chofugo24': {
    title: 'ロビー（超富豪・24種、ホスト以外）',
    render: () => {
      const st = lobbyCustom(false, CHOFUGO_RULES, 'chofugo');
      return <Lobby state={st} snap={withSnap(st)} api={noopApi} />;
    },
  },
  'play-salvage': stage2Scene('対戦（銀河鉄道の選択・1枚を選んだ）', () => stage2Choice({ rule: 'triple9_salvage', max: 2 }), { selected: ['club-3'] }),
  'play-salvage-0': stage2Scene('対戦（銀河鉄道の選択・0枚）', () => stage2Choice({ rule: 'triple9_salvage', max: 2, hand: HAND16, handCounts: [16, 9, 8, 7] })),
  'play-trade': stage2Scene('対戦（闇市・相手を選ぶ前）', () => stage2Choice({ rule: 'triple_a_trade', max: 2 }), { line: 'あなた が Aを3枚 出した' }),
  'play-trade-picked': stage2Scene('対戦（闇市・相手と2枚を選んだ）', () => stage2Choice({ rule: 'triple_a_trade', max: 2 }), { target: 3, selected: ['club-3', 'diamond-4'] }),
  'play-trade-1': stage2Scene('対戦（闇市・残り1枚の相手を選んだ）', () => stage2Choice({ rule: 'triple_a_trade', max: 2 }), { target: 2, selected: ['diamond-4'] }),
  'play-trade-12': stage2Scene(
    '対戦（闇市・12文字の名前・手札16枚）',
    () => stage2Choice({ rule: 'triple_a_trade', max: 2, names: NAMES12, hand: HAND16, handCounts: [16, 13, 12, 13] }),
    { target: 1 },
  ),
  'play-call': stage2Scene('対戦（Q ボンバー・2個まで、7 と JOKER を選んだ）', () => stage2Choice({ rule: 'call_discard_on_q', max: 2 }), { ranks: [7 as CallRank, 'joker'], line: 'あなた が Qを2枚 出した' }),
  'play-call-16': stage2Scene('対戦（Q ボンバー・手札16枚・0個）', () => stage2Choice({ rule: 'call_discard_on_q', max: 3, hand: HAND16, handCounts: [16, 9, 8, 7] })),
  'play-call-empty': stage2Scene('対戦（Q ボンバー・手札0枚）', () => stage2Choice({ rule: 'call_discard_on_q', max: 1, hand: [], handCounts: [0, 9, 8, 7] }), { ranks: [12 as CallRank] }),
  'play-colorlock': stage2Scene('対戦（色縛り 赤・色の合わないカードは暗い）', () => colorLockField('red', false), { line: '5色縛り！ 赤だけ' }),
  'play-colorlock-black': stage2Scene('対戦（色縛り 黒）', () => colorLockField('black', false), { line: '色縛りの色に合わない' }),
  'play-badges6': stage2Scene('対戦（札が6つ：革命・J バック・縛り・激縛り・色縛り・逆回り）', () => colorLockField('red', true)),
  'play-salvage-gift': stage2Scene('対戦（銀河鉄道で引いたカード）', () => stage2Turn(HAND12), { line: '銀河鉄道！ あなた が 2枚 交換した', gift: ['spade-11', 'club-14'] }),
  'play-trade-gift': stage2Scene('対戦（闇市で受け取ったカード・相手の側）', () => stage2Turn(HAND12), { line: 'たろう と 2枚 交換した', gift: ['diamond-4', 'spade-6'] }),
  'play-msg-trade': stage2Scene('対戦（メッセージ：闇市・当事者以外）', () => stage2Their(), { line: '闇市！ たろう と ゆい が 2枚 交換した' }),
  'play-msg-trade-12': {
    title: '対戦（メッセージ：闇市・12文字の名前）',
    render: () => {
      const st = stage2Their();
      const s2 = { ...st, room: { ...st.room, seats: seats(NAMES12) } };
      return <Table state={s2} snap={withSnap(s2, { line: '闇市！ ABCDEFGHIJKL と じゅうにもじのなまえだよ が 2枚 交換した' })} api={noopApi} fixedNow={NOW} />;
    },
  },
  'play-msg-death': stage2Scene('対戦（メッセージ：DEATH）', () => stage2Their(), { line: 'DEATH！ 3人が1枚ずつ捨てた' }),
  'play-msg-call': stage2Scene('対戦（メッセージ：Q ボンバー）', () => stage2Their(), { line: 'Q ボンバー！ 7・K・JOKER' }),
  'play-msg-omen': stage2Scene('対戦（メッセージ：オーメンのあとの革命）', () => stage2Their(), { line: '革命！' }),
  'play-msg-6': stage2Scene('対戦（メッセージ：6戻し）', () => stage2Their(), { line: '6戻し！ J バック解除' }),
  'play-msg-instant': stage2Scene('対戦（メッセージ：大革命）', () => stage2Their(), { line: '大革命！ ゆい が上がった' }),
  'play-menu-effects': {
    title: 'メニュー（出たカード・DEATH・銀河鉄道・闇市・Q ボンバー・大革命）',
    render: () => {
      const st = stage2Their();
      const feed: Feed = {
        ...historyFeed(),
        history: [
          { seq: 1, seat: 1, cards: ['club-4', 'diamond-4', 'heart-4'], via: 'turn' },
          { seq: 2, seat: 2, cards: ['joker-0'], via: 'effect', rule: 'triple4_purge' },
          { seq: 2, seat: 3, cards: ['club-14'], via: 'effect', rule: 'triple4_purge' },
          { seq: 2, seat: 0, cards: ['spade-14'], via: 'effect', rule: 'triple4_purge' },
          { seq: 3, seat: 0, cards: ['spade-9', 'heart-9', 'club-9'], via: 'turn' },
          { seq: 4, seat: 0, cards: ['club-3', 'diamond-5'], via: 'effect', rule: 'triple9_salvage' },
          { seq: 5, seat: 0, cards: ['club-6', 'heart-7'], via: 'effect', rule: 'triple_a_trade' },
          { seq: 5, seat: 1, cards: ['spade-13', 'heart-10'], via: 'effect', rule: 'triple_a_trade' },
          { seq: 6, seat: 2, cards: ['club-12', 'diamond-12'], via: 'turn' },
          { seq: 7, seat: 1, cards: ['spade-7', 'diamond-7'], via: 'effect', rule: 'call_discard_on_q' },
          { seq: 8, seat: 3, cards: ['spade-15', 'heart-15', 'club-15', 'diamond-15'], via: 'turn' },
          { seq: 9, seat: 3, cards: ['spade-3', 'heart-8', 'club-10', 'diamond-11', 'spade-12', 'heart-13'], via: 'effect', rule: 'quad2_instant_win' },
        ],
      };
      return <Menu state={st} feed={feed} onClose={() => {}} onLeave={() => {}} initial="history" />;
    },
  },
  ...HELP_SCENES,
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
