// URL は2種類だけ（design-client §3）：`/` ホーム、`/r/:roomId` ルーム。History API で扱う。
// 開発のときだけ `/dev/gallery`（固定のデータで各画面を描く見本ページ）。

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Room } from './screens/Room.tsx';
import { Home } from './screens/Simple.tsx';

const Gallery = import.meta.env.DEV ? lazy(() => import('./dev/Gallery.tsx')) : null;

/** ?p= の開発用の切り替えは、移動しても残す。 */
function keepProfile(path: string): string {
  const m = /[?&]p=([1-4])/.exec(location.search);
  return m === null ? path : `${path}?p=${m[1]}`;
}

/** 開発のときだけ：?vw=390&vh=800 で画面の枠をその大きさに固定する（ヘッドレスの撮影用。ヘッドレスは幅500px未満にできないため）。 */
export function devFrameStyle(): React.CSSProperties | undefined {
  if (!import.meta.env.DEV) return undefined;
  const q = new URLSearchParams(location.search);
  const w = Number(q.get('vw'));
  const h = Number(q.get('vh'));
  if (!(w > 0 && h > 0)) return undefined;
  return { width: w, maxWidth: w, height: h, minHeight: h, margin: '0 auto', border: 0 };
}

/** 不正な URL（`/r/%` など）でも落とさない。読めなければそのまま返し、ルーム ID の検査で「見つからない」にする。 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function App() {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((to: string) => {
    history.pushState(null, '', keepProfile(to));
    setPath(to);
  }, []);
  const goHome = useCallback(() => go('/'), [go]);

  const room = /^\/r\/([^/]+)\/?$/.exec(path);
  if (Gallery !== null && path === '/dev/gallery') {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  return (
    <div className="app" style={devFrameStyle()}>
      {room !== null ? <Room key={room[1]} roomId={safeDecode(room[1]!)} goHome={goHome} /> : <Home go={go} />}
    </div>
  );
}
