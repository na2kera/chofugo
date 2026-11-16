// engine の公開型。server と client もこの型を使う。
// 状態はすべて JSON にそのまま書き出せる形（Map / Set / クラス / undefined の値を持たない）。

import type { CardId, Rank, Suit } from './cards.ts';
import type { RngState } from './rng.ts';

export type SeatId = 0 | 1 | 2 | 3;
export const SEATS: readonly SeatId[] = [0, 1, 2, 3];
export const SEAT_COUNT = 4;

/** 1ゲームの順位（1 = 大富豪、2 = 富豪、3 = 貧民、4 = 大貧民）。カードの Rank とは別。 */
export type Place = 1 | 2 | 3 | 4;

/** 第1段階の16種（decisions §6.0）。 */
export const ALL_RULE_IDS = [
  'flush_on_8',
  'block_flush_with_4',
  'revolution',
  'temp_reverse_on_j',
  'spade3_beats_joker',
  'suit_lock',
  'sequence_lock',
  'runs',
  'forbidden_finish',
  'dethrone',
  'diamond3_start',
  'triple3_trump',
  'give_on_7',
  'reverse_order_on_9',
  'discard_on_10',
  'skip_on_k',
] as const;
export type RuleId = (typeof ALL_RULE_IDS)[number];

/** その1で実装済みのルール（定番8種）。 */
export const IMPLEMENTED_RULE_IDS = [
  'flush_on_8',
  'revolution',
  'temp_reverse_on_j',
  'spade3_beats_joker',
  'suit_lock',
  'runs',
  'forbidden_finish',
  'dethrone',
] as const satisfies readonly RuleId[];

/** 大富豪モードで選べるルール（定番8種、decisions §7）。 */
export const DAIFUGO_MODE_RULE_IDS: readonly RuleId[] = IMPLEMENTED_RULE_IDS;

/** 大富豪モードの最初の状態（おすすめ設定、decisions §7）。 */
export const DAIFUGO_MODE_DEFAULT_RULES: readonly RuleId[] = [
  'flush_on_8',
  'revolution',
  'spade3_beats_joker',
  'runs',
  'dethrone',
];

export type GameCount = 5 | 10 | null; // null = 無制限

export type MatchConfig = {
  matchId: string;
  /** 有効にするルール。 */
  rules: RuleId[];
  /** ゲーム数。null は無制限。 */
  gameCount: GameCount;
};

// ---------- 手 ----------

export type Shape = 'group' | 'run';

/** ジョーカーが何の代わりか（出した時点で確定、decisions §14.6）。 */
export type JokerUse = {
  card: CardId;
  /** 代わりにした数字。ジョーカーだけの組では null。 */
  rank: Rank | null;
  /** 代わりにしたマーク。決める必要がないときは null。 */
  suit: Suit | null;
};

/** 組（1枚出しを含む）。rank が null ならジョーカーだけの組。 */
export type GroupPlay = {
  shape: 'group';
  cards: CardId[];
  rank: Rank | null;
  jokers: JokerUse[];
};

/** 階段。low〜high は数字（3〜15）で、ジョーカーの位置も含めた範囲。 */
export type RunPlay = {
  shape: 'run';
  cards: CardId[];
  suit: Suit;
  low: Rank;
  high: Rank;
  jokers: JokerUse[];
};

export type Play = GroupPlay | RunPlay;

export type FieldPlay = {
  seat: SeatId;
  play: Play;
  /** turn = 手番で出した手、respond = 返しの一周で返した手。 */
  via: 'turn' | 'respond';
};

/** 出せない理由の種類（design §8.1）。返しの手などは、どの種類を無視するかを宣言する。 */
export type ViolationKind =
  | 'fieldShape' // 場の種類が違う
  | 'fieldSize' // 場の枚数が違う
  | 'notStronger' // 場より強くない
  | 'suitLock' // マーク縛り
  | 'passed'; // パス済み

export type Violation = { kind: ViolationKind };

// ---------- 待ち ----------

export type AwaitKind = 'turn' | 'respond' | 'exchangeGive';
export type AwaitTimer = 'turn' | 'respond' | 'choice' | 'exchange' | 'ability';

export type Awaiting = {
  id: number;
  seat: SeatId;
  kind: AwaitKind;
  timer: AwaitTimer;
};

// ---------- 効果と中断 ----------

/** 1手で起きる効果。決まった順に1つずつ処理する（design §3.7、§8.1）。 */
export type Effect =
  | { type: 'toggleRevolution' }
  | { type: 'setTempReverse'; active: boolean }
  | { type: 'setSuitLock'; suits: Suit[] }
  | { type: 'clearSuitLock' }
  | { type: 'returnRound'; rule: RuleId }
  | { type: 'flush'; leader: SeatId; reason: FlushReason }
  | { type: 'forceLast'; seat: SeatId; reason: 'dethrone' };

