// メニュー（≡）の中（design-client §4.5、§7.8、§7.10）。
// 得点の一覧、この試合のルール、このゲームで出たカード、招待リンク、ルームを出る。開いた項目だけを出す。

import { useState } from 'react';
import type { CardId } from '@chofugo/engine';
import type { StateMessage } from '@chofugo/server/protocol';
import { faceOf, isRedSuit } from '../lib/cards.ts';
import type { Feed } from '../lib/events.ts';
import { seatName } from '../lib/seats.ts';
import { SUIT_GLYPHS_SMALL } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import { ruleName } from '../rules-text.ts';
import { InviteLink } from './InviteLink.tsx';
import s from './Menu.module.css';

type Section = 'top' | 'scores' | 'rules' | 'history' | 'invite';

type Props = {
  state: StateMessage;
  feed: Feed;
  onClose: () => void;
  onLeave: () => void;
  initial?: Section;
};

function MiniCard({ id }: { id: CardId }) {
  const f = faceOf(id);
  if (f === null) return null;
  if (f.kind === 'joker') return <span className={s.joker}>JK</span>;
  return (
    <span className={`${s.mini} ${isRedSuit(f.suit) ? s.redMini : ''}`}>
      <Pixel rows={SUIT_GLYPHS_SMALL[f.suit]} unit={2} />
      {f.key}
    </span>
  );
}

export function Menu({ state, feed, onClose, onLeave, initial = 'top' }: Props) {
  const [sec, setSec] = useState<Section>(initial);
  const view = state.view;
  const me = state.seat;
  const titles: Record<Section, string> = { top: 'メニュー', scores: '得点', rules: 'この試合のルール', history: 'このゲームで出たカード', invite: '招待リンク' };
  const history = view !== null && feed.gameNo === view.gameNo ? feed.history : [];
  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={titles[sec]}>
      <div className={`f win ${s.panel}`}>
        <div className={s.head}>
          <h2 className={s.h}>{titles[sec]}</h2>
          <button type="button" className={s.close} onClick={sec === 'top' ? onClose : () => setSec('top')}>
            {sec === 'top' ? '閉じる' : '戻る'}
          </button>
        </div>

        {sec === 'top' && (
          <div className={s.list}>
            <button type="button" className="f btn2" onClick={() => setSec('scores')}>得点</button>
            <button type="button" className="f btn2" onClick={() => setSec('rules')}>この試合のルール</button>
            <button type="button" className="f btn2" onClick={() => setSec('history')}>このゲームで出たカード</button>
            <button type="button" className="f btn2" onClick={() => setSec('invite')}>招待リンク</button>
            <div className={s.grow} />
            <button type="button" className="f btn2" onClick={onLeave}>ルームを出る</button>
          </div>
        )}

        {sec === 'scores' && view !== null && (
          <ul className={s.rows}>
            {state.room.seats.map((x) => (
              <li key={x.seat} className={s.row}>
                <span className={s.fullName}>{seatName(state.room.seats, x.seat)}{x.seat === me ? '（あなた）' : ''}</span>
                <span className="hi">{fmt(view.scores[x.seat] ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}

        {sec === 'rules' && (
          // カスタムモードでは16種まで並ぶので、入りきらなければ縦にスクロールする
          <ul className={`${s.rows} ${s.scroll}`}>
            {state.room.config.rules.map((r) => (
              <li key={r} className={s.row}>{ruleName(r)}</li>
            ))}
            {state.room.config.rules.length === 0 && <li className={`${s.row} mut`}>なし</li>}
          </ul>
        )}

        {sec === 'history' && (
          <ol className={`${s.rows} ${s.scroll}`}>
            {history.length === 0 && <li className={`${s.row} mut`}>まだない</li>}
            {history.map((h) => (
              <li key={h.seq} className={s.hrow}>
                <span className={s.hname}>{seatName(state.room.seats, h.seat, me)}</span>
                <span className={s.hcards}>
                  {h.cards.map((c) => (
                    <MiniCard key={c} id={c} />
                  ))}
                  {/* 10捨てで捨てたカードには「10捨て」と添える（design-2 §4.5） */}
                  {h.via === 'discard' && <span className="mut">10捨て</span>}
                </span>
              </li>
            ))}
          </ol>
        )}

        {sec === 'invite' && <InviteLink roomId={state.room.roomId} />}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
