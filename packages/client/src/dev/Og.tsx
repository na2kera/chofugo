import { Card, CardBack } from '../components/Card.tsx';
import { Logo } from '../components/Logo.tsx';
import { TitleDeco } from '../components/TitleDeco.tsx';
import { Pixel } from '../pixel/Pixel.tsx';
import { SUIT_GLYPHS_SMALL } from '../pixel/patterns.ts';
import s from './Og.module.css';

function Backs() {
  return <><CardBack /><CardBack /><CardBack /></>;
}

/** 600×315 CSS px。撮影は deviceScaleFactor: 2、ロゴは中央315px以内。 */
export default function Og() {
  const requested = new URLSearchParams(location.search).get('v');
  const variant = requested === 'b' || requested === 'c' ? requested : 'a';
  return (
    <main className={`${s.canvas} ${s[variant]}`} data-og={variant} aria-label="超富豪 招待画像">
      {variant === 'a' && <>
        <div className={s.leftCards}><Card id="spade-14" /><Card id="heart-15" /></div>
        <div className={s.rightCards}><Card id="diamond-13" /><Card id="joker-0" /></div>
        <div className={s.hero}><Logo /></div>
        <div className={s.marks}>
          {(['spade', 'heart', 'diamond', 'club'] as const).map((suit) => (
            <Pixel key={suit} rows={SUIT_GLYPHS_SMALL[suit]} unit={2}
              color={suit === 'heart' || suit === 'diamond' ? 'var(--red)' : 'var(--gold-lo)'} />
          ))}
        </div>
      </>}
      {variant === 'b' && <div className={s.title}>
        <TitleDeco>
          <div className={s.titleCopy}>
            <Logo />
            <p>4人で遊ぶ オンライン大富豪</p>
          </div>
        </TitleDeco>
      </div>}
      {variant === 'c' && <>
        <div className={`f dim ${s.table}`} />
        <div className={`f win ${s.center}`}><Logo /></div>
        <div className={`${s.seat} ${s.north}`}><Backs /></div>
        <div className={`${s.seat} ${s.west}`}><Backs /></div>
        <div className={`${s.seat} ${s.east}`}><Backs /></div>
        <div className={s.south}><Card id="spade-14" /><Card id="heart-14" /><Card id="joker-0" /></div>
      </>}
    </main>
  );
}