export type FlushReason =
  | 'allPassed'
  | 'leaderPassed'
  | 'flush_on_8'
  | 'spade3_beats_joker'
  | 'returnFailed'
  | 'jokerUnbeatable';

/** 返しの一周の途中（再開に必要な情報）。 */
export type ReturnRoundPending = {
  type: 'returnRound';
  rule: RuleId;
  /** 返しの対象になった手を出した人。 */
  source: SeatId;
  /** まだ聞いていない参加者（先頭がいま聞かれている人）。 */
  queue: SeatId[];
  /** 返しの一周のあとに残っている効果。 */
  rest: Effect[];
};

export type Pending = ReturnRoundPending;

// ---------- 交換 ----------

export type ExchangePair = {
  lower: SeatId;
  upper: SeatId;
  count: number;
  /** lowerGive = 下位が渡す番、upperGive = 上位が渡す番、done = 終わり。 */
  stage: 'lowerGive' | 'upperGive' | 'done';
  /** 下位が必ず渡すカード（強さで決まっている分）。 */
  forced: CardId[];
  /** 下位が選ぶ候補（同じ強さで決まらない分）。 */
  candidates: CardId[];
  /** 候補から選ぶ枚数。 */
  choose: number;
  lowerGave: CardId[] | null;
  upperGave: CardId[] | null;
};

export type ExchangeState = { pairs: ExchangePair[] };

// ---------- ゲーム・試合の状態 ----------

export type PlaceReason = 'finish' | 'foul' | 'dethrone' | 'last';

export type GameState = {
  hands: CardId[][];
  /** 公開されている捨て札（場から流れたカード、都落ちした人の手札）。 */
  discard: CardId[];
  /** いまの場で出た手（最後がいちばん上）。 */
  field: FieldPlay[];
  /** いまの場で最後に出した人（場が空なら null）。 */
  lastPlayer: SeatId | null;
  /** 手番の向き（1 = 席番号の増える向き）。その1では常に 1。 */
  direction: 1 | -1;
  passed: boolean[];
  /** 上から確定した順位の列（先頭が1位）。 */
  topOrder: SeatId[];
  /** 下から確定した順位の列（先頭が4位）。 */
  bottomOrder: SeatId[];
  placeReasons: (PlaceReason | null)[];
  revolution: boolean;
  tempReverse: boolean;
  /** マーク縛り（組はマークの並び、階段は1つのマーク）。 */
  suitLock: Suit[] | null;
  pending: Pending | null;
  awaiting: Awaiting[];
  /** 1位が確定した瞬間の席ごとの手札枚数（特権枠の判定用。その1では記録だけ）。 */
  firstPlaceHandCounts: number[] | null;
  exchange: ExchangeState | null;
  /** そのゲームの最初の親。 */
  starter: SeatId;
};

export type GameResult = {
  gameNo: number;
  places: Place[];
  deltas: number[];
};

export type MatchPhase = 'exchange' | 'play' | 'gameResult' | 'matchResult';

export type MatchState = {
  version: 1;
  matchId: string;
  config: MatchConfig;
  rng: RngState;
  gameNo: number;
  scores: number[];
  /** 前のゲームの順位（席ごと）。1ゲーム目は null。 */
  prevRanks: Place[] | null;
  phase: MatchPhase;
  game: GameState | null;
  results: GameResult[];
  nextAwaitId: number;
  nextEventSeq: number;
};

// ---------- 操作 ----------

export type Action =
  | {
      type: 'play';
      seat: SeatId;
      awaitId: number;
      cards: CardId[];
      /** 同じカードが組にも階段にも読めるときに指定する。 */
      shape?: Shape;
      /** 反則上がりになる手を出すときに true。 */
      confirmFoul?: boolean;
    }
  | { type: 'pass'; seat: SeatId; awaitId: number }
  | {
      type: 'respond';
      seat: SeatId;
      awaitId: number;
      /** 返すカード。null ならスキップ。 */
      cards: CardId[] | null;
    }
  | { type: 'exchangeGive'; seat: SeatId; awaitId: number; cards: CardId[] }
  | { type: 'auto'; awaitId: number; policy: 'timeout' | 'cpu' }
  | { type: 'nextGame' }
  | { type: 'endMatch' };

export type ActionErrorCode =
  | 'malformed'
  | 'wrongPhase'
  | 'staleAwait'
  | 'notYourAwait'
  | 'wrongAwaitKind'
  | 'cardNotInHand'
  | 'invalidCombination'
  | 'ambiguousShape'
  | 'illegalPlay'
  | 'confirmFoulRequired'
  | 'cannotPass'
  | 'invalidResponse'
  | 'invalidExchange'
  | 'notUnlimited';

