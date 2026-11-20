import { Card } from '../components/Card.tsx';
import { Logo } from '../components/Logo.tsx';
import { TitleDeco } from '../components/TitleDeco.tsx';
import { Pixel } from '../pixel/Pixel.tsx';
import { chofugoTurnScene } from './Gallery.tsx';
import { QR_ROWS, QR_URL } from './qr.ts';
import s from './Poster.module.css';

const features = [
  'スマホのブラウザで すぐ遊べる',
  'インストールも 登録も いらない',
  'リンクを送って 友だちと対戦',
];
const modes = [
  ['大富豪', 'おなじみのルールで'],
  ['カスタム', '24種のルールを 好きに組み合わせ'],
  ['超富豪', '1位になると 特権が使える'],
];
const headline = '4人で遊ぶ オンライン大富豪';

// d 案に載せる対戦画面（超富豪モード、自分の番）。見本ページと同じ固定のデータで、名前だけ差し替える。
const screen = chofugoTurnScene(
  '',
  { chosen: ['peek', 'steal', 'ban'], names: ['あかね', 'いつき', 'うみ', 'CPU 4'] },
  { selected: ['spade-6', 'heart-6'], line: 'いつき が 5を2枚 出した' },
);

function PlayLink() {
  return <a className={s.playLink} href={QR_URL}>
    <p className={s.qrLabel}>ここから遊べる</p>
    <div className={s.qr}><Pixel rows={QR_ROWS} unit={6} color="var(--ink)" /></div>
    <p className={s.url}>chofugo.na2kera.com</p>
  </a>;
}

export default function Poster() {
  const requested = new URLSearchParams(location.search).get('v');
  const variant = requested === 'b' || requested === 'c' || requested === 'd' ? requested : 'a';
  return <main className={`${s.paper} ${s[variant]}`} data-poster={variant}>
    {variant === 'a' && <>
      <div className={s.title}><TitleDeco>
        <div className={s.titleCopy}><Logo /><p>{headline}</p></div>
      </TitleDeco></div>
      <div className={s.features}>{features.map(text => <p key={text}>{text}</p>)}</div>
    </>}
    {variant === 'b' && <>
      <div className={s.logo}><Logo /></div>
      <p className={s.headline}>{headline}</p>
      <div className={s.hand} aria-hidden="true">
        <Card id="spade-14" /><Card id="heart-15" /><Card id="club-13" /><Card id="joker-0" />
      </div>
      <p className={s.invite}>{features[2]}</p>
    </>}
    {variant === 'c' && <>
      <div className={s.logo}><Logo /></div>
      <p className={s.headline}>{headline}</p>
      <div className={s.cards} aria-hidden="true"><Card id="spade-14" /><Card id="heart-15" /><Card id="joker-0" /></div>
      <div className={s.modes}>{modes.map(([name, description]) => <div key={name}>
        <h2>{name}</h2><p>{description}</p>
      </div>)}</div>
    </>}
    {variant === 'd' && <>
      <div className={s.screen} aria-hidden="true">
        <div className="app" style={{ width: 390, maxWidth: 390, height: 800, minHeight: 800, margin: 0 }}>{screen.render()}</div>
      </div>
      <div className={s.logo}><Logo /></div>
      <p className={s.headline}>{headline}</p>
      <div className={s.features}>{features.map(text => <p key={text}>{text}</p>)}</div>
    </>}
    <PlayLink />
  </main>;
}
