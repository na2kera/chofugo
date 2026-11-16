// カード交換と対戦の画面（design-client §4.4〜§4.6、§7.1、§7.4〜§7.6）。見本の2枚目の画面のとおり。
// 上から：上の帯 / 相手3人 / 場 / メッセージ / 自分 / 手札 / ボタン。

import { useState } from 'react';
import type { CardId, LegalPlay, SeatId } from '@chofugo/engine';
import type { CardLook } from '../components/Card.tsx';
import { Field, type FieldMotion } from '../components/Field.tsx';
import { Hand } from '../components/Hand.tsx';
import { Opponent } from '../components/Opponent.tsx';
import { TimeBar } from '../components/TimeBar.tsx';
import { PLACE_TITLE, shapeChoiceLabel } from '../lib/cards.ts';
import { evaluateExchange, exchangePrompt, toggleExchange } from '../lib/exchange.ts';
import { opponentOrder, relativePos, seatName } from '../lib/seats.ts';
import {
  afterShapeChosen,
  DIM_REASON_TEXT,
  dimReason,
  evaluateSelection,
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
import type { ScreenProps } from './types.ts';
import s from './Table.module.css';

const EMPTY: CardId[] = [];
const NO_STEP: PlayStep = { kind: 'none' };

type Props = ScreenProps & {
  /** 見本ページ用：最初の選択・手順・メニュー。 */
  initialSelected?: CardId[];
  initialStep?: PlayStep;
  initialMenu?: boolean;
};

export function Table({ state, snap, api, fixedNow, initialSelected, initialStep, initialMenu }: Props) {
  const view = state.view!;
  const game = view.game!;
  const me = view.seat;
  const mine = view.mine;
  const phase = view.phase;
  const key = selectionKey(state.matchId, view.gameNo, mine?.awaitId ?? null);
  const [sel, setSel] = useState<Scoped<CardId[]>>({ key, value: initialSelected ?? EMPTY });
  const [stepS, setStepS] = useState<Scoped<PlayStep>>({ key, value: initialStep ?? NO_STEP });
  const [receivedCleared, setReceivedCleared] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(initialMenu ?? false);
  const selected = scopedValue(sel, key, EMPTY);
  const step = scopedValue(stepS, key, NO_STEP);
  const canAct = snap.ready && snap.pending === null && !state.room.paused;
  const names = (seat: SeatId) => seatName(state.room.seats, seat);
  const deadlineOf = (seat: SeatId) => state.deadlines.find((d) => d.seat === seat) ?? null;
  const gameKey = `${state.matchId}:${view.gameNo}`;

  // ---------- 手札の見え方 ----------
  const hand = game.hand;
  const received = new Set(receivedCleared === gameKey ? [] : (game.myExchange?.received ?? []));
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
  } else if (mine !== null && (mine.kind === 'turn' || mine.kind === 'respond')) {
    plays = mine.plays;
    const ev = evaluateSelection(hand, plays, selected);
    matches = ev.matches;
    lookOf = (id) => (selected.includes(id) ? 'sel' : ev.selectable.has(id) ? 'normal' : 'dim');
    onPress = (id) => {
      if (step.kind !== 'none') setStepS({ key, value: NO_STEP });
      const next = toggleCard(hand, plays, selected, id);
      if (next === null) {
        api.showLine(DIM_REASON_TEXT[dimReason(mine, plays, selected, id, game.suitLock)]);
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
    const ok = api.sendAction(
      { type: 'play', awaitId: mine.awaitId, cards: p.cards, shape: p.shape, ...(p.foul ? { confirmFoul: true } : {}) },
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
  if (phase === 'exchange') {
    line = mine !== null && mine.kind === 'exchangeGive' ? exchangePrompt(mine) : '交換中…';
  } else if (mine !== null && mine.kind === 'respond') {
    line = 'スペードの3で返しますか？';
  } else if (rr !== null && rr.asking !== null && rr.asking !== me) {
    line = `${names(rr.asking)} が考えています`;
  }

  // ---------- 自分 ----------
  const myRank = view.prevRanks?.[me] ?? null;
  const myPlace = game.places[me] ?? null;
  const myDeadline = deadlineOf(me);
  const myTurn = mine !== null && (mine.kind === 'turn' || mine.kind === 'respond');
  const busy = (what: string) => snap.pending !== null && snap.pending.what === what;

  // ---------- ボタン ----------
  let actions: React.ReactNode = null;
  if (mine !== null && mine.kind === 'exchangeGive') {
    actions = (
      <div className={s.actions1}>
        <button type="button" className="f btn" disabled={!canAct || !exchangeReady || busy('give')} onClick={onGive}>
          渡す
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

  return (
    <div className={s.table}>
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
              passed={phase === 'play' && (game.passed[seat] ?? false)}
              away={info?.away ?? false}
              owner={owner === seat}
              deadline={deadlineOf(seat)}
              offset={snap.offset}
              flash={flashOf(seat)}
              {...(fixedNow !== undefined ? { fixedNow } : {})}
            />
          );
        })}
      </div>

      <Field
        play={fieldPlay}
        revolution={game.revolution}
        tempReverse={game.tempReverse}
        reversed={game.reversed}
        suitLock={game.suitLock}
        motion={motion}
        {...(motionKey !== undefined ? { motionKey } : {})}
      />

      <div className={`f win ${s.msg}`} role="status" aria-live="polite">
        <span className={s.msgText}>{line ?? ''}</span>
      </div>

      <div className={`${s.me} ${flashOf(me) !== null ? s.meFlash : ''}`}>
        {myRank !== null && <span className={myRank === 1 ? 'f plate' : 'f plate2'}>{PLACE_TITLE[myRank]}</span>}
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

      <Hand cards={hand} lookOf={lookOf} receivedOf={(id) => received.has(id)} {...(onPress ? { onPress } : {})} />

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
