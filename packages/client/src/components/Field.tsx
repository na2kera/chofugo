// 場（design-client §4.5、§7.4、§7.5）。いちばん上に出ている手のカードと、発動中の状態の札だけ。
// 強さが逆のとき（game.reversed）は枠を赤にする。ジョーカーには何の代わりかを小さく添える。

import type { Play, SeatId, Suit } from '@chofugo/engine';
import { jokerStandIn, isRedSuit } from '../lib/cards.ts';
import { fieldLayout, ROW_STEP } from '../lib/layout.ts';
import { SUIT_GLYPHS_SMALL } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import { Card } from './Card.tsx';
import { useWidth } from './hooks.ts';
import s from './Field.module.css';

export type FieldMotion = { kind: 'in'; from: 0 | 1 | 2 | 'me' } | { kind: 'out' } | null;

type Props = {
  play: Play | null;
  revolution: boolean;
  tempReverse: boolean;
  reversed: boolean;
  suitLock: Suit[] | null;
  motion: FieldMotion;
  /** 演出の識別（同じ手でも演出をやり直すため）。 */
  motionKey?: string;
  /** 場の中に出す1行（交換中など）。 */
  note?: string | null;
  owner?: SeatId | null;
};

export function Field({ play, revolution, tempReverse, reversed, suitLock, motion, motionKey, note }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(340);
  const cards = play?.cards ?? [];
  const lay = fieldLayout(cards.length, width);
  const hasJokerLabel = play !== null && play.jokers.some((j) => j.rank !== null);
  // 添え字の場所：1段ならカードの下。2段なら上の段はカードの上、下の段はカードの下
  const rowHasLabel = (r: number) => play !== null && (lay.rows[r] ?? []).some((i) => jokerStandIn(play, cards[i]!) !== null);
  const twoRows = lay.rows.length > 1;
  const padTop = twoRows && rowHasLabel(0) ? 20 : 0;
  const padBottom = twoRows ? (rowHasLabel(1) ? 20 : 0) : hasJokerLabel ? 20 : 0;
  const motionCls =
    motion === null ? '' : motion.kind === 'out' ? s.out : motion.from === 'me' ? s.inMe : [s.inLeft, s.inCenter, s.inRight][motion.from];
  return (
    <div className={`f ${reversed ? s.frameRed : s.frame} ${s.field}`}>
      {(revolution || tempReverse || suitLock !== null) && (
        <div className={s.states}>
          {revolution && <span className={`f red redt ${s.state}`}>革命中</span>}
          {tempReverse && <span className={`f red redt ${s.state}`}>J バック中</span>}
          {suitLock !== null && (
            <span className={`f win hi ${s.state}`} aria-label={`縛り ${suitLock.map((x) => ({ spade: 'スペード', heart: 'ハート', diamond: 'ダイヤ', club: 'クラブ' })[x]).join('と')}`}>
              <span aria-hidden="true">縛り</span>
              {suitLock.map((x) => (
                <Pixel key={x} rows={SUIT_GLYPHS_SMALL[x]} unit={2} color={isRedSuit(x) ? 'var(--red-text)' : 'currentColor'} />
              ))}
            </span>
          )}
        </div>
      )}
      <div ref={ref} className={s.area}>
        {play !== null && (
          <div
            key={motionKey}
            className={`${s.cards} ${motionCls}`}
            style={{ height: lay.height + padTop + padBottom }}
            role="group"
            aria-label="場のカード"
          >
            {lay.rows.map((row, r) =>
              row.map((idx, j) => {
                const id = cards[idx]!;
                const stand = jokerStandIn(play, id);
                const left = (lay.starts[r] ?? 0) + j * lay.step;
                // 2段のときは、上の段の添え字をカードの上に出す（下の段に隠れるため）
                const top = r * ROW_STEP + padTop;
                const labelAbove = twoRows && r === 0;
                return (
                  <div key={id} className={s.slot} style={{ left, top }}>
                    <Card id={id} large={lay.large} {...(stand !== null ? { extraLabel: `${stand}の代わり` } : {})} />
                    {stand !== null && (
                      <span className={`${s.stand} ${labelAbove ? s.standAbove : ''}`} aria-hidden="true">
                        {stand}
                      </span>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        )}
        {play === null && note && <p className={s.note}>{note}</p>}
      </div>
    </div>
  );
}
