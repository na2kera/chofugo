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

/** 実装済みのルール（その2で16種すべて）。 */
export const IMPLEMENTED_RULE_IDS: readonly RuleId[] = ALL_RULE_IDS;

/** 大富豪モードで選べるルール（定番8種、decisions §7。その1と同じ並び）。 */
export const DAIFUGO_MODE_RULE_IDS: readonly RuleId[] = [
  'flush_on_8',
  'revolution',
  'temp_reverse_on_j',
  'spade3_beats_joker',
  'suit_lock',
  'runs',
  'forbidden_finish',
  'dethrone',
];

/** カスタムモードで選べるルール（第1段階の16種、decisions §7）。 */
export const CUSTOM_MODE_RULE_IDS: readonly RuleId[] = ALL_RULE_IDS;

/** 大富豪モードの最初の状態（おすすめ設定、decisions §7）。 */
export const DAIFUGO_MODE_DEFAULT_RULES: readonly RuleId[] = [
  'flush_on_8',
  'revolution',
  'spade3_beats_joker',
  'runs',
  'dethrone',
];

export type GameCount = 5 | 10 | null; // null = 無制限

// ---------- 特権（その3、design-3 §2.1） ----------

/** 特権6種。並び順は ALL_ABILITY_IDS で固定。 */
export const ALL_ABILITY_IDS = ['peek', 'steal', 'forceFlush', 'ban', 'revolution', 'skip'] as const;
export type AbilityId = (typeof ALL_ABILITY_IDS)[number];

/** 連覇したときの枠の閾値（相手3人の残り手札の合計）。0〜14枚で1個、15〜24枚で2個、25枚以上で3個（仮の値、decisions §5.1）。 */
export const ABILITY_SLOT_THRESHOLDS: readonly number[] = [14, 24];

