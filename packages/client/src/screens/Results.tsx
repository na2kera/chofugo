// ゲームの結果・試合の結果（design-client §4.7、§7.3、§7.10）。

import type { SeatId } from '@chofugo/engine';
import { PLACE_TITLE } from '../lib/cards.ts';
import { seatName } from '../lib/seats.ts';
import { CROWN_GLYPH } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import type { ScreenProps } from './types.ts';
import s from './Results.module.css';

function fmt(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function HostWait({ state }: { state: ScreenProps['state'] }) {
  const h = state.room.host;
  return <p className={s.wait}>{h === null ? 'ホストを待っています' : `${seatName(state.room.seats, h)}（ホスト）を待っています`}</p>;
}

/** ゲームの結果。finalGame のときは「試合の結果へ」を全員に出す（自分の画面だけを切り替える）。 */
export function GameResult({ state, snap, api, finalGame }: ScreenProps & { finalGame: boolean }) {
  const view = state.view!;
  const last = view.results[view.results.length - 1];
  const reasons = view.game?.placeReasons ?? [];
  const canAct = snap.ready && snap.pending === null;
  if (last === undefined) return null;
  const order = ([0, 1, 2, 3] as SeatId[]).slice().sort((a, b) => (last.places[a] ?? 0) - (last.places[b] ?? 0));
  const dethroned = order.find((x) => reasons[x] === 'dethrone');
  const name = (x: SeatId) => seatName(state.room.seats, x);
  return (
    <div className={s.result}>
      <h2 className={s.title}>結果</h2>
      {dethroned !== undefined && (
        <p className={`f red redt ${s.fall}`}>
          都落ち！ {name(dethroned)} は {PLACE_TITLE[last.places[dethroned]!]}へ
        </p>
      )}
      <ol className={s.list}>
        {order.map((x) => {
          const place = last.places[x]!;
          const delta = last.deltas[x] ?? 0;
          const first = place === 1;
          return (
            <li key={x} className={`f ${first ? 'hot' : 'dim'} ${s.rank}`}>
              <span className={s.no}>{place}</span>
              <span className={`${s.who} ${first ? 'hi' : ''}`}>
                {first && <Pixel rows={CROWN_GLYPH} unit={2} />}
                <span className={s.nm}>{name(x)}</span>
                {reasons[x] === 'foul' && <span className={`f red redt ${s.tag}`}>反則</span>}
              </span>
              <span className={`${s.delta} ${delta >= 0 ? 'hi' : 'redt'}`}>{fmt(delta)}</span>
              <span className={s.total}>計 {fmt(view.scores[x] ?? 0)}</span>
            </li>
          );
        })}
      </ol>
      <div className={s.grow} />
      {snap.notice !== null && (
        <p className={s.notice} role="status">
          {snap.notice}
        </p>
      )}
      {finalGame ? (
        <button type="button" className="f btn" onClick={() => api.showMatchResult(state.matchId!)}>
          試合の結果へ
        </button>
      ) : state.isHost ? (
        <div className={s.buttons}>
          {view.gameCount === null && (
            <button type="button" className="f btn2" disabled={!canAct} onClick={() => api.send({ type: 'endMatch', matchId: state.matchId! }, 'end')}>
              試合を終える
            </button>
          )}
          <button type="button" className="f btn" disabled={!canAct} onClick={() => api.send({ type: 'nextGame', matchId: state.matchId! }, 'next')}>
            次のゲームへ
          </button>
        </div>
      ) : (
        <HostWait state={state} />
      )}
    </div>
  );
}

/** 試合の結果。 */
export function MatchResult({ state, snap, api }: ScreenProps) {
  const view = state.view!;
  const standings = view.standings ?? [];
  const canAct = snap.ready && snap.pending === null;
  return (
    <div className={s.result}>
      <h2 className={s.title}>総合</h2>
      <ol className={s.list}>
        {standings.map((st) => {
          const first = st.rank === 1;
          return (
            <li key={st.seat} className={`f ${first ? 'hot' : 'dim'} ${s.rank2}`}>
              <span className={s.no}>{st.rank}</span>
              <span className={`${s.who} ${first ? 'hi' : ''}`}>
                {first && <Pixel rows={CROWN_GLYPH} unit={2} />}
                <span className={s.nm}>{seatName(state.room.seats, st.seat)}</span>
              </span>
              <span className={`${s.delta} ${st.score >= 0 ? 'hi' : 'redt'}`}>{fmt(st.score)}</span>
            </li>
          );
        })}
      </ol>
      <div className={s.grow} />
      {snap.notice !== null && (
        <p className={s.notice} role="status">
          {snap.notice}
        </p>
      )}
      <div className={s.buttons}>
        {state.isHost && (
          <button type="button" className="f btn" disabled={!canAct} onClick={() => api.send({ type: 'rematch', matchId: state.matchId! }, 'rematch')}>
            同じメンバーでもう一度
          </button>
        )}
        {!state.isHost && <HostWait state={state} />}
        <button type="button" className="f btn2" onClick={api.goHome}>
          ホームへ戻る
        </button>
      </div>
    </div>
  );
}
