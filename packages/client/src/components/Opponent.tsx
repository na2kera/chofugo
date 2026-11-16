// 相手1人の枠（design-client §4.5、§7.5、§7.6）。
// 階級の札（初回は出さない）、名前、裏向きのカード1枚と残り枚数。上がった人は順位の札に替え、枚数は出さない。
// 手番の人は枠を明るく。その場でパスした人には「パス」の札。代役中の人は名前を暗く。

import type { Place } from '@chofugo/engine';
import type { DeadlineView } from '@chofugo/server/protocol';
import { PLACE_TITLE } from '../lib/cards.ts';
import { ARROW_GLYPHS } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import { CardBack } from './Card.tsx';
import { TimeBar } from './TimeBar.tsx';
import s from './Opponent.module.css';

export type OpponentProps = {
  name: string;
  rank: Place | null;
  count: number | null;
  place: Place | null;
  placeRed: boolean;
  active: boolean;
  passed: boolean;
  away: boolean;
  /** 場の手を出した人の印（▼）。 */
  owner: boolean;
  deadline: DeadlineView | null;
  offset: number;
  /** 順位が確定した演出中。 */
  flash: 'gold' | 'red' | null;
  fixedNow?: number;
};

export function Opponent(p: OpponentProps) {
  const frame = p.flash === 'red' ? 'red' : p.active || p.flash === 'gold' ? 'hot' : 'dim';
  const label = [
    p.name,
    p.rank !== null ? PLACE_TITLE[p.rank] : null,
    p.place !== null ? `${p.place}位` : p.count !== null ? `残り${p.count}枚` : null,
    p.passed ? 'パス' : null,
    p.active ? '考え中' : null,
  ]
    .filter(Boolean)
    .join('、');
  return (
    <div className={`f ${frame} ${s.opp} ${p.flash !== null ? s.flash : ''}`} aria-label={label} role="group">
      {p.passed && p.place === null && <span className={`f red redt ${s.tag}`}>パス</span>}
      <div className={s.plateRow}>
        {p.rank !== null && <span className={p.rank === 1 ? 'f plate' : 'f plate2'}>{PLACE_TITLE[p.rank]}</span>}
      </div>
      <div className={`${s.name} ${p.away ? s.away : ''}`}>{p.name}</div>
      <div className={s.fan}>
        {p.place !== null ? (
          <span className={`f ${p.placeRed ? 'red redt' : 'plate'} ${s.placeTag}`}>{p.place}位</span>
        ) : (
          <>
            <CardBack />
            <span>{p.count ?? ''}</span>
          </>
        )}
      </div>
      <div className={s.timer}>
        {p.deadline !== null && <TimeBar deadline={p.deadline} offset={p.offset} segments={8} small {...(p.fixedNow !== undefined ? { fixedNow: p.fixedNow } : {})} />}
      </div>
      {p.owner && (
        <span className={s.owner} aria-hidden="true">
          <Pixel rows={ARROW_GLYPHS.down} unit={2} />
        </span>
      )}
    </div>
  );
}