export type MatchConfig = {
  matchId: string;
  /** 有効にするルール。 */
  rules: RuleId[];
  /** ゲーム数。null は無制限。 */
  gameCount: GameCount;
  /** 特権あり（超富豪モード）。入力では省略は false。状態の中では必ず boolean。 */
  abilities?: boolean;
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
  | 'sequenceLock' // 激縛り
  | 'openingCard' // ダイヤの3スタートの義務
  | 'passed' // パス済み
  | 'ban'; // 独裁で封じられた数字（その3）

export type Violation = { kind: ViolationKind };

// ---------- 待ち ----------

/** choice = 7渡し・10捨ての「手札から選ぶ」待ち。abilitySelect = 特権の選択（その3）。 */
export type AwaitKind = 'turn' | 'respond' | 'exchangeGive' | 'choice' | 'abilitySelect';
export type AwaitTimer = 'turn' | 'respond' | 'choice' | 'exchange' | 'ability';

export type Awaiting = {
  id: number;
  seat: SeatId;
  kind: AwaitKind;
  timer: AwaitTimer;
  /** 特権を使って作り直した手番の待ちが、引き継ぐ元の番号（design-3 §6.1）。強制流しのあとの待ちには付けない。 */
  continues?: number;
};

// ---------- 効果と中断 ----------

/** 1手で起きる効果。決まった順に1つずつ処理する（design §3.7、§8.1、design-2 §2.2）。 */
export type Effect =
  | { type: 'toggleRevolution' }
  | { type: 'setTempReverse'; active: boolean }
  | { type: 'setSuitLock'; suits: Suit[] }
  | { type: 'clearSuitLock' }
  /** 激縛りの成立と、連番の更新（rank はいま場のいちばん上の手の数字）。 */
  | { type: 'setSeqLock'; suits: Suit[]; rank: Rank }
  | { type: 'clearSeqLock' }
  /** 9リバース。 */
  | { type: 'setOrderReverse'; active: boolean }
  /** ダイヤの3の義務を外す。 */
  | { type: 'clearOpening' }
  /** 7渡し・10捨て（選択の待ちを作る）。 */
  | { type: 'handChoice'; rule: RuleId; max: number }
  /** 上がりの判定（中心の処理が入れる印）。foul は出す直前に判定した反則上がりか。 */
  | { type: 'finishCheck'; foul: boolean }
  | { type: 'returnRound'; rule: RuleId }
  /** K スキップ（飛ばす人数）。 */
  | { type: 'skip'; count: number }
  | { type: 'flush'; leader: SeatId; reason: FlushReason }
  | { type: 'forceLast'; seat: SeatId; reason: 'dethrone' };

/** 場が流れた理由。ルールによるものはルール ID（8切り、スペ3返しなど）。 */
export type FlushReason = 'allPassed' | 'leaderPassed' | 'returnFailed' | 'jokerUnbeatable' | 'forceFlush' | RuleId;

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

/** 7渡し・10捨ての選択の途中（再開に必要な情報）。 */
export type ChoicePending = {
  type: 'choice';
  /** give_on_7 か discard_on_10。 */
  rule: RuleId;
  /** 選ぶ人（手を出した人）。 */
  seat: SeatId;
  /** 選べる上限（出した枚数）。 */
  max: number;
  /** 7渡しの相手。10捨ては null。 */
  to: SeatId | null;
  /** 選択のあとに残っている効果。 */
  rest: Effect[];
};

export type Pending = ReturnRoundPending | ChoicePending;

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
  /** 手番の向き（1 = 席番号の増える向き）。orderReversed から決まる値（orderReversed ? -1 : 1）。 */
  direction: 1 | -1;
  /** 9リバース中か。 */
  orderReversed: boolean;
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
  /** 激縛り。rank は「いま場のいちばん上の手の数字」。 */
  seqLock: { suits: Suit[]; rank: Rank } | null;
  /** 最初の1手に含める義務のあるカード（ダイヤの3）。なければ null。 */
  openingCard: CardId | null;
  pending: Pending | null;
  awaiting: Awaiting[];
  /** 1位が確定した瞬間の席ごとの手札枚数（特権枠の判定用。その1では記録だけ）。 */
  firstPlaceHandCounts: number[] | null;
  exchange: ExchangeState | null;
  /** そのゲームの最初の親。 */
  starter: SeatId;
  /** 特権（その3）。特権のないゲームでは null。 */
  abilities: AbilityState | null;
  /** 独裁で封じた数字。場が流れると null。 */
  ban: Rank | null;
  /** 透視で見たカード（対象の手札に残っている分だけ）。 */
  peek: { target: SeatId; cards: CardId[] } | null;
  /** 最後に革命（の切り替え）を起こした席。 */
  revolutionBy: SeatId | null;
  /** 席ごとの、終えた手番の数（カードを出すかパスした回数。CPU の判断に使う）。 */
  turnCount: number[];
};

export type AbilityState = {
  holder: SeatId;
  slots: number;
  /** 選んでいる途中の内容。 */
  draft: AbilityId[];
  /** 確定した内容。確定前は null。 */
  chosen: AbilityId[] | null;
  used: AbilityId[];
};

export type GameResult = {
  gameNo: number;
  places: Place[];
  deltas: number[];
};

export type MatchPhase = 'exchange' | 'ability' | 'play' | 'gameResult' | 'matchResult';

/** 待ちのあるフェーズか（design-3 §6.5）。 */
export function isAwaitPhase(phase: MatchPhase): boolean {
  return phase === 'exchange' || phase === 'ability' || phase === 'play';
}

