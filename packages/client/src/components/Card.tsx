// トランプ1枚（design-client §7.4）。幅56×高さ80px。場に4枚以下のときだけ 68×96px。
// 数字は専用のドット絵（patterns.ts の RANK_GLYPHS。1点 = 2px、1文字 16×28px、「10」は 28×28px）。
// フォントの文字を縮めて代用しない。

import type { CardId } from '@chofugo/engine';
import { cardLabel, faceOf, isRedSuit } from '../lib/cards.ts';
import { JOKER_GLYPH, RANK_GLYPHS, SUIT_GLYPHS_LARGE, SUIT_GLYPHS_SMALL } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import s from './Card.module.css';

export type CardLook = 'normal' | 'dim' | 'sel';

type Props = {
  id: CardId;
  large?: boolean;
  look?: CardLook;
  /** 受け取ったカードの印（交換）。 */
  received?: boolean;
  /** 透視で見られたカードの印（上の端の赤い線、design-3 §4.4）。 */
  peeked?: boolean;
  /** 押せるカード（手札）。 */
  onPress?: () => void;
  /** 読み上げに足す言葉（「選択中」など）。 */
  extraLabel?: string;
  className?: string | undefined;
  style?: React.CSSProperties;
};

export function CardFaceArt({ id }: { id: CardId }) {
  const f = faceOf(id);
  if (f === null) return null;
  if (f.kind === 'joker') {
    return (
      <>
        <span className={s.jokerText}>JOKER</span>
        <span className={s.big}>
          <Pixel rows={JOKER_GLYPH} unit={2} />
        </span>
      </>
    );
  }
  return (
    <>
      <span className={s.rank}>
        <Pixel rows={RANK_GLYPHS[f.key]} unit={2} />
      </span>
      <span className={s.small}>
        <Pixel rows={SUIT_GLYPHS_SMALL[f.suit]} unit={2} />
      </span>
      <span className={s.big}>
        <Pixel rows={SUIT_GLYPHS_LARGE[f.suit]} unit={2} />
      </span>
    </>
  );
}

export function Card({ id, large = false, look = 'normal', received = false, peeked = false, onPress, extraLabel, className, style }: Props) {
  const f = faceOf(id);
  const color = f === null ? '' : f.kind === 'joker' ? s.joker : isRedSuit(f.suit) ? s.red : s.black;
  const cls = [
    'f',
    s.card,
    look === 'sel' ? s.frameSel : received ? s.frameRecv : s.frame,
    large ? s.large : '',
    color,
    look === 'dim' ? s.dim : '',
    look === 'sel' ? s.sel : '',
    onPress ? s.button : '',
    peeked ? s.peeked : '',
    className ?? '',
  ].join(' ');
  const extra = [received ? '受け取ったカード' : null, peeked ? '透視で見られた' : null, extraLabel].filter(Boolean).join('、');
  const label = extra ? `${cardLabel(id)}、${extra}` : cardLabel(id);
  const inner = <CardFaceArt id={id} />;
  if (onPress) {
    return (
      <button type="button" className={cls} style={style} aria-label={label} aria-pressed={look === 'sel'} onClick={onPress}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} style={style} role="img" aria-label={label}>
      {inner}
    </div>
  );
}

/**
 * 裏向きのカード。ふだんは相手の枠の小さい1枚（22×30）。
 * size='card' で表のカードと同じ大きさ（56×80）にする（ルールの説明の見本、design-5 §6.2）。模様は同じ。
 */
export function CardBack({ size = 'small' }: { size?: 'small' | 'card' } = {}) {
  return <i className={size === 'card' ? `${s.back} ${s.backCard}` : s.back} aria-hidden="true" />;
}