export type ActionError = {
  code: ActionErrorCode;
  /** illegalPlay のときの理由。 */
  violation?: ViolationKind;
  message: string;
};

export type ConfigErrorCode =
  | 'malformed'
  | 'unknownRule'
  | 'duplicateRule'
  | 'notImplemented'
  | 'missingRequirement'
  | 'invalidGameCount'
  | 'invalidSeed';

export type ConfigError = { code: ConfigErrorCode; rule?: RuleId; message: string };

export type CreateMatchResult =
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; error: ConfigError };

export type ApplyResult =
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; error: ActionError };

// ---------- 出せる手 ----------

export type LegalPlay = {
  cards: CardId[];
  shape: Shape;
  /** 出した場合の解釈。 */
  play: Play;
  /** 出すと反則上がりになる。 */
  foul: boolean;
};

// ---------- 出来事 ----------

type EventBase = { seq: number; gameNo: number };

export type GameEventBody =
  | { type: 'gameStart'; leaderRule: 'random' | 'prevLowest' }
  | { type: 'deal'; counts: number[]; hands: CardId[][] }
  | { type: 'exchangeStart'; pairs: { lower: SeatId; upper: SeatId; count: number }[] }
  | { type: 'exchange'; from: SeatId; to: SeatId; cards: CardId[] }
  | { type: 'exchangeDone' }
  | { type: 'turnStart'; seat: SeatId; leader: boolean }
  | { type: 'play'; seat: SeatId; play: Play; foul: boolean }
  | { type: 'pass'; seat: SeatId }
  | { type: 'revolution'; active: boolean }
  | { type: 'tempReverse'; active: boolean }
  | { type: 'suitLock'; suits: Suit[] }
  | { type: 'returnRoundStart'; rule: RuleId; source: SeatId; participants: SeatId[] }
  | { type: 'respond'; seat: SeatId; play: Play }
  | { type: 'respondSkip'; seat: SeatId }
  | { type: 'returnRoundEnd'; rule: RuleId; returnedBy: SeatId | null }
  | { type: 'fieldCleared'; reason: FlushReason; leader: SeatId }
  | { type: 'placed'; seat: SeatId; place: Place; reason: PlaceReason }
  | { type: 'dethrone'; seat: SeatId; discarded: CardId[] }
  | { type: 'gameEnd'; places: Place[]; deltas: number[]; scores: number[] }
  | { type: 'matchEnd'; standings: Standing[] };

export type GameEvent = EventBase & GameEventBody;

export type VisibleEventBody =
  | Exclude<GameEventBody, { type: 'deal' } | { type: 'exchange' }>
  | { type: 'deal'; counts: number[]; hand: CardId[] }
  | { type: 'exchange'; from: SeatId; to: SeatId; count: number; cards: CardId[] | null };

export type VisibleEvent = EventBase & VisibleEventBody;

export type Standing = { seat: SeatId; score: number; rank: number };

// ---------- 席から見える状態 ----------

export type MyAwaiting =
  | { awaitId: number; kind: 'turn'; leader: boolean; plays: LegalPlay[]; canPass: boolean }
  | { awaitId: number; kind: 'respond'; rule: RuleId; plays: LegalPlay[] }
  | {
      awaitId: number;
      kind: 'exchangeGive';
      role: 'lower' | 'upper';
      count: number;
      forced: CardId[];
      candidates: CardId[];
      choose: number;
    };

export type PublicExchangePair = {
  lower: SeatId;
  upper: SeatId;
  count: number;
  stage: ExchangePair['stage'];
};

export type GameView = {
  hand: CardId[];
  handCounts: number[];
  discard: CardId[];
  field: FieldPlay[];
  lastPlayer: SeatId | null;
  direction: 1 | -1;
  passed: boolean[];
  places: (Place | null)[];
  placeReasons: (PlaceReason | null)[];
  revolution: boolean;
  tempReverse: boolean;
  reversed: boolean;
  suitLock: Suit[] | null;
  returnRound: { rule: RuleId; source: SeatId; asking: SeatId | null } | null;
  exchange: PublicExchangePair[] | null;
  /** 自分が渡した・受け取ったカード（交換）。 */
  myExchange: { gave: CardId[]; received: CardId[] } | null;
  starter: SeatId;
};

export type PlayerView = {
  matchId: string;
  seat: SeatId;
  rules: RuleId[];
  gameCount: GameCount;
  gameNo: number;
  phase: MatchPhase;
  scores: number[];
  prevRanks: Place[] | null;
  results: GameResult[];
  game: GameView | null;
  awaiting: Awaiting[];
  mine: MyAwaiting | null;
  standings: Standing[] | null;
};