export type MatchState = {
  version: 3;
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
  /** 次のゲームで特権を持つ席と枠の数（ゲームの終わりに決める）。 */
  abilityGrant: { seat: SeatId; slots: number } | null;
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
      /** 特権のスキップを付けて出す（その3）。 */
      withSkip?: boolean;
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
  /** 7渡し・10捨てで選ぶ。空の配列 = 渡さない・捨てない。 */
  | { type: 'choose'; seat: SeatId; awaitId: number; cards: CardId[] }
  /** 特権の選択（confirm: false は途中の保存。待ちは同じ番号のまま残る）。 */
  | { type: 'selectAbilities'; seat: SeatId; awaitId: number; abilities: AbilityId[]; confirm: boolean }
  /** 特権を使う（スキップ以外）。 */
  | { type: 'useAbility'; seat: SeatId; awaitId: number; ability: AbilityId; target?: SeatId; card?: CardId; rank?: Rank }
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
  | 'invalidChoice'
  | 'notUnlimited'
  | 'invalidAbility' // 持っていない、使用済み、選び方が正しくない
  | 'abilityNotUsable' // いまは使えない（場が空の強制流し、対象が正しくない、義務のカード など）
  | 'cannotSkip'; // その手にはスキップを付けられない

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
  /** スキップを付けられる手（本人が未使用のスキップを持つときだけ付く）。 */
  canSkip?: true;
};

// ---------- 出来事 ----------

type EventBase = { seq: number; gameNo: number };

/** 最初の親の決め方。diamond3 = ダイヤの3を持つ人（親は交換のあとに確定し、GameView.starter で伝える）。 */
export type LeaderRule = 'random' | 'prevLowest' | 'diamond3';

export type GameEventBody =
  | { type: 'gameStart'; leaderRule: LeaderRule }
  | { type: 'deal'; counts: number[]; hands: CardId[][] }
  | { type: 'exchangeStart'; pairs: { lower: SeatId; upper: SeatId; count: number }[] }
  | { type: 'exchange'; from: SeatId; to: SeatId; cards: CardId[] }
  | { type: 'exchangeDone' }
  | { type: 'play'; seat: SeatId; play: Play; foul: boolean }
  | { type: 'pass'; seat: SeatId }
  | { type: 'revolution'; active: boolean }
  | { type: 'tempReverse'; active: boolean }
  | { type: 'suitLock'; suits: Suit[] }
  | { type: 'returnRoundStart'; rule: RuleId; source: SeatId; participants: SeatId[] }
  /** toDiscard: 返したカードを場ではなく捨て札に置いた（4止め）。スペ3返しには付けない。 */
  | { type: 'respond'; seat: SeatId; play: Play; toDiscard?: true }
  | { type: 'respondSkip'; seat: SeatId }
  | { type: 'returnRoundEnd'; rule: RuleId; returnedBy: SeatId | null }
  | { type: 'fieldCleared'; reason: FlushReason; leader: SeatId }
  | { type: 'placed'; seat: SeatId; place: Place; reason: PlaceReason }
  | { type: 'dethrone'; seat: SeatId; discarded: CardId[] }
  /** 激縛りの成立（連番の更新では出さない）。 */
  | { type: 'seqLock'; suits: Suit[] }
  | { type: 'orderReverse'; active: boolean }
  | { type: 'choiceStart'; rule: RuleId; seat: SeatId; max: number; to: SeatId | null }
  /** 7渡し。中身は当事者だけ（eventsFor で落とす）。 */
  | { type: 'give'; from: SeatId; to: SeatId; cards: CardId[] }
  /** 10捨て。全員に見える。 */
  | { type: 'discard'; seat: SeatId; rule: RuleId; cards: CardId[] }
  /** 渡さない・捨てない。 */
  | { type: 'choiceSkip'; seat: SeatId; rule: RuleId }
  /** K スキップで飛ばされた席。 */
  | { type: 'skipped'; by: SeatId; seats: SeatId[] }
  /** 特権の選択の開始（その3）。 */
  | { type: 'abilitySelectStart'; seat: SeatId; slots: number }
  /** 特権の確定。abilities は本人だけ（eventsFor で落とす）。 */
  | { type: 'abilitiesChosen'; seat: SeatId; count: number; abilities: AbilityId[] }
  /** 特権の使用。cards（透視で見たカード）、given・taken（強奪で動いたカード）は本人と対象だけ。 */
  | {
      type: 'ability';
      seat: SeatId;
      ability: AbilityId;
      target?: SeatId;
      rank?: Rank;
      cards?: CardId[];
      given?: CardId;
      taken?: CardId;
    }
  | { type: 'gameEnd'; places: Place[]; deltas: number[]; scores: number[] }
  | { type: 'matchEnd'; standings: Standing[] };

