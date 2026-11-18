// 上に4つのマークと細い線、ロゴの下に段違いのトランプ3枚を置く。
// ユーザーが 2026-11-18 に選んだ組み合わせ。
import type { ReactNode } from 'react';
import { Pixel } from '../pixel/Pixel.tsx';
import { SUIT_GLYPHS_SMALL } from '../pixel/patterns.ts';
import { Card } from './Card.tsx';
import s from './TitleDeco.module.css';

export function TitleDeco({ children }: { children: ReactNode }) {
  return (
    <div className={s.title}>
      <div className={s.suits} aria-hidden="true">
        <Pixel rows={SUIT_GLYPHS_SMALL.spade} unit={2} />
        <Pixel rows={SUIT_GLYPHS_SMALL.heart} unit={2} color="var(--red)" />
        <Pixel rows={SUIT_GLYPHS_SMALL.diamond} unit={2} color="var(--red)" />
        <Pixel rows={SUIT_GLYPHS_SMALL.club} unit={2} />
      </div>
      {children}
      <div className={s.cards} aria-hidden="true">
        <Card id="spade-14" className={s.leftCard} />
        <Card id="heart-15" className={s.rightCard} />
        <Card id="joker-0" className={s.jokerCard} />
      </div>
    </div>
  );
}
