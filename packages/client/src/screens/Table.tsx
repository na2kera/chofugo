// カード交換と対戦の画面（design-client §4.4〜§4.6、§7.1、§7.4〜§7.6）。見本の2枚目の画面のとおり。
// 上から：上の帯 / 相手3人 / 場 / メッセージ / 自分 / 手札 / ボタン。
// その3：特権の選択（matchPhase 'ability'）も同じ骨組みで、場の枠の位置に特権の一覧を出す（design-3 §4.2）。
// 対戦中は、自分の番で未使用の特権があるときだけ、メッセージの欄の下に特権のボタンを並べる（§4.3）。

import { useState } from 'react';
import type { AbilityId, CardId, LegalPlay, SeatId } from '@chofugo/engine';
import type { CardLook } from '../components/Card.tsx';
import { Field, type FieldMotion } from '../components/Field.tsx';
import { Hand } from '../components/Hand.tsx';
import { Opponent } from '../components/Opponent.tsx';
import { TimeBar } from '../components/TimeBar.tsx';
import { PLACE_TITLE, shapeChoiceLabel } from '../lib/cards.ts';
import { evaluateExchange, exchangePrompt, toggleExchange } from '../lib/exchange.ts';
import { choiceButtons, choiceCards, choicePrompt, toggleChoice } from '../lib/choice.ts';
import { opponentOrder, relativePos, seatName } from '../lib/seats.ts';
import {
  afterShapeChosen,
  DIM_REASON_TEXT,
  dimReason,
  evaluateSelection,
  initialRespondSelection,
  nextPlayStep,
  scopedValue,
  selectionKey,
  toggleCard,
  type PlayStep,
  type Scoped,
} from '../lib/selection.ts';
import { ARROW_GLYPHS } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import { Menu } from './Menu.tsx';
import { AbilityBar, AbilityPanelBox, AbilitySelectList, type UseArgs } from './Abilities.tsx';
import {
  abilityButtons,
  abilityPlate,
  playWithSkip,
  selectingLine,
  selectPrompt,
  toggleDraft,
  toggleStealCard,
  type AbilityPanel,
} from '../lib/abilities.ts';
import type { ScreenProps } from './types.ts';
import s from './Table.module.css';

const EMPTY: CardId[] = [];
const NO_STEP: PlayStep = { kind: 'none' };

type Props = ScreenProps & {
  /** 見本ページ用：最初の選択・手順・メニュー。 */
  initialSelected?: CardId[];
  initialStep?: PlayStep;
  initialMenu?: boolean;
  /** 見本ページ用：最初に開いている特権の選択の枠・強奪で選んだカード・スキップの ON。 */
  initialPanel?: AbilityPanel;
  initialStealCard?: CardId;
  initialSkipOn?: boolean;
};