export type GameEvent = EventBase & GameEventBody;

export type VisibleEventBody =
  | Exclude<GameEventBody, { type: 'deal' } | { type: 'exchange' } | { type: 'give' } | { type: 'abilitiesChosen' }>
  | { type: 'deal'; counts: number[]; hand: CardId[] }
  /** abilities は本人だけ。ほかの席には null。 */
  | { type: 'abilitiesChosen'; seat: SeatId; count: number; abilities: AbilityId[] | null }
  | { type: 'exchange'; from: SeatId; to: SeatId; count: number; cards: CardId[] | null }
  | { type: 'give'; from: SeatId; to: SeatId; count: number; cards: CardId[] | null };

export type VisibleEvent = EventBase & VisibleEventBody;

export type Standing = { seat: SeatId; score: number; rank: number };

// ---------- 席から見える状態 ----------

/** 手番で使える（使えるかもしれない）特権。選んで未使用のもの（スキップ以外）を ALL_ABILITY_IDS の順に並べる。 */
export type UsableAbility = {
  id: AbilityId;
  usable: boolean;
  /** 選べる相手（透視・強奪）。 */
  targets?: SeatId[];
  /** 渡せるカード（強奪）。 */
  cards?: CardId[];
  /** 封じられる数字（独裁）。 */
  ranks?: Rank[];
};

export type MyAwaiting =
  | {
      awaitId: number;
      kind: 'turn';
      leader: boolean;
      plays: LegalPlay[];
      canPass: boolean;
      /** 使える特権（本人が持ち主のときだけ中身がある）。 */
      abilities: UsableAbility[];
      /** 未使用のスキップを持っている。 */
      skipAvailable: boolean;
    }
  | { awaitId: number; kind: 'abilitySelect'; slots: number; draft: AbilityId[] }
  | { awaitId: number; kind: 'respond'; rule: RuleId; plays: LegalPlay[] }
  | {
      awaitId: number;
      kind: 'exchangeGive';
      role: 'lower' | 'upper';
      count: number;
      forced: CardId[];
      candidates: CardId[];
      choose: number;
    }
  | { awaitId: number; kind: 'choice'; rule: RuleId; max: number; to: SeatId | null };

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
  orderReversed: boolean;
  passed: boolean[];
  places: (Place | null)[];
  placeReasons: (PlaceReason | null)[];
  revolution: boolean;
  tempReverse: boolean;
  reversed: boolean;
  suitLock: Suit[] | null;
  seqLock: { suits: Suit[]; rank: Rank } | null;
  openingCard: CardId | null;
  /** 7渡し・10捨ての選択中。 */
  choice: { rule: RuleId; seat: SeatId; to: SeatId | null } | null;
  returnRound: { rule: RuleId; source: SeatId; asking: SeatId | null } | null;
  exchange: PublicExchangePair[] | null;
  /** 自分が渡した・受け取ったカード（交換）。 */
  myExchange: { gave: CardId[]; received: CardId[] } | null;
  starter: SeatId;
  /** 特権の持ち主と残りの個数（全員に見える。その3）。 */
  abilities: { holder: SeatId; slots: number; remaining: number; selecting: boolean } | null;
  /** 自分の特権（持ち主だけ）。 */
  myAbilities: { chosen: AbilityId[]; used: AbilityId[]; draft: AbilityId[] } | null;
  /** 独裁で封じられた数字（全員）。 */
  ban: Rank | null;
  /** 透視で見たカード（持ち主だけ。対象の手札に残っている分）。 */
  peek: { target: SeatId; cards: CardId[] } | null;
  /** 透視で見られた自分のカード（対象だけ。手札に残っている分）。 */
  peekedMine: CardId[] | null;
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
