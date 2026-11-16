import { CROWN_GLYPH } from '../pixel/patterns.ts';
import { Pixel } from '../pixel/Pixel.tsx';
import s from './Logo.module.css';

export function Logo() {
  return (
    <div className={s.logo}>
      <span className={s.crown}>
        <Pixel rows={CROWN_GLYPH} unit={4} />
      </span>
      <h1 className={s.word}>超富豪</h1>
    </div>
  );
}