export function Table({ state, snap, api, fixedNow, initialSelected, initialStep, initialMenu, initialPanel, initialStealCard, initialSkipOn }: Props) {
  const view = state.view!;
  const game = view.game!;
  const me = view.seat;
  const mine = view.mine;
  const phase = view.phase;
  const key = selectionKey(state.matchId, view.gameNo, mine?.awaitId ?? null);
  // 返しの一周で返せる組み合わせが1つだけなら、はじめから選んだ状態にする（design-2 §4.3）
  const defaultSel = mine !== null && mine.kind === 'respond' ? initialRespondSelection(mine) : EMPTY;
  const [sel, setSel] = useState<Scoped<CardId[]>>({ key, value: initialSelected ?? defaultSel });
  const [stepS, setStepS] = useState<Scoped<PlayStep>>({ key, value: initialStep ?? NO_STEP });
  const [receivedCleared, setReceivedCleared] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(initialMenu ?? false);
  // 特権の選択の枠・強奪で選んだカード・スキップの ON/OFF も、試合・ゲーム・待ちの番号に結び付ける（design-3 §6.1）。
  // 特権を使うと待ちの番号が変わるので、すべて捨てられる
  const [panelS, setPanelS] = useState<Scoped<AbilityPanel | null>>({ key, value: initialPanel ?? null });
  const [stealS, setStealS] = useState<Scoped<CardId | null>>({ key, value: initialStealCard ?? null });
  const [skipS, setSkipS] = useState<Scoped<boolean>>({ key, value: initialSkipOn ?? false });
  /** 最後に出した「出せない理由」（ダイヤの3の案内より優先して見せるため）。 */
  const [dimLine, setDimLine] = useState<string | null>(null);
  const selected = scopedValue(sel, key, defaultSel);
  const step = scopedValue(stepS, key, NO_STEP);
  const panel = mine !== null && mine.kind === 'turn' ? scopedValue(panelS, key, null) : null;
  const stealCard = panel === 'steal' ? scopedValue(stealS, key, null) : null;
  const skipOn = mine !== null && mine.kind === 'turn' && mine.skipAvailable ? scopedValue(skipS, key, false) : false;
  const peekedMine = new Set(game.peekedMine ?? []);
  const canAct = snap.ready && snap.pending === null && !state.room.paused;
  const names = (seat: SeatId) => seatName(state.room.seats, seat);
  const deadlineOf = (seat: SeatId) => state.deadlines.find((d) => d.seat === seat) ?? null;
  const gameKey = `${state.matchId}:${view.gameNo}`;

  // ---------- 手札の見え方 ----------
  const hand = game.hand;
  const received = new Set(receivedCleared === gameKey ? [] : (game.myExchange?.received ?? []));
  // 7渡しで受け取ったカード（design-2 §6.3）。見た目は交換で受け取ったカードと同じ
  const gift = snap.gift;
  if (gift !== null && gift.matchId === state.matchId && gift.gameNo === view.gameNo) for (const c of gift.cards) received.add(c);
  let lookOf: (id: CardId) => CardLook = () => 'normal';
  let onPress: ((id: CardId) => void) | undefined;
  let exchangeReady = false;
  let exchangeCards: CardId[] = [];
  let plays: LegalPlay[] = [];
  let matches: LegalPlay[] = [];

  if (mine !== null && mine.kind === 'exchangeGive') {
    const ev = evaluateExchange(mine, hand, selected);
    exchangeReady = ev.ready;
    exchangeCards = ev.cards;
    lookOf = (id) => (ev.shown.includes(id) ? 'sel' : ev.selectable.has(id) ? 'normal' : 'dim');
    onPress = (id) => {
      const next = toggleExchange(mine, hand, selected, id);
      if (next !== null) setSel({ key, value: next });
    };
  } else if (mine !== null && mine.kind === 'choice') {
    // 7渡し・10捨て：手札のどのカードも、上限まで選べる（design-2 §4.2）
    lookOf = (id) => (selected.includes(id) ? 'sel' : 'normal');
    onPress = (id) => {
      const next = toggleChoice(mine, hand, selected, id);
      if (next !== null) setSel({ key, value: next });
    };
  } else if (mine !== null && mine.kind === 'turn' && panel === 'steal') {
    // 強奪の枠を開いている間は、渡せるカードから1枚だけ選ぶ（出せる手の一覧は使わない、design-3 §6.3）
    const cards = mine.abilities.find((u) => u.id === 'steal')?.cards ?? [];
    lookOf = (id) => (id === stealCard ? 'sel' : cards.includes(id) ? 'normal' : 'dim');
    onPress = (id) => {
      const next = toggleStealCard(cards, stealCard, id);
      if (next !== undefined) setStealS({ key, value: next });
    };
  } else if (mine !== null && (mine.kind === 'turn' || mine.kind === 'respond')) {
    plays = mine.plays;
    const ev = evaluateSelection(hand, plays, selected);
    matches = ev.matches;
    lookOf = (id) => (selected.includes(id) ? 'sel' : ev.selectable.has(id) ? 'normal' : 'dim');
    onPress = (id) => {
      if (step.kind !== 'none') setStepS({ key, value: NO_STEP });
      const next = toggleCard(hand, plays, selected, id);
      if (next === null) {
        const text = DIM_REASON_TEXT[dimReason(mine, plays, selected, id, game.suitLock, { seqLock: game.seqLock, openingCard: game.openingCard, ban: game.ban })];
        setDimLine(text);
        api.showLine(text);
        return;
      }
      setSel({ key, value: next });
    };
  } else if (phase === 'play') {
    onPress = () => api.showLine(DIM_REASON_TEXT.notYourTurn);
  }

  // ---------- 送信 ----------
  const markActed = () => {
    if (phase === 'play') setReceivedCleared(gameKey);
  };
  const sendPlay = (p: LegalPlay) => {
    if (mine === null || mine.kind !== 'turn') return;
    // スキップを ON にしていて、その手に付けられないときは送らない（design-3 §4.3。形を選んだあとの手で判定する）
    const sk = playWithSkip(p, skipOn);
    if (!sk.ok) {
      api.showLine(sk.line);
      setStepS({ key, value: NO_STEP });
      return;
    }
    const ok = api.sendAction(
      { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape, ...(p.foul ? { confirmFoul: true } : {}), ...(sk.withSkip ? { withSkip: true } : {}) },
      'play',
    );
    if (ok) {
      markActed();
      setStepS({ key, value: NO_STEP });
    }
  };
  const runStep = (st: PlayStep) => {
    if (st.kind === 'send') sendPlay(st.play);
    else setStepS({ key, value: st });
  };
  const onPlay = () => runStep(nextPlayStep(matches));
  const onPass = () => {
    if (mine === null || mine.kind !== 'turn') return;
    if (api.sendAction({ type: 'pass', awaitId: mine.awaitId }, 'pass')) {
      markActed();
      setSel({ key, value: EMPTY });
    }
  };
  const onRespond = (skip: boolean) => {
    if (mine === null || mine.kind !== 'respond') return;
    let cards: CardId[] | null = null;
    if (!skip) {
      const p = matches[0] ?? (mine.plays.length === 1 ? mine.plays[0] : undefined);
      if (p === undefined) return;
      cards = p.cards;
    }
    if (api.sendAction({ type: 'respond', awaitId: mine.awaitId, cards }, skip ? 'skip' : 'respond')) markActed();
  };
  const onChoose = (skip: boolean) => {
    if (mine === null || mine.kind !== 'choice') return;
    const cards = skip ? [] : choiceCards(mine, hand, selected);
    if (!skip && cards.length === 0) return;
    if (api.sendAction({ type: 'choose', awaitId: mine.awaitId, cards }, skip ? 'chooseSkip' : 'choose')) markActed();
  };
  // ---------- 特権 ----------
  const onDraft = (id: AbilityId) => {
    if (mine === null || mine.kind !== 'abilitySelect') return;
    const next = toggleDraft(mine, id);
    if (next === null) return;
    // 画面の側では選択を変えない。返事（保存された draft）が届くまで押せない（design-3 §6.2）
    api.sendAction({ type: 'selectAbilities', awaitId: mine.awaitId, abilities: next, confirm: false }, 'abilityDraft');
  };
  const onConfirmAbilities = () => {
    if (mine === null || mine.kind !== 'abilitySelect') return;
    api.sendAction({ type: 'selectAbilities', awaitId: mine.awaitId, abilities: mine.draft, confirm: true }, 'abilityConfirm');
  };
  const onAbilityButton = (id: AbilityId) => {
    if (mine === null || mine.kind !== 'turn') return;
    if (id === 'skip') {
      setSkipS({ key, value: !skipOn });
      return;
    }
    setStealS({ key, value: null });
    const next = panel === id ? null : id;
    setPanelS({ key, value: next });
    if (step.kind !== 'none') setStepS({ key, value: NO_STEP });
    // 強奪の枠を開くときと閉じるときは、ふつうの選択を空にする（design-3 §6.3）
    if (next === 'steal' || panel === 'steal') setSel({ key, value: EMPTY });
  };
  const closePanel = () => {
    if (panel === 'steal') setSel({ key, value: EMPTY });
    setPanelS({ key, value: null });
    setStealS({ key, value: null });
  };
  const onUse = (a: UseArgs) => {
    if (mine === null || mine.kind !== 'turn') return;
    const card = a.ability === 'steal' ? stealCard : null;
    if (a.ability === 'steal' && card === null) return;
    api.sendAction(
      {
        type: 'useAbility',
        awaitId: mine.awaitId,
        ability: a.ability,
        ...(a.target !== undefined ? { target: a.target } : {}),
        ...(a.rank !== undefined ? { rank: a.rank } : {}),
        ...(card !== null ? { card } : {}),
      },
      'ability',
    );
  };

  const onGive = () => {
    if (mine === null || mine.kind !== 'exchangeGive') return;
    api.sendAction({ type: 'exchangeGive', awaitId: mine.awaitId, cards: exchangeCards }, 'give');
  };

  // ---------- 場と演出 ----------
  const top = game.field[game.field.length - 1] ?? null;
  let fieldPlay = top?.play ?? null;
  let motion: FieldMotion = null;
  let motionKey: string | undefined;
  const anim = snap.anim;
  if (anim !== null && (anim.kind === 'play' || anim.kind === 'sweep')) {
    fieldPlay = anim.play;
    motionKey = `a${anim.seq}`;
    if (anim.kind === 'sweep') motion = { kind: 'out' };
    else {
      const pos = relativePos(me, anim.seat);
      motion = { kind: 'in', from: pos === null ? 'me' : pos };
    }
  }
  const owner = anim !== null && anim.kind === 'play' ? anim.seat : top?.seat ?? null;
  const flashOf = (seat: SeatId): 'gold' | 'red' | null =>
    anim !== null && anim.kind === 'placed' && anim.seat === seat ? (anim.red ? 'red' : 'gold') : null;

  // ---------- メッセージの欄 ----------
  let line = snap.line;
  const rr = game.returnRound;
  if (snap.notice !== null) {
    // 拒否の理由・ホストの交代は、交換や返しの一周の案内より一時的に優先する（§7.13）
    line = snap.notice;
  } else if (phase === 'exchange') {
    line = mine !== null && mine.kind === 'exchangeGive' ? exchangePrompt(mine) : '交換中…';
  } else if (phase === 'ability') {
    // 特権の選択（design-3 §4.2）：選ぶ人には個数、ほかの人には誰が何個選んでいるか
    const ab = game.abilities;
    if (mine !== null && mine.kind === 'abilitySelect') line = selectPrompt(mine.slots);
    else if (ab !== null) line = selectingLine(names(ab.holder), ab.slots);
  } else if (mine !== null && mine.kind === 'respond') {
    line = mine.rule === 'block_flush_with_4' ? '4を2枚出して 8切りを止めますか？' : 'スペードの3で返しますか？';
  } else if (rr !== null && rr.asking !== null && rr.asking !== me) {
    line = `${names(rr.asking)} が考えています`;
  } else if (mine !== null && mine.kind === 'choice') {
    line = choicePrompt(mine);
  } else if (game.choice !== null && game.choice.seat !== me) {
    line = `${names(game.choice.seat)} が選んでいます`;
  } else if (mine !== null && mine.kind === 'turn' && game.openingCard !== null && !(dimLine !== null && snap.line === dimLine)) {
    // ダイヤの3の義務：最初の親にだけ出す（design-2 §4.4）。出せない理由を押して出したときは、そちらを残す
    line = '最初の1手には ダイヤの3を含めます';
  }

  // ---------- 自分 ----------
  const myRank = view.prevRanks?.[me] ?? null;
  const myPlace = game.places[me] ?? null;
  const myDeadline = deadlineOf(me);
  const myTurn = mine !== null && (mine.kind === 'turn' || mine.kind === 'respond' || mine.kind === 'choice' || mine.kind === 'abilitySelect');
  const myAbilityPlate = game.abilities !== null && game.abilities.holder === me ? abilityPlate(game.abilities.remaining) : null;
  const buttons = abilityButtons(mine);
  // 7渡しの相手（選ぶ人にだけ、相手の枠を手番と同じ明るい枠にする。design-2 §4.2）
  const giveTo = mine !== null && mine.kind === 'choice' ? mine.to : null;
  const busy = (what: string) => snap.pending !== null && snap.pending.what === what;

  // ---------- ボタン ----------
  let actions: React.ReactNode = null;
  if (mine !== null && mine.kind === 'abilitySelect') {
    actions = (
      <div className={s.actions1}>
        <button type="button" className="f btn" disabled={!canAct} onClick={onConfirmAbilities}>
          決定
        </button>
      </div>
    );
  } else if (mine !== null && mine.kind === 'exchangeGive') {
    actions = (
      <div className={s.actions1}>
        <button type="button" className="f btn" disabled={!canAct || !exchangeReady || busy('give')} onClick={onGive}>
          渡す
        </button>
      </div>
    );
  } else if (mine !== null && mine.kind === 'choice') {
    const picked = choiceCards(mine, hand, selected);
    const label = choiceButtons(mine, picked.length);
    actions = (
      <div className={s.actions}>
        <button type="button" className="f btn2" disabled={!canAct} onClick={() => onChoose(true)}>
          {label.skip}
        </button>
        <button type="button" className="f btn" disabled={!canAct || picked.length === 0} onClick={() => onChoose(false)}>
          {label.send}
        </button>
      </div>
    );
  } else if (mine !== null && mine.kind === 'respond') {
    const canReturn = matches.length > 0 || mine.plays.length === 1;
    actions = (
      <div className={s.actions}>
        <button type="button" className="f btn2" disabled={!canAct} onClick={() => onRespond(true)}>
          スキップ
        </button>
        <button type="button" className="f btn" disabled={!canAct || !canReturn} onClick={() => onRespond(false)}>
          返す
        </button>
      </div>
    );
  } else if (mine !== null && mine.kind === 'turn') {
    if (step.kind === 'chooseShape') {
      actions = (
        <div className={s.choice}>
          {step.options.map((p) => (
            <button key={p.shape} type="button" className="f btn" disabled={!canAct} onClick={() => runStep(afterShapeChosen(p))}>
              {shapeChoiceLabel(p.play)}として出す
            </button>
          ))}
          <button type="button" className="f btn2" onClick={() => setStepS({ key, value: NO_STEP })}>
            やめる
          </button>
        </div>
      );
    } else if (step.kind === 'confirmFoul') {
      actions = (
        <div className={s.choice}>
          <p className={`f red redt ${s.confirm}`}>これで上がると反則上がりになります。出しますか？</p>
          <div className={s.actions0}>
            <button type="button" className="f btn2" onClick={() => setStepS({ key, value: NO_STEP })}>
              やめる
            </button>
            <button type="button" className="f btn" disabled={!canAct} onClick={() => sendPlay(step.play)}>
              出す
            </button>
          </div>
        </div>
      );
    } else {
      actions = (
        <div className={s.actions}>
          <button type="button" className="f btn2" disabled={!canAct || !mine.canPass} onClick={onPass}>
            パス
          </button>
          <button type="button" className="f btn" disabled={!canAct || matches.length === 0} onClick={onPlay}>
            {selected.length > 0 ? `${selected.length}枚を出す` : '出す'}
          </button>
        </div>
      );
    }
  }

  const title = view.gameCount === null ? `第${view.gameNo}ゲーム` : `第${view.gameNo}ゲーム/${view.gameCount}`;
  // 特権の選択（選ぶ人）だけ、「決定」を画面の下に固定し、その上を縦にスクロールさせる（ロビーの「ゲームを始める」と同じ作り）。
  // ほかの画面では包みの div を display: contents にして、配置を変えない
  const pinActions = mine !== null && mine.kind === 'abilitySelect';

  return (
    <div className={`${s.table} ${pinActions ? s.tablePinned : ''}`}>
      <div className={pinActions ? s.scroll : s.flow}>
      <div className={s.topbar}>
        <span className="mut">{title}</span>
        <button type="button" className={s.menuBtn} aria-label="メニュー" onClick={() => setMenuOpen(true)}>
          ≡
        </button>
      </div>

      <div className={s.opps}>
        {opponentOrder(me).map((seat) => {
          const info = state.room.seats.find((x) => x.seat === seat);
          const reason = game.placeReasons[seat] ?? null;
          return (
            <Opponent
              key={seat}
              name={names(seat)}
              rank={view.prevRanks?.[seat] ?? null}
              count={game.handCounts[seat] ?? null}
              place={game.places[seat] ?? null}
              placeRed={reason === 'foul' || reason === 'dethrone'}
              active={view.awaiting.some((a) => a.seat === seat)}
              target={giveTo === seat}
              passed={phase === 'play' && (game.passed[seat] ?? false)}
              away={info?.away ?? false}
              owner={owner === seat}
              deadline={deadlineOf(seat)}
              offset={snap.offset}
              flash={flashOf(seat)}
              abilityLeft={game.abilities !== null && game.abilities.holder === seat ? game.abilities.remaining : null}
              peek={game.peek !== null && game.peek.target === seat ? game.peek.cards : null}
              {...(fixedNow !== undefined ? { fixedNow } : {})}
            />
          );
        })}
      </div>

      {mine !== null && mine.kind === 'abilitySelect' ? (
        <AbilitySelectList mine={mine} disabled={!canAct} onToggle={onDraft} />
      ) : mine !== null && mine.kind === 'turn' && panel !== null ? (
        <AbilityPanelBox panel={panel} mine={mine} nameOf={names} stealCard={stealCard} disabled={!canAct} onUse={onUse} onClose={closePanel} />
      ) : (
      <Field
        play={fieldPlay}
        revolution={game.revolution}
        tempReverse={game.tempReverse}
        reversed={game.reversed}
        suitLock={game.suitLock}
        seqLock={game.seqLock}
        orderReversed={game.orderReversed}
        ban={game.ban}
        motion={motion}
        {...(motionKey !== undefined ? { motionKey } : {})}
      />
      )}

      <div className={`f win ${s.msg}`} role="status" aria-live="polite">
        <span className={s.msgText}>{line ?? ''}</span>
      </div>

      <AbilityBar buttons={buttons} open={panel} skipOn={skipOn} disabled={!canAct} onPress={onAbilityButton} />

      <div className={`${s.me} ${flashOf(me) !== null ? s.meFlash : ''}`}>
        {myRank !== null && <span className={myRank === 1 ? 'f plate' : 'f plate2'}>{PLACE_TITLE[myRank]}</span>}
        {myAbilityPlate !== null && <span className="f plate">{myAbilityPlate}</span>}
        {myPlace !== null && <span className={`f ${game.placeReasons[me] === 'foul' || game.placeReasons[me] === 'dethrone' ? 'red redt' : 'plate'}`}>{myPlace}位</span>}
        {myTurn && <span className="hi">あなたの番</span>}
        <span className={s.sp} />
        {owner === me && (
          <span className={s.mine} aria-label="場の手はあなたが出した">
            <Pixel rows={ARROW_GLYPHS.down} unit={2} />
          </span>
        )}
      </div>
      <div className={s.bar}>
        {myDeadline !== null && <TimeBar deadline={myDeadline} offset={snap.offset} mine {...(fixedNow !== undefined ? { fixedNow } : {})} />}
      </div>

      <Hand cards={hand} lookOf={lookOf} receivedOf={(id) => received.has(id)} peekedOf={(id) => peekedMine.has(id)} {...(onPress ? { onPress } : {})} />
      </div>

      <div className={s.actionArea}>{actions}</div>

      {anim !== null && anim.kind === 'revolution' && (
        <div className={s.revo} aria-hidden="true">
          <span>革命</span>
        </div>
      )}
      {menuOpen && <Menu state={state} feed={snap.feed} onClose={() => setMenuOpen(false)} onLeave={api.goHome} />}
    </div>
  );
}
